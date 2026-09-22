"""Generate a small sample packing list so reviewers can try the app quickly.

Usage:
    python scripts/make_sample_data.py            # writes sample_packing_list.xlsx
    python scripts/make_sample_data.py out.xlsx

The layout matches the default "Supplier A" profile (split column C, item code
column B, three-column pack size, etc.).
"""

import sys

import openpyxl
from openpyxl.utils import column_index_from_string


def cell(row: list, letter: str, value) -> None:
    row[column_index_from_string(letter) - 1] = value


def build(path: str) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "PackingList"
    ws.append([f"COL_{c}" for c in "ABCDEFGHIJKLMNOPQRST"])  # header row

    samples = [
        # (split C, item B, desc D, color F, J,  K,  L,  ctn P, net Q, gross R)
        ("CARTON-001", "SKU-1001", "Ceramic Mug",   "WHITE", 12, 10, 9,  6, 3.1, 4.0),
        ("CARTON-001", "SKU-1002", "Ceramic Bowl",  "BLUE",  14, 14, 8,  6, 3.4, 4.3),
        ("CARTON-002", "SKU-2001", "Glass Vase",    "CLEAR", 20, 20, 35, 4, 5.2, 6.1),
        ("CARTON-002", "SKU-2002", "Glass Tumbler", "GREEN", 9,  9,  12, 4, 2.0, 2.8),
    ]
    for split, item, desc, color, j, k, l, p, q, r in samples:
        row = [None] * 20
        cell(row, "C", split)
        cell(row, "B", item)
        cell(row, "D", desc)
        cell(row, "F", color)
        cell(row, "J", j)
        cell(row, "K", k)
        cell(row, "L", l)
        cell(row, "P", p)
        cell(row, "Q", q)
        cell(row, "R", r)
        ws.append(row)

    wb.save(path)
    print(f"Wrote {path}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "sample_packing_list.xlsx")
