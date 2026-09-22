#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_staff_pdf.py
==================
Render the new-starter response guide as a PDF (staff_faq.pdf), from the same
sources as build_staff_guide.py (knowledge_base.json + output/*.json). No API.
"""

import json
import glob
import os
import random
from collections import defaultdict
from fpdf import FPDF
from fpdf.enums import XPos, YPos

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")
SUPPORT_EMAIL = "support@example.com"

ROUTE_LABEL = {
    "warehouse_stock": "Warehouse / stock", "delivery_freight": "Delivery / freight",
    "accounts_invoice": "Accounts / invoicing", "sales": "Sales",
    "support_aftersales": "After-sales / support", "manager": "a Manager",
    "specific_person": "the specific person / callback", "none": "",
}
_REP = [("→", "->"), ("’", "'"), ("‘", "'"), ("“", '"'),
        ("”", '"'), ("–", "-"), ("—", "-"), ("…", "..."), ("•", "-")]


def asc(s):
    if not s:
        return ""
    for a, b in _REP:
        s = s.replace(a, b)
    s = (s.replace("[support email address]", SUPPORT_EMAIL)
          .replace("[support email]", SUPPORT_EMAIL)
          .replace("[sales email address]", "the sales team"))
    return s.encode("latin-1", "replace").decode("latin-1").strip()


class PDF(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")


def line(pdf, txt, h=5, indent=0):
    if indent:
        pdf.set_x(pdf.l_margin + indent)
    pdf.multi_cell(0, h, asc(txt), new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def main():
    kb = json.load(open(os.path.join(HERE, "knowledge_base.json"), encoding="utf-8"))
    examples = defaultdict(list)
    for f in glob.glob(os.path.join(OUT, "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        c = d.get("classification") or {}
        k = d.get("kb") or {}
        if c.get("intent") and k.get("how_resolved") and c.get("summary"):
            examples[c["intent"]].append((c["summary"], k["how_resolved"]))

    pdf = PDF()
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    line(pdf, "Customer Call Response Guide", h=9)
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(90)
    line(pdf, "For new starters. Built from real call recordings: the standard way to handle "
              "each type of question, plus real examples of how the team handled it.")
    pdf.ln(1)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(0)
    line(pdf, f"After-sales note: damaged / faulty / wrong / missing items and returns -> ask "
              f"the customer to email photos + order number to {SUPPORT_EMAIL}. Warranty and "
              f"change-of-mind returns -> point to the website (User Centre / Contact Us).")
    pdf.ln(3)

    for blk in kb.get("intents", []):
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 60, 120)
        line(pdf, f"{blk['intent']}  ({blk.get('total_calls', 0)} calls)", h=7)
        pdf.set_text_color(0)
        pdf.ln(1)

        pdf.set_font("Helvetica", "B", 10)
        line(pdf, "Standard responses")
        for c in blk.get("question_categories", []):
            route = ROUTE_LABEL.get(c.get("route_to", "none"), "")
            pdf.set_font("Helvetica", "B", 9.5)
            line(pdf, f"- {c.get('category')}" + (f"   (escalate to: {route})" if route else ""))
            pdf.set_font("Helvetica", "", 9.5)
            line(pdf, c.get("standard_solution"), indent=4)
        pdf.ln(1)

        exs = examples.get(blk["intent"], [])
        if exs:
            random.shuffle(exs)
            pdf.set_font("Helvetica", "B", 10)
            line(pdf, "Real examples from calls")
            for summary, how in exs[:6]:
                pdf.set_font("Helvetica", "I", 9)
                line(pdf, f'"{summary}"')
                pdf.set_font("Helvetica", "", 9)
                line(pdf, f"-> {how}", indent=4)
            pdf.ln(2)

    path = os.path.join(HERE, "staff_faq.pdf")
    pdf.output(path)
    print(f"Wrote {path}  ({os.path.getsize(path)} bytes, {pdf.page_no()} pages)")


if __name__ == "__main__":
    main()
