# Shipping Mark Generator

Windows desktop application that converts supplier packing lists into uniform, barcode-stamped,
print-ready shipping-mark workbooks. Each supplier sends the same information in a different
Excel layout; the tool maps every layout to one standard carton label without any code changes.

| | |
|---|---|
| **Context** | Internal automation tool, Excel Intelligent Pty Ltd |
| **Users** | Import and warehouse staff (non-technical) |
| **Stack** | Python 3.9+, Tkinter, openpyxl, Pillow, requests, `concurrent.futures`, PyInstaller |
| **Distribution** | Single-file Windows executable (`ShippingMark.exe`), no Python install needed |
| **Status** | In use; sanitised copy |
| **Engineering log** | [ENGINEERING-LOG.md](ENGINEERING-LOG.md) |

---

## Overview

**Problem.** Every import shipment needs a shipping mark (carton label) for each product line:
PO number, item code, description, carton dimensions, colour, carton count, weights and a
barcode. Three suppliers sent packing lists with this data in different columns and formats, so
staff copied values across by hand and pasted barcode images one at a time.

**Solution.** The staff member picks the supplier tab, selects the packing list, enters the PO
number and clicks Generate. The tool reads each row, maps it to the standard label using that
supplier's profile, fetches all barcode images in parallel, and saves a formatted workbook
grouped into one worksheet per carton group.

**Result.** A manual copy-and-paste task became a one-click operation with consistent output,
and a new or changed supplier layout is handled by editing a mapping in the Settings tab.

## Architecture

```
+------------------+      +-------------------+      +----------------------+
|  gui.py          |      |  engine.py        |      |  barcode.py          |
|  Tkinter UI      |----->|  ShippingMark-    |----->|  BarcodeClient       |
|  supplier tabs,  |      |  Generator        |      |  thread-safe cache,  |
|  Settings tab,   |      |  field mapping,   |      |  ZIP/PNG validation  |
|  worker thread   |      |  sheet grouping,  |      +----------+-----------+
+--------+---------+      |  layout, images   |                 |
         |                +---------+---------+                 | HTTP POST (parallel)
         |                          |                           v
         |                +---------v---------+      +----------------------+
         +--------------->|  config.py        |      |  Barcode service     |
                          |  styles, default  |      |  (returns ZIP + PNG) |
                          |  profiles, JSON   |      +----------------------+
                          |  settings file    |
                          +-------------------+

Input: supplier packing list (.xlsx)  -->  Output: shipping-mark workbook (.xlsx)
```

The code is split by responsibility: `config` holds data and persistence, `barcode` handles
network I/O, `engine` holds the domain logic with no UI dependency, and `gui` handles
presentation only.

## Key features

| Feature | Detail |
|---|---|
| Per-supplier profiles | One tab per supplier; each maps source columns to the standard label independently |
| No-code field mapping | Settings tab to remap any field, save, and reset one or all profiles to defaults |
| Four input formats in every field | Single column, merged columns, template or literal text, detected automatically |
| Worksheet grouping | Consecutive rows with the same split value share a worksheet; a new value starts a new one |
| Colour carry-forward | A blank colour cell inherits the previous row's colour, matching how suppliers fill lists |
| Concurrent barcode fetching | Images are fetched in parallel (5 workers) and cached by SKU before the workbook is built |
| Fault tolerance | A failed barcode lookup is logged and skipped; the workbook is still produced |
| Responsive UI | Generation runs on a background thread with a live progress log |
| Portable settings | Custom mappings are saved to `shipping_mark_settings.json` next to the executable |

## Output

Each source row becomes one labelled form, repeated down the worksheet:

```
PO NO.:        PO-12345
ITEM CODE:     SKU-1001
DESCRIPTION:   CERAMIC MUG
PACK SIZE:     12CM X 10CM X 9CM
COLOR:         WHITE
CTN PER PCS:   1PCS OF 1 CTN
CTN NO.:           OF 6
GROSS WT:      4.0 KG
NET WT:        3.1 KG
MADE IN PRC                      [ barcode image ]
```

## Field mapping

Every field accepts any of the four formats:

| Format | Meaning | Example |
|---|---|---|
| Single column | Value of one column | `B`, `F`, `AA` |
| Merged columns | Non-empty values joined with a space | `I+J` |
| Template | `{COL}` replaced by that column's value; other text kept | `{J}CM X {K}CM X {L}CM`, `OF {P}` |
| Literal text | Used as written | `1PCS OF 1 CTN` |

Default profiles (all editable at runtime):

| Field | Supplier A | Supplier B | Supplier C |
|---|---|---|---|
| Worksheet split | `C` | `A` | `B` |
| Item code | `B` | `B` | `B` |
| Description | `D` | `D` | `F` |
| Pack size | `{J}CM X {K}CM X {L}CM` | `{F}` | `{M}` |
| Colour | `F` | `E` | `I+J` |
| Carton number | `OF {P}` | `OF {G}` | `OF {G}` |
| Gross / net weight | `R` / `Q` | `J` / `K` | `O` / `N` |

The carton-number template is stored with leading spaces (`"     OF {P}"`) so that each label
leaves room to write the carton sequence number by hand.

## Repository contents

```
shipping-mark-generator/
|-- app.py                     Entry point and PyInstaller target
|-- shipping_mark/
|   |-- __main__.py            Enables `python -m shipping_mark`
|   |-- config.py              Styles, default profiles, settings persistence
|   |-- barcode.py             Thread-safe barcode client with caching
|   |-- engine.py              Workbook generation: mapping, grouping, layout, images
|   `-- gui.py                 Tkinter UI: supplier tabs and Settings tab
|-- scripts/
|   `-- make_sample_data.py    Generates a demo packing list
|-- requirements.txt           Runtime dependencies
|-- requirements-dev.txt       Adds PyInstaller
|-- build.bat, run.bat, Makefile
|-- README.md
`-- ENGINEERING-LOG.md
```

## Running the application

### Prerequisites

- Python 3.9 or later on Windows (Tkinter is included with the standard installer)

### Run from source

```bash
pip install -r requirements.txt
python scripts/make_sample_data.py sample_packing_list.xlsx   # optional demo input
python -m shipping_mark
```

On Windows, `run.bat` does the same. In the app: choose a supplier tab, click **Browse** to
select the packing list, enter the **PO number**, click **Generate**, and choose where to save.

### Build the executable

```bash
pip install -r requirements-dev.txt
pyinstaller --noconfirm --onefile --windowed --name ShippingMark app.py
# Output: dist/ShippingMark.exe
```

Or run `build.bat` on Windows, or `make build`.

### Configuration

| Setting | Location | Default |
|---|---|---|
| Barcode service endpoint | `SHIPPING_MARK_BARCODE_API` environment variable | `https://barcode.example.com/api/generate` (placeholder) |
| Font, column widths, spacing | `shipping_mark/config.py` | Arial 11, column width 40 |
| Field mappings | Settings tab at runtime | See the table above |

The barcode service is expected to accept a POST field `skuList` and return a ZIP archive
containing a PNG. If it is unreachable, the forms are still generated without images.

## Sanitisation

Supplier names are replaced with `Supplier A/B/C`, the internal barcode endpoint with an
`example.com` placeholder, and the column mappings in the default profiles are illustrative. The
production build used a Chinese-language interface for the warehouse team; this copy uses English.

## Skills demonstrated

| Area | Detail |
|---|---|
| Requirements analysis | Reduced three supplier formats to one configurable mapping model |
| Software design | Layered package with UI-independent domain logic |
| Usability | Mapping changes by non-technical staff without developer involvement |
| Concurrency | Thread pool for network I/O, background worker thread with a queue for UI updates |
| Excel automation | openpyxl formatting, merged cells, embedded images, sheet-name rules |
| Packaging | PyInstaller single-file executable with settings stored beside it |

## Related documents

- [ENGINEERING-LOG.md](ENGINEERING-LOG.md) - problem analysis, design decisions and version history
- [Work samples overview](../README.md)
