"""Configuration: output styling, vendor profiles, and settings persistence.

All vendor-specific behaviour lives in *profiles*. A profile maps each output
field of the shipping-mark form to a source location in the supplier workbook,
using one of four input formats (see ``FIELD_SPECS`` hints / the README):

    1. Single column      ->  ``B``        (a column letter)
    2. Merged columns      ->  ``I+J``      (join non-empty values with a space)
    3. Template            ->  ``{J}CM X {K}CM``   (substitute ``{COL}`` values)
    4. Literal text        ->  ``1PCS OF 1 CTN``   (used verbatim)

Profiles are fully editable at runtime and persisted to a JSON file next to the
executable, so non-technical users can adapt to a new supplier layout without
touching the code.
"""

from __future__ import annotations

import json
import os
import sys

# --------------------------------------------------------------------------- #
# Output styling (shared by every profile so the result is visually identical)
# --------------------------------------------------------------------------- #
FONT_NAME = "Arial"
FONT_SIZE = 11
FONT_BOLD = False

COL_A_WIDTH = 40
COL_B_WIDTH = 40
ROW_HEIGHT = 24.75

IMAGE_COLUMN = "D"
IMAGE_HEIGHT_MULTIPLIER = 1.33

FORM_START_ROW = 5
EMPTY_ROWS_AFTER_FORM = 7

# --------------------------------------------------------------------------- #
# Barcode service
# --------------------------------------------------------------------------- #
# Sanitised placeholder. Point this at your own barcode endpoint via the
# SHIPPING_MARK_BARCODE_API environment variable. The endpoint is expected to
# accept a POST field ``skuList`` and return a ZIP archive containing a PNG.
BARCODE_API_URL = os.environ.get(
    "SHIPPING_MARK_BARCODE_API",
    "https://barcode.example.com/api/generate",
)
BARCODE_MAX_WORKERS = 5
BARCODE_TIMEOUT = 10  # seconds

# --------------------------------------------------------------------------- #
# Vendor profiles (example data — rename / re-map freely in the Settings tab)
# --------------------------------------------------------------------------- #
DEFAULT_PROFILES: dict[str, dict[str, str]] = {
    "Supplier A": {
        "sheet_col": "C",
        "item_code_col": "B",
        "description_col": "D",
        "pack_size_tpl": "{J}CM X {K}CM X {L}CM",
        "color_col": "F",
        "ctn_per_pcs": "1PCS OF 1 CTN",
        "ctn_no_tpl": "     OF {P}",
        "gross_wt_col": "R",
        "net_wt_col": "Q",
    },
    "Supplier B": {
        "sheet_col": "A",
        "item_code_col": "B",
        "description_col": "D",
        "pack_size_tpl": "{F}",
        "color_col": "E",
        "ctn_per_pcs": "1PCS OF 1 CTN",
        "ctn_no_tpl": "     OF {G}",
        "gross_wt_col": "J",
        "net_wt_col": "K",
    },
    "Supplier C": {
        "sheet_col": "B",
        "item_code_col": "B",
        "description_col": "F",
        "pack_size_tpl": "{M}",
        "color_col": "I+J",
        "ctn_per_pcs": "1PCS OF 1 CTN",
        "ctn_no_tpl": "     OF {G}",
        "gross_wt_col": "O",
        "net_wt_col": "N",
    },
}

PROFILES = list(DEFAULT_PROFILES.keys())

# Settings-tab fields: (key, label, hint)
FIELD_SPECS = [
    ("sheet_col",       "Worksheet split column", "e.g. C  (rows sharing a value land on the same sheet)"),
    ("item_code_col",   "ITEM CODE column",       "e.g. B  (also used to fetch the barcode image)"),
    ("description_col", "DESCRIPTION column",     "e.g. D"),
    ("pack_size_tpl",   "PACK SIZE",              "e.g. {F}  or  {J}CM X {K}CM X {L}CM"),
    ("color_col",       "COLOR column",           "e.g. E  or  I+J  (merged)"),
    ("ctn_per_pcs",     "CTN PER PCS",            "literal text, e.g. 1PCS OF 1 CTN"),
    ("ctn_no_tpl",      "CTN NO.",                "e.g.      OF {P}"),
    ("gross_wt_col",    "GROSS WT column",        "e.g. R  (\" KG\" is appended automatically)"),
    ("net_wt_col",      "NET WT column",          "e.g. Q  (\" KG\" is appended automatically)"),
]

SETTINGS_FILENAME = "shipping_mark_settings.json"


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #
def base_dir() -> str:
    """Directory of the executable (frozen) or the project root (source)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def settings_path() -> str:
    return os.path.join(base_dir(), SETTINGS_FILENAME)


def load_profiles() -> dict[str, dict[str, str]]:
    """Return profiles with any saved overrides merged over the defaults."""
    profiles = {name: dict(cfg) for name, cfg in DEFAULT_PROFILES.items()}
    path = settings_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
            for name in PROFILES:
                if isinstance(saved.get(name), dict):
                    profiles[name].update(
                        {k: v for k, v in saved[name].items() if k in profiles[name]}
                    )
        except (OSError, ValueError) as exc:  # pragma: no cover - defensive
            print(f"Could not read settings, using defaults: {exc}")
    return profiles


def save_profiles(profiles: dict[str, dict[str, str]]) -> None:
    with open(settings_path(), "w", encoding="utf-8") as fh:
        json.dump(profiles, fh, ensure_ascii=False, indent=2)
