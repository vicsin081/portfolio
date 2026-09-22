# Engineering Log - Shipping Mark Generator

How the tool developed from a single-supplier script to a configurable desktop application: the
analysis behind each version, the problems found, and the decisions taken. Each problem entry
follows the same format: symptom, root cause, resolution, verification, lesson.

## Version history

| Version | Form | Scope | Main change |
|---|---|---|---|
| v1 | Command-line script, one file | One supplier layout, columns hard-coded | Automated label building and barcode insertion |
| v2 | Desktop application, layered package | Three suppliers, editable profiles | Per-supplier field mapping, GUI, executable packaging |
| v3 | Desktop application | Three suppliers, any layout | One field resolver accepting all four input formats in every field |

## Summary of problems

| # | Problem | Category | Resolution | Version |
|---|---|---|---|---|
| 1 | Only one supplier layout supported | Requirements | Per-supplier mapping profiles | v2 |
| 2 | Non-technical users could not run or change the script | Usability | GUI, Settings tab, single-file executable | v2 |
| 3 | A new worksheet for every row with a value in the split column | Logic defect | Start a new sheet only when the value changes | v2 |
| 4 | Worksheet names could break Excel's naming rules | Robustness | Sanitise and de-duplicate sheet names | v2 |
| 5 | Output font not available on Windows | Portability | Switched to a standard Windows font | v2 |
| 6 | Generation would block the UI thread | Usability | Background worker thread with a message queue | v2 |
| 7 | Each field accepted only one input format | Usability | Unified `resolve_field()` with automatic format detection | v3 |

---

## Starting analysis

**Current process.** For each shipment, staff opened the supplier's packing list, copied nine
values per product line into a label template, looked up each barcode, and pasted the image next
to the label. A single shipment can have dozens of product lines.

**Supplier layouts.** The three suppliers provide the same information in different ways:

| Label field | Variation between suppliers |
|---|---|
| Item code, description | Different column in each layout |
| Pack size | Three separate dimension columns in one layout; a single pre-formatted column in the others |
| Colour | One column in two layouts; split across two columns in the third |
| Carton count, weights | Different columns in each layout |
| Grouping | A different column identifies which rows belong to the same carton group |
| Colour on repeated rows | Often left blank when unchanged from the previous row |

**Conclusion.** The output label is fixed, and every difference is a question of where each
value comes from and how it is combined. That makes the problem a mapping problem: describe each
supplier as data (a profile), not as code.

---

## Problem 1 - Only one supplier layout supported

**Symptom.** v1 read fixed column positions (`row[1]`, `row[9]`, `row[15]` and so on) matching the
first supplier. A packing list from either of the other suppliers produced wrong labels.

**Root cause.** Column positions and formatting rules were written into the code.

**Resolution.** Introduced a profile per supplier in `config.py`. Each profile maps the nine label
fields to a column letter, a combination of columns, or a template. The engine reads only the
profile, so adding a supplier means adding a profile, not changing code.

**Verification.** The same engine produces the standard nine-field label from each of the three default profiles.

**Lesson.** When inputs vary but the output is fixed, move the variation into configuration.

---

## Problem 2 - Non-technical users could not run or change the script

**Symptom.** v1 was started from a terminal and asked for the file path and PO number with
`input()`. Any change to a supplier's layout needed a developer.

**Root cause.** The tool assumed a user with Python installed and the ability to edit code.

**Resolution.**

- A Tkinter interface with one tab per supplier: Browse, PO number, Generate.
- A Settings tab listing every mapped field with a hint, plus Save, Reset profile and Reset all.
- Settings saved to `shipping_mark_settings.json` beside the executable, so they persist and
  travel with the application.
- A single-file `ShippingMark.exe` built with PyInstaller, so no Python installation is needed.

**Verification.** The full workflow - select file, enter PO, generate, remap a field - needs no terminal, Python installation or code edit.

**Lesson.** A tool is finished only when its real users can run and maintain it on their own.

---

## Problem 3 - A new worksheet for every row with a value in the split column

**Symptom.** In v1, a new worksheet started whenever the split column had any value, including
the same value as the previous row, so rows that belonged together landed on separate sheets.

**Root cause.** The condition was `if data['colC'] or current_sheet is None`, which tests whether
the cell has a value rather than whether the value changed.

**Resolution.** The engine tracks the last split value and starts a new sheet only when the value
changes. Blank or repeated values keep stacking forms on the current sheet.

```python
if sheet is None:
    sheet = self._new_sheet(workbook, unique_sheet_name(split_key or f"Sheet_{index}", used_names))
elif split_key is not None and split_key != last_split:
    sheet = self._new_sheet(workbook, unique_sheet_name(split_key, used_names))
```

**Verification.** The generated demo file (`scripts/make_sample_data.py`) has four rows in two
carton groups and produces exactly two worksheets, `CARTON-001` and `CARTON-002`.

**Lesson.** Grouping logic should compare against the previous state, not just test for presence.

---

## Problem 4 - Worksheet names could break Excel's naming rules

**Symptom.** v1 used the raw split value as the worksheet name.

**Root cause.** Excel sheet names must be at most 31 characters, cannot contain `[ ] : * ? / \`,
and must be unique regardless of case. Supplier values are not guaranteed to follow these rules.

**Resolution.** `unique_sheet_name()` replaces invalid characters, truncates to 31 characters, and
adds a numeric suffix when a name is already used.

**Verification.** Values containing slashes, over-long values and repeated values all produce valid,
unique sheet names.

**Lesson.** Treat any external value used as an identifier as untrusted input.

---

## Problem 5 - Output font not available on Windows

**Symptom.** v1 set the label font to a macOS system font (PingFang SC). That font is not installed
on Windows, where the labels are printed, so Excel would substitute a different font with different
character widths.

**Root cause.** The font was chosen on the development machine, not the target machines.

**Resolution.** Changed the default to Arial 11 and moved all styling constants to `config.py`.

**Verification.** Arial ships with every Windows installation, so the label renders the same on any office machine.

**Lesson.** Test output on the machines and printers that will actually use it.

---

## Problem 6 - Keeping the UI responsive during generation

**Symptom.** Moving from a script to a GUI meant that a run with dozens of barcode downloads would
block the window and look like a crash if it ran on the UI thread.

**Root cause.** Tkinter processes events on its main thread; any long network call there blocks the
event loop.

**Resolution.**

- Generation runs on a background worker thread.
- Progress messages are sent through a queue that the UI polls, since Tkinter widgets must only be
  updated from the main thread.
- Barcode images are prefetched with a five-worker thread pool and cached by SKU, so repeated SKUs
  are downloaded once.
- A failed lookup is logged and skipped rather than stopping the run.

**Verification.** The progress log updates live during generation. With the barcode service
unreachable, the demo file still produced a complete workbook without images.

**Lesson.** Keep slow I/O off the UI thread, and let a partial failure degrade the output rather than
stop it.

---

## Problem 7 - Each field accepted only one input format

**Symptom.** In v2, each field supported one format: colour allowed merged columns, pack size and
carton number allowed templates, carton-per-piece allowed literal text only, and the rest allowed
a single column. A template typed into a column-only field was read as a column reference and
produced an empty value, with no error.

**Root cause.** The engine used a different helper for each field (`column_value`,
`render_template`, `render_color`), so the accepted format depended on which field was edited.

**Resolution.** Replaced the per-field helpers with a single `resolve_field()` that detects the
format from the value itself:

| Order | Detected when | Result |
|---|---|---|
| 1 | Contains a `{COL}` token | Template: substitute column values and keep surrounding text |
| 2 | Every `+`-separated part is a column letter | Single or merged columns |
| 3 | Anything else | Literal text |

Every field, including the worksheet split and item code, now goes through `resolve_field()`.

**Verification.** For a row `('a', 'x', 'y', None, 'Red')`:

| Input | Output |
|---|---|
| `B` | `x` |
| `B+E` | `x Red` |
| `{A} size {C}` | `a size y` |
| `1PCS OF 1 CTN` | `1PCS OF 1 CTN` |

**Lesson.** A consistent rule across all fields is easier for users than a set of per-field rules,
even when each rule makes sense on its own.
