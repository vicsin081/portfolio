#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_transfers.py
====================
Analyze the REAL call data: why calls need handling beyond a simple answer, and
who they route to. Pure local read of output/*.json (uses classification + kb).
"""

import json
import glob
import os
from collections import Counter, defaultdict

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")

AUTOMATION_LABEL = {
    "ai_can_answer": "AI can answer (no transfer needed)",
    "ai_needs_system_lookup": "Needs a live system lookup (stock/price/order) -> transfer until API exists",
    "must_transfer_human": "Genuinely needs a person (complaint/dispute/complex)",
}


def main() -> None:
    recs = []
    for f in glob.glob(os.path.join(OUT, "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        kb = d.get("kb")
        c = d.get("classification") or {}
        if kb:
            recs.append((c.get("intent"), kb))

    total = len(recs)
    print(f"Calls analysed (have kb): {total}\n")

    # 1. WHY beyond a plain answer
    auto = Counter(kb.get("automation") for _, kb in recs)
    print("=== WHY: can AI handle it, or must it go further? ===")
    for k, n in auto.most_common():
        print(f"  {n:>4} ({100*n/total:4.1f}%)  {AUTOMATION_LABEL.get(k, k)}")

    # transfers = anything not ai_can_answer
    transfers = [(intent, kb) for intent, kb in recs if kb.get("automation") != "ai_can_answer"]
    nt = len(transfers)
    print(f"\nCalls that need to go to a person (now): {nt} ({100*nt/total:.1f}%)\n")

    # 2. WHO they route to
    route = Counter(kb.get("route_to") or "none" for _, kb in transfers)
    print("=== WHO: which team receives the call ===")
    for k, n in route.most_common():
        print(f"  {n:>4} ({100*n/nt:4.1f}%)  {k}")

    # 3. WHO x WHY (automation) + top intents + top question types + examples
    print("\n=== DETAIL PER TEAM (why it routes there) ===")
    by_route = defaultdict(list)
    for intent, kb in transfers:
        by_route[kb.get("route_to") or "none"].append((intent, kb))

    for team, items in sorted(by_route.items(), key=lambda x: -len(x[1])):
        print(f"\n--- {team}  (n={len(items)}) ---")
        a = Counter(kb.get("automation") for _, kb in items)
        print("  reason:", {k: a[k] for k in a})
        intents = Counter(i for i, _ in items)
        print("  top intents:", [f"{k} ({n})" for k, n in intents.most_common(4)])
        qtypes = Counter(kb.get("question_type") for _, kb in items)
        print("  top question types:")
        for qt, n in qtypes.most_common(6):
            print(f"      {n:>3}  {qt}")
        print("  example resolutions:")
        seen = 0
        for _, kb in items:
            hr = (kb.get("how_resolved") or "").strip()
            if hr:
                print(f"      - {hr[:130]}")
                seen += 1
            if seen >= 3:
                break


if __name__ == "__main__":
    main()
