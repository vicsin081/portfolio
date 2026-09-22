#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_kb.py
===========
Step-3 Knowledge Base extraction (MVP: 3 high-ROI intents).

For each call whose classification.intent is one of MVP_INTENTS, extract a "kb"
object describing how the problem is/should be solved and who it routes to:
  - question_type      : specific sub-type of the question (short phrase)
  - solvable_on_call   : true if answerable on the spot (no lookup/transfer)
  - how_resolved       : one line on how it was / should be handled
  - route_to           : one of ROUTES (who handles it if not solved on call)
  - automation         : ai_can_answer | ai_needs_system_lookup | must_transfer_human

Written back into each JSON under "kb". Resume-safe; reuses transcript.py helpers.

Usage:
  python build_kb.py        # all MVP-intent calls
  python build_kb.py 30     # first 30 only (quick test)
"""

import json
import glob
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcript as t

MODEL = t.DIARIZE_MODEL
WORKERS = 8
MAX_CHARS = 6000

# All meaningful customer intents (excludes the noise class "Other / Unclear").
MVP_INTENTS = {
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
}

ROUTES = [
    "none",                 # solved on call, no routing
    "warehouse_stock",
    "accounts_invoice",
    "sales",
    "support_aftersales",
    "delivery_freight",
    "manager",
    "specific_person",
]

AUTOMATION = {"ai_can_answer", "ai_needs_system_lookup", "must_transfer_human"}


def extract(record: dict) -> dict | None:
    c = record.get("classification", {})
    turns = record.get("turns", [])
    if turns and any(x.get("speaker") not in (None, "", "Unknown") for x in turns):
        convo = "\n".join(f"{x.get('speaker')}: {x.get('text')}" for x in turns)
    else:
        convo = record.get("raw_transcript", "")
    convo = convo[:MAX_CHARS]

    system = (
        "You analyze a customer call to an Australian furniture/homewares wholesaler. "
        f"Its intent is already known: \"{c.get('intent')}\".\n"
        "Extract how this problem is solved and who handles it.\n\n"
        "Fields:\n"
        "- question_type: the specific sub-type of what the customer asked "
        "(short phrase, lowercase, e.g. 'stock availability', 'delivery cost quote', "
        "'assembly instructions', 'lead time', 'product dimensions').\n"
        "- solvable_on_call: true ONLY if it can be answered immediately with no "
        "system lookup and no transfer; otherwise false.\n"
        "- how_resolved: one short sentence on how it was handled or should be handled.\n"
        "- route_to: who ultimately handles it. EXACTLY one of: "
        + ", ".join(ROUTES) + ". Use 'none' if solved on the call.\n"
        "- automation: how a future AI receptionist could handle THIS type of question. "
        "EXACTLY one of: ai_can_answer (static knowledge it can state directly, e.g. "
        "policy, assembly, standard lead times), ai_needs_system_lookup (answerable if "
        "the AI queries stock/pricing/order systems), must_transfer_human (needs a person: "
        "disputes, complex negotiation, complaints).\n\n"
        "Return ONLY JSON, no fences:\n"
        '{"question_type": "...", "solvable_on_call": true, "how_resolved": "...", '
        '"route_to": "...", "automation": "..."}'
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": convo},
        ],
        "temperature": 0,
    }
    data = t.post_with_retry(f"{t.OPENROUTER_BASE}/chat/completions", payload)
    parsed = t._extract_json(data["choices"][0]["message"]["content"].strip())
    if not parsed:
        return None

    route = str(parsed.get("route_to", "")).strip()
    if route not in ROUTES:
        route = "specific_person"
    auto = str(parsed.get("automation", "")).strip()
    if auto not in AUTOMATION:
        auto = "ai_needs_system_lookup"
    return {
        "question_type": str(parsed.get("question_type", "")).strip().lower(),
        "solvable_on_call": bool(parsed.get("solvable_on_call")),
        "how_resolved": str(parsed.get("how_resolved", "")).strip(),
        "route_to": route,
        "automation": auto,
    }


def process(path: str) -> tuple[str, str | None]:
    d = json.load(open(path, encoding="utf-8"))
    try:
        result = extract(d)
        if not result:
            return ("", "parse failed")
        d["kb"] = result
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=2)
        return (result["automation"], None)
    except Exception as e:  # noqa: BLE001
        return ("", str(e))


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    todo = []
    for f in sorted(glob.glob(os.path.join(str(t.OUTPUT_DIR), "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if (d.get("classification", {}).get("intent") in MVP_INTENTS
                and "kb" not in d):
            todo.append(f)
    if limit:
        todo = todo[:limit]

    print(f"MVP calls to extract: {len(todo)}" + (f" (limited {limit})" if limit else ""))
    if not todo:
        print("Nothing to do.")
        return 0

    auto_c, fails, done = Counter(), [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(process, f): f for f in todo}
        for fut in as_completed(futs):
            auto, err = fut.result()
            done += 1
            if err:
                fails.append((os.path.basename(futs[fut]), err))
            else:
                auto_c[auto] += 1
            if done % 25 == 0:
                print(f"   {done}/{len(todo)} done")

    print(f"\nExtracted OK: {sum(auto_c.values())}, failed: {len(fails)}")
    print("\n=== AUTOMATION POTENTIAL ===")
    for k, n in auto_c.most_common():
        print(f"  {n:>4}  {k}")
    if fails:
        print(f"\n{len(fails)} failed (rerun to retry):")
        for name, err in fails[:15]:
            print(f"  - {name}: {err}")
    return 0 if not fails else 2


if __name__ == "__main__":
    sys.exit(main())
