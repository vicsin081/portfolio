#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
explore_intents.py
==================
Step-2 EXPLORATION phase.

Goal: discover what customers actually call about, BEFORE fixing a taxonomy.

1. Sample real dialogue calls from output/*.json.
2. Ask the LLM to label each call's primary intent with a free-form short label.
3. Aggregate those labels into a proposed taxonomy (~10-18 categories).

Outputs a summary to the console and writes intents_exploration.json.
Reuses the API key and helpers from transcript.py (no separate key needed).
"""

import json
import glob
import os
import random
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcript as t  # reuse API_KEY, HEADERS, OPENROUTER_BASE, post_with_retry

SAMPLE_SIZE = 150
MODEL = t.DIARIZE_MODEL  # google/gemini-2.5-flash
MAX_CHARS = 4000  # truncate very long transcripts; intent is clear early on
WORKERS = 8


def load_dialogue_records() -> list[dict]:
    records = []
    for f in glob.glob(os.path.join(str(t.OUTPUT_DIR), "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("status") in ("conversation", "short") and d.get("raw_transcript"):
            records.append(d)
    return records


def label_intent(record: dict) -> dict | None:
    raw = record.get("raw_transcript", "")[:MAX_CHARS]
    system = (
        "You analyze customer phone calls to an Australian furniture/homewares "
        "wholesaler (Example Wholesale Co.). Given one call transcript, "
        "identify the CUSTOMER's primary reason for calling.\n"
        "Return ONLY JSON, no fences:\n"
        '{"intent": "<short canonical label, 2-5 words, lowercase>", '
        '"desc": "<one short sentence>"}'
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": raw},
        ],
        "temperature": 0,
    }
    try:
        data = t.post_with_retry(f"{t.OPENROUTER_BASE}/chat/completions", payload)
        content = data["choices"][0]["message"]["content"].strip()
        parsed = t._extract_json(content)
        if parsed and parsed.get("intent"):
            return {
                "call_id": record.get("call_id"),
                "intent": str(parsed["intent"]).strip().lower(),
                "desc": str(parsed.get("desc", "")).strip(),
            }
    except Exception as e:  # noqa: BLE001
        print(f"   intent label failed: {e}")
    return None


def summarize_taxonomy(labels: list[dict]) -> str:
    """Ask the LLM to group the free-form labels into a clean taxonomy."""
    label_lines = "\n".join(f"- {x['intent']}" for x in labels)
    system = (
        "You are designing a call-intent taxonomy for a furniture/homewares wholesaler. "
        "Below are free-form intent labels from many real customer calls (with repeats). "
        "Group them into 10-18 clear, non-overlapping customer-intent categories. "
        "Return ONLY JSON, no fences:\n"
        '{"categories": [{"name": "<category>", "description": "<one line>", '
        '"covers": ["<example raw labels>"]}]}'
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": label_lines},
        ],
        "temperature": 0,
    }
    data = t.post_with_retry(f"{t.OPENROUTER_BASE}/chat/completions", payload)
    return data["choices"][0]["message"]["content"].strip()


def main() -> int:
    records = load_dialogue_records()
    print(f"Dialogue calls available: {len(records)}")
    if not records:
        print("No dialogue calls found.")
        return 1
    sample = random.sample(records, min(SAMPLE_SIZE, len(records)))
    print(f"Labeling intents for {len(sample)} sampled calls (parallel)...\n")

    labels = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = [ex.submit(label_intent, r) for r in sample]
        for fut in as_completed(futures):
            res = fut.result()
            done += 1
            if res:
                labels.append(res)
            if done % 20 == 0:
                print(f"   {done}/{len(sample)} done")

    print(f"\nGot {len(labels)} intent labels.")
    counter = Counter(x["intent"] for x in labels)
    print("\n=== TOP RAW INTENT LABELS ===")
    for intent, n in counter.most_common(30):
        print(f"  {n:>3}  {intent}")

    print("\n=== PROPOSED TAXONOMY (LLM-grouped) ===")
    taxonomy_raw = summarize_taxonomy(labels)
    taxonomy = t._extract_json(taxonomy_raw)
    if taxonomy and taxonomy.get("categories"):
        for c in taxonomy["categories"]:
            print(f"\n• {c.get('name')}: {c.get('description')}")
    else:
        print(taxonomy_raw)

    with open(os.path.join(os.path.dirname(__file__), "intents_exploration.json"),
              "w", encoding="utf-8") as fh:
        json.dump(
            {"raw_labels": labels, "label_counts": counter.most_common(),
             "taxonomy": taxonomy or taxonomy_raw},
            fh, ensure_ascii=False, indent=2,
        )
    print("\nSaved -> intents_exploration.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
