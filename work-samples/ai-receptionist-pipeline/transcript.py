#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
transcript.py
=============
Turn every .wav phone recording in this folder into STRUCTURED data for downstream
AI (classification, knowledge base, decision engine).

For each call, an "output/<name>.json" record is written with:
  - metadata parsed from the filename: caller_number, queue, datetime, call_id
  - raw_transcript : Whisper's raw text (kept for traceability)
  - turns          : list of {"speaker": "Agent"|"Caller"|..., "text": ...}
  - status         : conversation | automated | empty | failed
A human-readable "output/<name>.txt" is ALSO written for real conversations.

Pipeline (both steps go through OpenRouter, using ONE API key):
  1) OpenAI Whisper Large V3 Turbo -> transcribe the whole call to raw text
  2) An LLM (configurable)         -> split that text into labelled speaker turns,
                                      AND decide whether the call is a real
                                      two-person conversation.

Status rule:
  Automated/system answers, ringing/silence, voicemail, or anything with no real
  back-and-forth are still recorded as JSON (status "automated"/"empty") so no call
  is lost -- they just don't get a .txt. Only real conversations get a .txt.

Note:
  These WAVs are mono (both parties mixed into one channel). Whisper does not do
  speaker separation, so the speaker labels are inferred by the step-2 LLM from
  conversational context -- accurate enough for mono audio, but not perfect.

Usage:
  1) Set your API key (env var is recommended):
        PowerShell:  $env:OPENROUTER_API_KEY = "sk-or-..."
  2) Run:
        python transcript.py
"""

import base64
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import requests

# Windows consoles default to cp1252 and cannot print some characters;
# force UTF-8 output so logging never crashes.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

# ────────────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────────────

# OpenRouter API key: set the OPENROUTER_API_KEY environment variable, or paste it here.
API_KEY = os.environ.get("OPENROUTER_API_KEY", "PUT-YOUR-OPENROUTER-API-KEY-HERE")

# Speech-to-text model (Whisper Large V3 Turbo on OpenRouter)
STT_MODEL = "openai/whisper-large-v3-turbo"

# LLM used to split speakers and judge whether the call is a real conversation
DIARIZE_MODEL = "google/gemini-2.5-flash"

# Conversation language. The calls are English.
LANGUAGE = "en"

# Folder to process (defaults to the folder this script lives in)
FOLDER = Path(__file__).resolve().parent

# Folder where the .txt transcripts are written (created automatically if missing)
OUTPUT_DIR = FOLDER / "output"

# Skip a WAV whose .json already exists (lets you resume after an interruption).
# Note: failed calls are NOT written, so re-running automatically retries them.
SKIP_EXISTING = True

# If Whisper returns fewer than this many characters, treat the call as empty
# (silence / ringing) and skip without even calling the LLM.
MIN_RAW_CHARS = 15

# OpenRouter/Whisper rejects audio over ~25MB, and base64 inflates size by ~33%,
# so cap the raw WAV well below that. Bigger files are recorded as "too_large"
# (handling them would need re-encoding to a compact format such as mp3 first).
MAX_WAV_BYTES = 18 * 1024 * 1024

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

# ────────────────────────────────────────────────────────────────────────────


def post_with_retry(url: str, payload: dict, max_retries: int = 4, timeout: int = 300) -> dict:
    """POST with simple exponential-backoff retry for 429 / 5xx / network errors."""
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, headers=HEADERS, json=payload, timeout=timeout)
        except requests.RequestException as e:
            if attempt == max_retries:
                raise
            wait = 2 ** attempt
            print(f"      network error {e}; retrying in {wait}s ({attempt}/{max_retries})...")
            time.sleep(wait)
            continue

        if resp.status_code == 200:
            return resp.json()

        if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
            wait = 2 ** attempt
            print(f"      HTTP {resp.status_code}; retrying in {wait}s ({attempt}/{max_retries})...")
            time.sleep(wait)
            continue

        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")

    raise RuntimeError("exceeded retry count")


# Two known filename layouts (after URL-decoding %3A=":", %20=" "):
#   OLD: [0390000000:SALES:Q]_0390000000-101_20200323222139(7390).wav
#        bracket = "number:queue",  a-b = "number-extension"
#   NEW: [a colleague]_124-0400000000_20260610051603(535).wav
#        bracket = "agent name",    a-b = "extension-number"
# In both, of the two "a-b" digit groups the LONGER one is the phone number and
# the SHORTER one is the extension. The bracket is either "number[:queue]" (all
# digits) or an agent name (contains letters).
_NAME_RE = re.compile(
    r"^\[(?P<bracket>[^\]]*)\]_(?P<a>\d+)-(?P<b>\d+)_(?P<ts>\d{14})\((?P<id>\d+)\)$"
)
_MIN_PHONE_DIGITS = 6  # anything shorter is treated as an extension, not a number


def parse_filename_metadata(wav_path: Path) -> dict:
    """Extract caller number, extension, agent, queue, datetime and call id.

    Handles both the old and new filename layouts; falls back gracefully
    (fields = None) if the name doesn't match either pattern.
    """
    stem = unquote(wav_path.stem)
    meta = {
        "source_file": wav_path.name,
        "call_id": None,
        "caller_number": None,
        "extension": None,
        "agent_name": None,
        "queue": None,
        "datetime": None,
    }
    m = _NAME_RE.match(stem)
    if not m:
        return meta

    # Phone number vs extension: the longer digit group is the phone number.
    a, b = m.group("a"), m.group("b")
    phone, ext = (a, b) if len(a) >= len(b) else (b, a)
    meta["caller_number"] = phone if len(phone) >= _MIN_PHONE_DIGITS else None
    meta["extension"] = ext

    # Bracket is either "number[:queue]" (old) or an agent name (new).
    # Old format: the part before the first ":" is the phone number (all digits).
    bracket = m.group("bracket").strip()
    if bracket:
        parts = bracket.split(":", 1)
        if parts[0].isdigit():
            if not meta["caller_number"]:
                meta["caller_number"] = parts[0]
            meta["queue"] = parts[1] if len(parts) > 1 else None
        else:
            meta["agent_name"] = bracket

    meta["call_id"] = m.group("id")
    try:
        meta["datetime"] = datetime.strptime(m.group("ts"), "%Y%m%d%H%M%S").isoformat()
    except ValueError:
        meta["datetime"] = None
    return meta


def transcribe(wav_path: Path) -> str:
    """Step 1: transcribe a WAV to raw text with Whisper Large V3 Turbo."""
    audio_b64 = base64.b64encode(wav_path.read_bytes()).decode("ascii")
    payload = {
        "model": STT_MODEL,
        "input_audio": {"data": audio_b64, "format": "wav"},
    }
    if LANGUAGE:
        payload["language"] = LANGUAGE

    data = post_with_retry(f"{OPENROUTER_BASE}/audio/transcriptions", payload)
    text = data.get("text")
    if text is None and isinstance(data.get("choices"), list):
        text = data["choices"][0].get("message", {}).get("content", "")
    return (text or "").strip()


def _extract_json(s: str) -> dict | None:
    """Best-effort extraction of a JSON object from an LLM response."""
    s = s.strip()
    # Strip ```json ... ``` fences if present
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE).strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", s, flags=re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return None


# Categories the diarizer may assign. "empty" / "failed" are set elsewhere.
DIARIZE_CATEGORIES = {"conversation", "short", "internal_test", "automated"}


def diarize(raw_text: str, agent_name: str | None = None) -> tuple[str, str, list[dict]]:
    """Step 2: label speakers and classify the call.

    Returns (category, speaker_labeling, turns) where:
      - category is one of DIARIZE_CATEGORIES
      - speaker_labeling is "confident" or "uncertain"
      - turns is a list of {"speaker": str, "text": str}
    """
    # If we know the agent's name from the filename, give it to the model as the
    # single strongest clue for which side is the Agent.
    agent_hint = ""
    if agent_name:
        agent_hint = (
            f"\nIMPORTANT CLUE: the company agent on THIS call is named "
            f"'{agent_name}'. The person who answers as / is addressed as "
            f"'{agent_name}' is the Agent; the other person is the Caller.\n"
        )

    system_prompt = (
        "You are a phone-call transcript editor. The input is the full transcript of a "
        "single phone call (mono audio, both people mixed together, no speaker labels).\n\n"
        "Classify the call into exactly one category:\n"
        "- \"conversation\": a real, reasonably complete two-person dialogue between a "
        "company agent and a customer.\n"
        "- \"short\": a real human exchange, but very brief or clearly just a fragment of a "
        "call (e.g. a quick confirmation, a few lines, an abrupt cut-off).\n"
        "- \"internal_test\": company staff testing whether the phone line/system works "
        "(e.g. 'just testing', 'test call', 'is this working', '測試'), not a real customer.\n"
        "- \"automated\": an automated/IVR system message or menu, a voicemail greeting, "
        "ringing/silence, hold music, or anything with no real human dialogue.\n\n"
        "For conversation / short / internal_test, split the text into alternating speaker "
        "turns and label each turn \"Agent\" or \"Caller\".\n\n"
        "HOW TO TELL AGENT FROM CALLER (this is the critical part):\n"
        "- Decide each speaker's role from WHAT THEY SAY, judged over the whole call. "
        "Do NOT assume the first line is the Agent -- sometimes the Caller speaks first.\n"
        "- The AGENT works for the company: answers the phone, may state a company/brand "
        "name or their own name, says things like 'how can I help', 'let me check for you', "
        "'one moment please', quotes stock/prices/product codes, takes the order, asks for "
        "the customer's postcode/details.\n"
        "- The CALLER is the outside customer: explains why they are calling, asks about / "
        "wants to buy products, asks for prices or availability, asks to speak to someone, "
        "gives their own name and delivery address.\n"
        + agent_hint +
        "- If after all this you still cannot confidently tell which side is the Agent, "
        "label the two speakers \"Speaker A\" / \"Speaker B\" instead and set "
        "\"speaker_labeling\" to \"uncertain\". Otherwise set it to \"confident\".\n"
        "For \"automated\", return an empty turns array.\n\n"
        "Rules:\n"
        "1. Do NOT change, translate, or omit any words; only segment turns and add labels.\n"
        "2. Each turn is an object {\"speaker\": <label>, \"text\": <words>}.\n"
        "3. No extra commentary.\n\n"
        "Respond with ONLY a JSON object, no markdown fences:\n"
        "{\"category\": \"conversation|short|internal_test|automated\", "
        "\"speaker_labeling\": \"confident|uncertain\", "
        "\"turns\": [{\"speaker\": \"...\", \"text\": \"...\"}]}"
    )
    payload = {
        "model": DIARIZE_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": raw_text},
        ],
        "temperature": 0,
    }
    data = post_with_retry(f"{OPENROUTER_BASE}/chat/completions", payload)
    content = data["choices"][0]["message"]["content"].strip()

    parsed = _extract_json(content)
    if parsed is not None and "category" in parsed:
        category = str(parsed.get("category", "")).strip()
        if category not in DIARIZE_CATEGORIES:
            category = "conversation"  # unknown label -> keep the data, don't drop it
        labeling = str(parsed.get("speaker_labeling", "")).strip()
        if labeling not in ("confident", "uncertain"):
            labeling = "uncertain"
        turns_raw = parsed.get("turns") or []
        turns = [
            {"speaker": str(t.get("speaker", "")).strip(), "text": str(t.get("text", "")).strip()}
            for t in turns_raw
            if isinstance(t, dict) and str(t.get("text", "")).strip()
        ]
        if category == "automated" or not turns:
            return "automated", labeling, []
        return category, labeling, turns

    # Could not parse JSON: keep the data rather than dropping it. Store the whole
    # raw text as a single unlabelled turn so nothing is lost.
    return "conversation", "uncertain", [{"speaker": "Unknown", "text": raw_text}]


def render_txt(record: dict) -> str:
    """Build a human-readable transcript from a record dict."""
    m = record
    header = (
        f"Call ID   : {m.get('call_id')}\n"
        f"Caller    : {m.get('caller_number')}\n"
        f"Agent     : {m.get('agent_name')}\n"
        f"Extension : {m.get('extension')}\n"
        f"Queue     : {m.get('queue')}\n"
        f"Time      : {m.get('datetime')}\n"
        f"Status    : {m.get('status')}\n"
        f"Labeling  : {m.get('speaker_labeling')}\n"
        f"{'-' * 50}\n"
    )
    body = "\n".join(f"{t['speaker']}: {t['text']}" for t in m.get("turns", []))
    return header + body + "\n"


def main() -> int:
    if API_KEY == "PUT-YOUR-OPENROUTER-API-KEY-HERE" or not API_KEY:
        print("ERROR: API key not set. Set the OPENROUTER_API_KEY env var, "
              "or edit the API_KEY value near the top of this file.")
        return 1

    # iterdir (not glob) so filenames containing [ ] are matched reliably.
    wav_files = sorted(
        p for p in FOLDER.iterdir() if p.is_file() and p.suffix.lower() == ".wav"
    )
    if not wav_files:
        print(f"No .wav files found in {FOLDER}")
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Found {len(wav_files)} WAV file(s). Output -> {OUTPUT_DIR}\n")
    counts = {
        "conversation": 0, "short": 0, "internal_test": 0,
        "automated": 0, "empty": 0, "too_large": 0, "failed": 0, "skipped": 0,
    }
    failed_files = []

    for i, wav in enumerate(wav_files, 1):
        out_json = OUTPUT_DIR / (wav.stem + ".json")
        out_txt = OUTPUT_DIR / (wav.stem + ".txt")
        print(f"[{i}/{len(wav_files)}] {wav.name}")

        if SKIP_EXISTING and out_json.exists():
            print("      .json already exists, skipping.")
            counts["skipped"] += 1
            continue

        # Every call gets a record, even automated/empty ones.
        record = parse_filename_metadata(wav)
        record.update(
            {"status": None, "speaker_labeling": None, "raw_transcript": "", "turns": []}
        )

        # Guard against files Whisper will reject (too big once base64-encoded).
        size = wav.stat().st_size
        if size > MAX_WAV_BYTES:
            record["status"] = "too_large"
            record["error"] = f"file is {size} bytes (> {MAX_WAV_BYTES})"
            out_json.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
            counts["too_large"] += 1
            print(f"      too large ({size} bytes); recorded, not transcribed.")
            continue

        try:
            print("      transcribing (Whisper)...")
            raw = transcribe(wav)
            record["raw_transcript"] = raw

            if len(raw) < MIN_RAW_CHARS:
                record["status"] = "empty"
                print("      no meaningful speech (silence/ringing).")
            else:
                print("      labelling speakers (LLM)...")
                category, labeling, turns = diarize(raw, record.get("agent_name"))
                record["turns"] = turns
                record["status"] = category
                record["speaker_labeling"] = labeling
                print(f"      status: {record['status']} ({labeling})")
        except Exception as e:  # noqa: BLE001
            # Do NOT write a .json on failure: that way SKIP_EXISTING will retry
            # this call on the next run (failures are usually transient).
            counts["failed"] += 1
            failed_files.append(wav.name)
            print(f"      FAILED (will retry on rerun): {e}")
            continue

        # Success path: write the JSON record.
        out_json.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        # Write a human-readable .txt for real human dialogue (full or short).
        if record["status"] in ("conversation", "short"):
            out_txt.write_text(render_txt(record), encoding="utf-8")

        counts[record["status"]] = counts.get(record["status"], 0) + 1
        print(f"      -> {out_json.name}")

    print(
        "\nDone. "
        f"conversation={counts['conversation']}, short={counts['short']}, "
        f"internal_test={counts['internal_test']}, automated={counts['automated']}, "
        f"empty={counts['empty']}, too_large={counts['too_large']}, "
        f"failed={counts['failed']}, skipped={counts['skipped']}."
    )
    if failed_files:
        print(f"\n{len(failed_files)} call(s) failed and will be retried on the next run:")
        for name in failed_files:
            print(f"  - {name}")
    return 0 if counts["failed"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
