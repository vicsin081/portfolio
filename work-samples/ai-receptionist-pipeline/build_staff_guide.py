#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_staff_guide.py
====================
Turn the extracted call data into a NEW-STARTER RESPONSE GUIDE:
for each type of question, what the standard handling is + real examples of how
colleagues actually handled it on the phone.

Sources: knowledge_base.json (standard responses per question category) and
output/*.json (classification.intent/summary + kb.how_resolved real examples).
Writes docs/staff_faq.md. Pure local, no API.
"""

import json
import glob
import os
import random
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")
SUPPORT_EMAIL = "support@example.com"

ROUTE_LABEL = {
    "warehouse_stock": "Warehouse / stock",
    "delivery_freight": "Delivery / freight",
    "accounts_invoice": "Accounts / invoicing",
    "sales": "Sales",
    "support_aftersales": "After-sales / support",
    "manager": "a Manager",
    "specific_person": "the specific person / callback",
    "none": "",
}


def clean(text: str) -> str:
    if not text:
        return ""
    return (text.replace("[support email address]", SUPPORT_EMAIL)
                .replace("[support email]", SUPPORT_EMAIL)
                .replace("[sales email address]", "the sales team")
                .strip())


def main() -> None:
    kb = json.load(open(os.path.join(HERE, "knowledge_base.json"), encoding="utf-8"))

    # Real examples per intent (summary + how it was handled)
    examples = defaultdict(list)
    for f in glob.glob(os.path.join(OUT, "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        c = d.get("classification") or {}
        k = d.get("kb") or {}
        if c.get("intent") and k.get("how_resolved") and c.get("summary"):
            examples[c["intent"]].append((c["summary"].strip(), k["how_resolved"].strip()))

    lines = [
        "# Customer Call Response Guide (for new starters)",
        "",
        "Built from real call recordings. For each type of question you'll get on the phone, "
        "this shows the **standard way to handle it** and **real examples of how the team "
        "handled it**. Use it to learn the common questions and expected responses.",
        "",
        f"After-sales note: for damaged / faulty / wrong / missing items and returns, ask the "
        f"customer to email photos + their order number to **{SUPPORT_EMAIL}**. "
        "Warranty and change-of-mind returns: point them to the website (User Centre / Contact Us).",
        "",
        "---",
        "",
    ]

    for blk in kb.get("intents", []):
        intent = blk["intent"]
        lines.append(f"## {intent}  ({blk.get('total_calls', 0)} calls)")
        lines.append("")
        lines.append("**Standard responses:**")
        lines.append("")
        for c in blk.get("question_categories", []):
            route = ROUTE_LABEL.get(c.get("route_to", "none"), "")
            esc = f"  _(escalate to: {route})_" if route else ""
            lines.append(f"- **{c.get('category')}** — {clean(c.get('standard_solution'))}{esc}")
        lines.append("")

        exs = examples.get(intent, [])
        if exs:
            random.shuffle(exs)
            lines.append("**Real examples from calls:**")
            lines.append("")
            for summary, how in exs[:6]:
                lines.append(f"- *\"{summary}\"*")
                lines.append(f"  -> {clean(how)}")
            lines.append("")
        lines.append("---")
        lines.append("")

    path = os.path.join(HERE, "docs", "staff_faq.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"Wrote {path}")
    print(f"Intents: {len(kb.get('intents', []))}; example pool sizes: "
          + ", ".join(f"{k}={len(v)}" for k, v in examples.items()))


if __name__ == "__main__":
    main()
