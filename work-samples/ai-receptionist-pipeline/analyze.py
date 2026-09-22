#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze.py
==========
Summarize the step-2 classification results across output/*.json.
Pure local read -- no API calls.
"""

import json
import glob
import os
from collections import Counter, defaultdict

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


def main() -> None:
    intent_c = Counter()
    res_c = Counter()
    sent_c = Counter()
    intent_res = defaultdict(Counter)   # intent -> resolution counts
    products = Counter()
    total = 0

    for f in glob.glob(os.path.join(OUT, "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        c = d.get("classification")
        if not c:
            continue
        total += 1
        intent_c[c.get("intent")] += 1
        res_c[c.get("resolution_status")] += 1
        sent_c[c.get("sentiment")] += 1
        intent_res[c.get("intent")][c.get("resolution_status")] += 1
        for p in c.get("products", []):
            products[p.lower()] += 1

    print(f"TOTAL classified: {total}\n")

    print("=== INTENT ===")
    for k, n in intent_c.most_common():
        print(f"  {n:>4} ({100*n/total:4.1f}%)  {k}")

    print("\n=== RESOLUTION STATUS ===")
    for k, n in res_c.most_common():
        print(f"  {n:>4} ({100*n/total:4.1f}%)  {k}")

    print("\n=== SENTIMENT ===")
    for k, n in sent_c.most_common():
        print(f"  {n:>4} ({100*n/total:4.1f}%)  {k}")

    print("\n=== INTENTS MOST OFTEN NOT RESOLVED ON THE CALL ===")
    # share of follow_up_needed + unresolved + transferred per intent
    rows = []
    for intent, rc in intent_res.items():
        n = sum(rc.values())
        unfinished = rc["follow_up_needed"] + rc["unresolved"] + rc["transferred"]
        rows.append((unfinished / n, n, intent))
    for share, n, intent in sorted(rows, reverse=True):
        print(f"  {100*share:4.1f}% unfinished  (n={n:>4})  {intent}")

    print("\n=== TOP PRODUCTS MENTIONED ===")
    for p, n in products.most_common(20):
        print(f"  {n:>4}  {p}")


if __name__ == "__main__":
    main()
