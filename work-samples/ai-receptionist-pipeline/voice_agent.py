#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
voice_agent.py
==============
Local VOICE version of the AI receptionist. Same BRAIN and 3-group routing as
interactive_agent.py -- it just adds a voice layer so you converse the SAME WAY
3CX will: speak into the mic (it auto-detects when you stop) -> Whisper transcribes
-> the shared brain decides -> the reply is spoken back.

Pipeline:  mic (auto silence-detect) -> OpenRouter Whisper (STT) -> brain (same
           SYSTEM prompt / 3 groups) -> edge-tts (speak).

NOTE: this is NOT the exact 3CX model. 3CX uses OpenAI gpt-realtime; here we use
OpenRouter Whisper + the shared text brain + edge-tts. The conversation *behaviour*
(voice in, same routing/handoff logic, voice out) matches; the underlying model does not.

Run:  python voice_agent.py      (speak after the greeting; say "goodbye" or Ctrl+C to quit)
"""

import asyncio
import base64
import io
import os
import sys
import tempfile
import time

import numpy as np
import sounddevice as sd
import soundfile as sf
import edge_tts

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcript as t
import interactive_agent as ia

SR = 16000                  # mic sample rate
VOICE = "en-AU-NatashaNeural"   # Australian voice; change to en-AU-WilliamNeural for male
SILENCE_THRESH = 0.015      # updated by calibrate()
SILENCE_HOLD = 0.8          # seconds of silence that ends an utterance
MAX_UTTER = 15              # max seconds per utterance
START_TIMEOUT = 8           # seconds to wait for speech to start
BLOCK = 0.03                # 30 ms analysis blocks


def calibrate():
    """Set the speech threshold from ~0.6s of ambient noise so it adapts to the mic/room."""
    global SILENCE_THRESH
    rec = sd.rec(int(SR * 0.6), samplerate=SR, channels=1, dtype="float32")
    sd.wait()
    bg = float(np.sqrt(np.mean(rec ** 2)))
    SILENCE_THRESH = max(0.02, bg * 2.0)
    print(f"[calibrated: ambient {bg:.4f} -> speech threshold {SILENCE_THRESH:.4f}]")
    if bg > 0.03:
        print("[!] Background is noisy -- for best results lower mic gain, use a headset mic, "
              "or move somewhere quieter (otherwise it may mis-hear or cut you off).")


def record_utterance():
    """Record until the caller stops talking (silence for SILENCE_HOLD). Returns audio or None."""
    block = int(SR * BLOCK)
    hold_blocks = int(SILENCE_HOLD / BLOCK)
    frames, started, silent, waited = [], False, 0, 0.0
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32") as stream:
        for _ in range(int(MAX_UTTER / BLOCK)):
            data, _ = stream.read(block)
            rms = float(np.sqrt(np.mean(data ** 2)))
            if not started:
                waited += BLOCK
                if rms > SILENCE_THRESH:
                    started, frames = True, [data.copy()]
                elif waited >= START_TIMEOUT:
                    return None, 0.0
            else:
                frames.append(data.copy())
                if rms < SILENCE_THRESH:
                    silent += 1
                    if silent >= hold_blocks:
                        break
                else:
                    silent = 0
    if not frames:
        return None, 0.0
    audio = np.concatenate(frames).reshape(-1)
    return audio, len(audio) / SR


def stt(audio):
    """Transcribe audio via OpenRouter Whisper."""
    buf = io.BytesIO()
    sf.write(buf, audio, SR, format="WAV", subtype="PCM_16")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    data = t.post_with_retry(
        f"{t.OPENROUTER_BASE}/audio/transcriptions",
        {"model": t.STT_MODEL, "input_audio": {"data": b64, "format": "wav"}, "language": "en"},
    )
    text = data.get("text")
    if text is None and isinstance(data.get("choices"), list):
        text = data["choices"][0].get("message", {}).get("content", "")
    return (text or "").strip()


async def _save_tts(text, path):
    await edge_tts.Communicate(text, VOICE).save(path)


def speak(text):
    """Speak text with edge-tts. Returns synthesis time (the delay before playback starts)."""
    path = os.path.join(tempfile.gettempdir(), f"_voice_{os.getpid()}.mp3")
    gen0 = time.time()
    asyncio.run(_save_tts(text, path))
    data, sr = sf.read(path)
    gen_s = time.time() - gen0
    sd.play(data, sr)
    sd.wait()
    try:
        os.remove(path)
    except OSError:
        pass
    return gen_s


def brain(messages, user):
    """Same brain as interactive_agent: returns (reply, action, parsed)."""
    messages.append({"role": "user", "content": user})
    data = t.post_with_retry(
        f"{t.OPENROUTER_BASE}/chat/completions",
        {"model": ia.MODEL, "messages": messages, "temperature": 0},
    )
    content = data["choices"][0]["message"]["content"].strip()
    p = t._extract_json(content)
    if not p or not p.get("reply"):
        # Never speak raw model output (it may have role-played the caller). Ask to repeat.
        reply = "Sorry, I didn't quite catch that -- could you say that again?"
        messages.append({"role": "assistant", "content": reply})
        return reply, "clarify", {}
    reply = p.get("reply")
    action = p.get("action", "")
    if action == "transfer" and "?" in reply:   # same safety net as the text app
        action = "clarify"
    messages.append({"role": "assistant", "content": reply})
    return reply, action, p


def _fresh():
    return [{"role": "system", "content": ia.SYSTEM},
            {"role": "assistant", "content": ia.GREETING}]


def main() -> int:
    print("Voice receptionist. Speak after the greeting; say 'goodbye' or press Ctrl+C to quit.\n")
    calibrate()
    messages = _fresh()
    print(f"AI> {ia.GREETING}")
    speak(ia.GREETING)

    while True:
        print("\n[listening... speak now]")
        audio, dur = record_utterance()
        if audio is None:
            print("[no speech detected]")
            continue
        print(f"[heard {dur:.1f}s -- transcribing...]")
        ts = time.time()
        user = stt(audio)
        stt_s = time.time() - ts
        if not user:
            print(f"[couldn't make that out  (STT {stt_s:.1f}s)]")
            continue
        print(f"Customer> {user}   (STT {stt_s:.1f}s)")
        if user.lower().strip(" .!?") in ("quit", "exit", "goodbye", "bye", "goodbye."):
            speak("Thanks for calling. Goodbye.")
            break

        ls = time.time()
        reply, action, p = brain(messages, user)
        llm_s = time.time() - ls
        to = p.get("transfer_to", "")
        print(f"AI [{action}{'->' + to if to else ''}]  (think {llm_s:.1f}s)> {reply}")
        synth_s = speak(reply)
        total = stt_s + llm_s + synth_s
        print(f"    [reply latency: STT {stt_s:.1f} + think {llm_s:.1f} + synth {synth_s:.1f} "
              f"= {total:.1f}s from you finishing to AI speaking]")

        if action == "transfer":
            h = p.get("handoff") or {}
            kd = {k: v for k, v in (h.get("key_details") or {}).items() if v}
            lang = h.get("caller_language")
            print(f"    >>> HANDOFF -> {to} | {h.get('summary')} | {kd}"
                  + (f" | lang={lang}" if lang else ""))
            # transfer = end of this call; start a fresh one (mirrors the text app)
            messages = _fresh()
            print(f"\n--- call transferred to {to}; new call ---")
            print(f"AI> {ia.GREETING}")
            speak(ia.GREETING)

    print("\nEnded.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nEnded.")
