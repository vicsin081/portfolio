# Work Samples

Three projects I designed and built at Excel Intelligent Pty Ltd, an Australian wholesale and
e-commerce business: two internal tools for staff and one customer-facing store feature.

| | |
|---|---|
| **Employer** | Excel Intelligent Pty Ltd |
| **Languages** | Python, JavaScript, Shopify Liquid |
| **Status** | Sanitised copies of working projects |

---

## Projects

| Project | Problem | Solution | Documentation |
|---|---|---|---|
| [Shipping Mark Generator](shipping-mark-generator/) | Packing lists from three suppliers arrive in three different Excel layouts; carton labels were built by hand | Windows desktop app that converts any supplier layout into uniform, barcode-stamped, print-ready workbooks | [README](shipping-mark-generator/README.md) - [Engineering log](shipping-mark-generator/ENGINEERING-LOG.md) |
| [AI Phone-Receptionist Pipeline](ai-receptionist-pipeline/) | Incoming calls were answered and transferred manually with no data on why customers call | Pipeline that transcribes and classifies real calls, builds a knowledge base, and drives an LLM triage engine for 3CX call routing | [README](ai-receptionist-pipeline/README.md) - [Analysis log](ai-receptionist-pipeline/ANALYSIS.md) |
| [Shopify 3D Garage Builder](shopify-3d-garage-builder/) | Customers could not see or price a combination of modular storage components before buying | Shopify section with a Three.js configurator: swap items or sets live, see price and dimensions, add the bundle to cart | [README](shopify-3d-garage-builder/README.md) - [Engineering log](shopify-3d-garage-builder/ENGINEERING-LOG.md) |

### Shipping Mark Generator

Windows desktop application (Python, Tkinter, openpyxl) that turns supplier packing lists into
uniform shipping-mark workbooks. Each supplier has an editable field-mapping profile that
non-technical staff can change without code. Barcode images are fetched concurrently, and the
tool ships as a single `.exe` built with PyInstaller.

### AI Phone-Receptionist Pipeline

End-to-end system built from 2,391 real call recordings: Whisper transcription, LLM
classification against an 11-intent taxonomy, a knowledge base of standard responses, and a
triage engine that routes callers to Sales, Operations or Warehouse. Includes text and voice
agent prototypes and a ready-to-paste configuration for the 3CX AI receptionist.

### Shopify 3D Garage Builder

Interactive 3D configurator built as a Shopify Online Store 2.0 section (Liquid, vanilla
JavaScript, Three.js). Customers start from a preset layout, swap single components or linked sets
in a live WebGL scene, see price and overall dimensions update, and add the whole configuration to
the cart as one bundle. Layouts and swap rules are data, editable without code changes.

---

## Sanitisation

These are demonstration copies. The code and structure are unchanged in substance; identifying
details have been removed.

| Removed or replaced | Replacement |
|---|---|
| Company, brand and supplier names | `Example Wholesale Co.`, `Acme Storage`, `Supplier A/B/C`, `a partner brand` |
| Product SKUs | Neutral placeholders such as `MOD-...` and `SKU-...` |
| Internal API endpoints | `example.com` placeholders |
| Addresses, emails, phone numbers | Placeholder values |
| API keys | `PUT-YOUR-OPENROUTER-API-KEY-HERE` |
| Staff and customer names | "a colleague", "the customer" |
| Call recordings and transcripts | Not included (customer personal data) |
| Supplier packing lists | Not included; a script generates demo data instead |
| 3D models and store product data | Not included; the configurator shows placeholder blocks without them |

Aggregate statistics in the analysis log were produced from the original data; no individual
call content is published.
