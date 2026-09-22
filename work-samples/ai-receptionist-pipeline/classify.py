#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
classify.py
===========
Step-2 CLASSIFICATION phase.

For every real dialogue call (status conversation/short) in output/*.json, add a
"classification" object with:
  - intent            : exactly one of INTENTS (fixed taxonomy)
  - summary           : one-sentence summary
  - resolution_status : resolved | unresolved | follow_up_needed | transferred | unknown
  - resolution_detail : short note on how it was resolved / what is pending
  - products          : list of product names/codes mentioned (may be empty)
  - sentiment         : positive | neutral | negative

The result is written back into the same JSON file under "classification".
Re-running skips calls already classified (resume-safe). Reuses transcript.py's
API key and request helpers.

Usage:
  python classify.py            # classify ALL unclassified dialogue calls
  python classify.py 30         # classify only the first 30 (for a quick test)
"""

import json
import glob
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcript as t  # reuse API_KEY, HEADERS, OPENROUTER_BASE, post_with_retry

MODEL = t.DIARIZE_MODEL  # google/gemini-2.5-flash
WORKERS = 8
MAX_CHARS = 8000

# Fixed taxonomy agreed in the exploration phase (11 categories).
INTENTS = [
    "Order Placement",
    "Order Status & Modification",
    "Product Info & Availability",
    "Delivery & Pickup",
    "Quotes & Pricing",
    "Payments & Refunds",
    "Returns & Exchanges",
    "Complaint / Issue",
    "Callback & Specific Contact",
    "Showroom & Viewing",
    "Other / Unclear",
]

RESOLUTION_STATES = {
    "resolved", "unresolved", "follow_up_needed", "transferred", "unknown",
}


def dialogue_text(record: dict) -> str:
    """Prefer labelled turns; fall back to raw transcript."""
    turns = record.get("turns", [])
    if turns and any(x.get("speaker") not in (None, "", "Unknown") for x in turns):
        text = "\n".join(f"{x.get('speaker')}: {x.get('text')}" for x in turns)
    else:
        text = record.get("raw_transcript", "")
    return text[:MAX_CHARS]


def classify(record: dict) -> dict | None:
    system = (
        "You classify a customer phone call to an Australian furniture/homewares "
        "wholesaler (Example Wholesale Co.).\n\n"
        "Pick the customer's PRIMARY intent as EXACTLY ONE of these categories:\n"
        + "\n".join(f"- {c}" for c in INTENTS)
        + "\n\nReturn ONLY JSON, no fences:\n"
        '{"intent": "<one category exactly as written>", '
        '"summary": "<one sentence>", '
        '"resolution_status": "resolved|unresolved|follow_up_needed|transferred|unknown", '
        '"resolution_detail": "<short note>", '
        '"products": ["<product name or code>", "..."], '
        '"sentiment": "positive|neutral|negative"}'
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": dialogue_text(record)},
        ],
        "temperature": 0,
    }
    data = t.post_with_retry(f"{t.OPENROUTER_BASE}/chat/completions", payload)
    content = data["choices"][0]["message"]["content"].strip()
    parsed = t._extract_json(content)
    if not parsed:
        return None

    intent = str(parsed.get("intent", "")).strip()
    if intent not in INTENTS:
        intent = "Other / Unclear"
    status = str(parsed.get("resolution_status", "")).strip().lower()
    if status not in RESOLUTION_STATES:
        status = "unknown"
    products = parsed.get("products") or []
    if not isinstance(products, list):
        products = [str(products)]
    sentiment = str(parsed.get("sentiment", "")).strip().lower()
    if sentiment not in ("positive", "neutral", "negative"):
        sentiment = "neutral"

    return {
        "intent": intent,
        "summary": str(parsed.get("summary", "")).strip(),
        "resolution_status": status,
        "resolution_detail": str(parsed.get("resolution_detail", "")).strip(),
        "products": [str(p).strip() for p in products if str(p).strip()],
        "sentiment": sentiment,
    }


def process(path: str) -> tuple[str, str | None]:
    """Classify one file in place. Returns (intent, error)."""
    d = json.load(open(path, encoding="utf-8"))
    try:
        result = classify(d)
        if not result:
            return ("", "parse failed")
        d["classification"] = result
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=2)
        return (result["intent"], None)
    except Exception as e:  # noqa: BLE001
        return ("", str(e))


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None

    todo = []
    for f in sorted(glob.glob(os.path.join(str(t.OUTPUT_DIR), "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("status") in ("conversation", "short") and "classification" not in d:
            todo.append(f)
    if limit:
        todo = todo[:limit]

    print(f"Calls to classify: {len(todo)}"
          + (f" (limited to {limit})" if limit else ""))
    if not todo:
        print("Nothing to do.")
        return 0

    intents, fails, done = Counter(), [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(process, f): f for f in todo}
        for fut in as_completed(futs):
            intent, err = fut.result()
            done += 1
            if err:
                fails.append((os.path.basename(futs[fut]), err))
            else:
                intents[intent] += 1
            if done % 25 == 0:
                print(f"   {done}/{len(todo)} done")

    print(f"\nClassified OK: {sum(intents.values())}, failed: {len(fails)}")
    print("\n=== INTENT DISTRIBUTION ===")
    for intent, n in intents.most_common():
        print(f"  {n:>4}  {intent}")
    if fails:
        print(f"\n{len(fails)} failed (rerun to retry):")
        for name, err in fails[:15]:
            print(f"  - {name}: {err}")
    return 0 if not fails else 2


if __name__ == "__main__":
    sys.exit(main())
