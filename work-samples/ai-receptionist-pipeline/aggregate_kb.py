#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
aggregate_kb.py
===============
Step-3 stage 2: aggregate per-call "kb" extractions into a Knowledge Base.

For each MVP intent, collapse the messy question_types into a handful of standard
question categories, and for each category produce:
  - standard_solution : how it is / should be handled
  - automation        : ai_can_answer | ai_needs_system_lookup | must_transfer_human
  - route_to          : who handles it when not AI-solvable

Writes knowledge_base.json and prints a readable summary. No per-call API calls;
just 1 LLM call per intent. Reuses transcript.py helpers.
"""

import json
import glob
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcript as t

MODEL = t.DIARIZE_MODEL
# All meaningful customer intents (excludes the noise class "Other / Unclear").
MVP_INTENTS = [
    "Product Info & Availability",
    "Quotes & Pricing",
    "Delivery & Pickup",
    "Order Placement",
    "Order Status & Modification",
    "Payments & Refunds",
    "Returns & Exchanges",
    "Complaint / Issue",
    "Callback & Specific Contact",
    "Showroom & Viewing",
]


def collect() -> dict:
    """intent -> {qtypes: Counter, examples: {qtype: [how_resolved]}, auto, route, n}"""
    data = defaultdict(lambda: {
        "qtypes": Counter(), "examples": defaultdict(list),
        "auto": Counter(), "route": Counter(), "n": 0,
    })
    for f in glob.glob(os.path.join(str(t.OUTPUT_DIR), "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        kb = d.get("kb")
        intent = d.get("classification", {}).get("intent")
        if not kb or intent not in MVP_INTENTS:
            continue
        e = data[intent]
        e["n"] += 1
        qt = kb.get("question_type", "").strip()
        if qt:
            e["qtypes"][qt] += 1
            if len(e["examples"][qt]) < 2 and kb.get("how_resolved"):
                e["examples"][qt].append(kb["how_resolved"])
        e["auto"][kb.get("automation")] += 1
        e["route"][kb.get("route_to")] += 1
    return data


def build_categories(intent: str, e: dict) -> list[dict]:
    # Build a compact input: top question types with counts + example resolutions.
    lines = []
    for qt, n in e["qtypes"].most_common(40):
        ex = " | ".join(e["examples"].get(qt, [])[:2])
        lines.append(f"- ({n}x) {qt} :: {ex}")
    listing = "\n".join(lines)

    system = (
        f"You are building a knowledge base for an Australian furniture/homewares "
        f"wholesaler's AI receptionist. Intent area: \"{intent}\".\n"
        "Below are sub-question types from real customer calls (with counts and example "
        "resolutions). Group them into 5-8 STANDARD question categories. For each category "
        "write a reusable knowledge-base entry.\n\n"
        "For each category provide:\n"
        "- category: short clear name\n"
        "- standard_solution: how to handle/answer it (concise, reusable)\n"
        "- automation: ai_can_answer | ai_needs_system_lookup | must_transfer_human\n"
        "- route_to: who handles it if not AI-solvable (warehouse_stock, accounts_invoice, "
        "sales, support_aftersales, delivery_freight, manager, specific_person, or none)\n"
        "- example_question_types: a few raw labels it covers\n\n"
        "Return ONLY JSON, no fences:\n"
        '{"categories": [{"category": "...", "standard_solution": "...", '
        '"automation": "...", "route_to": "...", "example_question_types": ["..."]}]}'
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": listing},
        ],
        "temperature": 0,
    }
    data = t.post_with_retry(f"{t.OPENROUTER_BASE}/chat/completions", payload)
    parsed = t._extract_json(data["choices"][0]["message"]["content"].strip())
    return (parsed or {}).get("categories", []) if parsed else []


def main() -> int:
    data = collect()
    kb_out = {"intents": []}

    for intent in MVP_INTENTS:
        e = data.get(intent)
        if not e or not e["n"]:
            continue
        print(f"\nBuilding KB for: {intent} ({e['n']} calls)...")
        cats = build_categories(intent, e)
        kb_out["intents"].append({
            "intent": intent,
            "total_calls": e["n"],
            "automation_distribution": dict(e["auto"].most_common()),
            "route_distribution": dict(e["route"].most_common()),
            "question_categories": cats,
        })

    path = os.path.join(os.path.dirname(__file__), "knowledge_base.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(kb_out, fh, ensure_ascii=False, indent=2)

    # Readable summary
    for blk in kb_out["intents"]:
        print(f"\n{'='*70}\n{blk['intent']}  (n={blk['total_calls']})")
        print(f"  automation: {blk['automation_distribution']}")
        for c in blk["question_categories"]:
            print(f"\n  • {c.get('category')}  [{c.get('automation')}"
                  + (f" -> {c.get('route_to')}" if c.get('route_to') not in (None, 'none') else "")
                  + "]")
            print(f"      {c.get('standard_solution')}")
    print(f"\nSaved -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
