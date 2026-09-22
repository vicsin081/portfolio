# Analysis Log - AI Phone-Receptionist Pipeline

Findings from the company's real call recordings and the design decisions they led to. All figures
were produced by the scripts in this folder (`analyze.py`, `analyze_transfers.py`,
`aggregate_kb.py`) from the original data. Only aggregate results are published.

## Summary

| # | Finding | Figure | Design decision |
|---|---|---|---|
| 1 | Only three in four recordings are real conversations | 1,897 of 2,391 | Filter automated and empty calls before analysis |
| 2 | Calls concentrate in four intents | 63 percent in the top four | Knowledge base built per intent |
| 3 | Most calls are not finished on the first call | 65 percent not resolved on the call | Target the receptionist at routing, not only answering |
| 4 | Few calls can be answered from static facts | 10.7 percent | Answer only from verified company facts |
| 5 | The largest group needs a live system lookup | 51.4 percent | Route to a person now; specify APIs for later |
| 6 | Many callers ask for a specific person | 18.1 percent of escalations | Ask one "bought or not" question and route by the answer |
| 7 | Eight escalation destinations collapse into three groups | Sales, Operations, Warehouse | Three routing groups in 3CX |
| 8 | After-sales problems follow a fixed process | 3.6 percent, all by email | Handle by email instructions, do not transfer |

---

## Method

### Data funnel

| Stage | Calls | Notes |
|---|---|---|
| Recordings processed by `transcript.py` | 2,391 | Mono WAV files from the phone system |
| Automated or system answer | 435 | IVR messages, voicemail, no two-way conversation |
| Empty | 58 | Silence or ringing only |
| Internal test | 1 | Excluded |
| **Real conversations (`conversation` + `short`)** | **1,897** | **Classified by `classify.py`** |
| Conversations with a customer intent | 1,765 | Excludes `Other / Unclear`; processed by `build_kb.py` |

### Taxonomy

`explore_intents.py` labelled a random sample of 150 conversations with free-form intents, which
produced 98 distinct labels. These were merged into a fixed taxonomy of 11 intents used by
`classify.py` for every call. Fixing the taxonomy before classifying made the counts comparable
across all 1,897 calls.

### Knowledge base

`build_kb.py` extracted, for each call, the specific question, how staff resolved it, which team
it went to, and an automation level. `aggregate_kb.py` merged these into 61 question categories
across 10 intents:

| Automation level | Categories | Meaning |
|---|---|---|
| `ai_needs_system_lookup` | 48 | Answerable only with live stock, price or order data |
| `ai_can_answer` | 8 | Answerable from static company facts |
| `must_transfer_human` | 5 | Needs a person (disputes, negotiation, complex complaints) |

---

## Finding 1 - Only three in four recordings are real conversations

**Evidence.** 494 of 2,391 recordings (21 percent) were automated messages, empty or test calls.

**Implication.** Counting every recording would overstate call volume and distort intent shares.

**Decision.** `transcript.py` records a status for every call so nothing is lost, but only
`conversation` and `short` calls go on to classification.

---

## Finding 2 - Calls concentrate in four intents

**Evidence.** Intent distribution across 1,897 conversations:

| Intent | Calls | Share |
|---|---|---|
| Callback & Specific Contact | 335 | 17.7% |
| Product Info & Availability | 318 | 16.8% |
| Delivery & Pickup | 291 | 15.3% |
| Quotes & Pricing | 253 | 13.3% |
| Order Status & Modification | 179 | 9.4% |
| Order Placement | 162 | 8.5% |
| Other / Unclear | 132 | 7.0% |
| Payments & Refunds | 100 | 5.3% |
| Showroom & Viewing | 80 | 4.2% |
| Complaint / Issue | 39 | 2.1% |
| Returns & Exchanges | 8 | 0.4% |

Sentiment was neutral in 68.5 percent of calls, positive in 21.7 percent and negative in 9.8 percent.
The most frequently mentioned products were sheds and carports (110 mentions each), followed by
garden sheds (54).

**Implication.** Four intents account for 63 percent of conversations; complaints and returns are
rare by phone.

**Decision.** The knowledge base is organised by intent so the most common call types have the
most detailed standard responses.

---

## Finding 3 - Most calls are not finished on the first call

**Evidence.** Resolution status across 1,897 conversations:

| Status | Calls | Share |
|---|---|---|
| Resolved on the call | 642 | 33.8% |
| Follow-up needed | 578 | 30.5% |
| Unresolved | 420 | 22.1% |
| Transferred | 239 | 12.6% |
| Unknown | 18 | 0.9% |

Share of calls not finished on the call (follow-up, unresolved or transferred), by intent:

| Intent | Calls | Not finished |
|---|---|---|
| Returns & Exchanges | 8 | 100.0% |
| Complaint / Issue | 39 | 94.9% |
| Callback & Specific Contact | 335 | 85.4% |
| Quotes & Pricing | 253 | 81.8% |
| Product Info & Availability | 318 | 78.0% |
| Order Status & Modification | 179 | 61.5% |
| Payments & Refunds | 100 | 53.0% |
| Order Placement | 162 | 46.9% |
| Delivery & Pickup | 291 | 44.7% |
| Other / Unclear | 132 | 40.9% |
| Showroom & Viewing | 80 | 35.0% |

**Implication.** For most intents the first person to answer cannot finish the call. A receptionist
that only answers questions would help with a minority of calls.

**Decision.** The receptionist's main job is to collect the right details and route the caller once,
correctly, with a summary for the colleague who picks up.

---

## Finding 4 - Few calls can be answered from static facts

**Evidence.** Of 1,765 conversations with a customer intent, 189 (10.7 percent) could be answered
from static information: opening and pickup hours, address, dispatch times, returns and warranty
policy.

**Implication.** The value of answering directly is real but limited, and a wrong answer given
with confidence costs more than a transfer.

**Decision.** The engine may answer only from `company_facts.json`. If a fact is missing, it says a
colleague will help rather than guessing.

---

## Finding 5 - The largest group needs a live system lookup

**Evidence.**

| Reason the call goes beyond a simple answer | Calls | Share |
|---|---|---|
| Needs a live system lookup (stock, price, delivery cost, order status) | 908 | 51.4% |
| Needs a person (complaint, dispute, specific person) | 668 | 37.8% |
| AI can answer from static facts | 189 | 10.7% |

In total, 89.3 percent of conversations currently need a person, including system lookups.

**Implication.** Half of all demand could be automated, but only if the AI can query company
systems. 3CX function calling to internal systems was not confirmed.

**Decision.** The `system_lookup` action was removed from the engine for the first release; these
calls are transferred with their details. The nine APIs that would automate them are specified in
[docs/future_api_requirements.md](docs/future_api_requirements.md); the highest-value two are the
stock check and the delivery-cost quote.

---

## Finding 6 - Many callers ask for a specific person

**Evidence.** Where the call went after the first answer (1,576 escalated conversations):

| Destination | Share | Main reasons |
|---|---|---|
| Handled in line by the same person | 48.7% | Looked up delivery quotes, stock or order status during the call |
| Specific person or callback | 18.1% | Repeat customers asking for the colleague who helped before |
| Sales | 12.2% | Quotes, specifications, placing or changing orders |
| Delivery and freight | 5.5% | Delivery cost and delivery dates |
| Warehouse and stock | 5.5% | Stock availability, pickup readiness |
| Manager | 3.7% | Price disputes, discount approval |
| Support and after-sales | 3.6% | Damaged, missing or faulty items |
| Accounts and invoices | 2.8% | Refund status, payment confirmation, balances |

**Implication.** Nearly one escalation in five is a request for a named person. An AI receptionist
cannot connect to "the person I spoke to last week", and asking repeated questions frustrates
repeat customers.

**Decision.** When a caller insists on a specific person or will not explain the need, the engine
asks one question: "Have you already placed an order, or are you enquiring about buying?" Not yet
bought goes to Sales; already bought goes to Operations. No caller is dropped.

---

## Finding 7 - Eight escalation destinations collapse into three groups

**Evidence.** The destinations in Finding 6 split cleanly by the caller's stage:

| Caller stage | Destinations in the data | Routing group |
|---|---|---|
| Before purchase | Sales, manager (negotiation), specific person (new enquiry) | **Sales** |
| After purchase | Delivery and freight, accounts, order status, specific person (existing order) | **Operations** |
| Physical stock | Warehouse and stock | **Warehouse** |

**Implication.** Callers do not know the internal team structure, and routing to eight destinations
increases the chance of a wrong transfer.

**Decision.** The 3CX configuration uses three routing groups. The engine applies a hard rule that
an after-purchase caller is never routed to Sales, and never names a department to the caller.

---

## Finding 8 - After-sales problems follow a fixed process

**Evidence.** Support and after-sales calls were 3.6 percent of escalations, and the standard
response the knowledge base extracted for them was a single fixed process: email photos of the damage and the order number to the support
address before using the item.

**Implication.** Transferring these calls adds no value; the colleague would give the same
instruction.

**Decision.** Complaints, damaged, faulty, wrong or missing items and returns use a dedicated
`email` action: the engine gives the instruction and records the details without transferring.
Warranty and change-of-mind questions are answered by directing the caller to the website.

---

## Outputs produced from this analysis

| Output | Purpose |
|---|---|
| `knowledge_base.json` | Standard response, automation level and route for 61 question categories |
| `company_facts.json` | The only facts the engine may state |
| Triage engine rules (`interactive_agent.py`) | Actions, routing groups and guardrails from Findings 4-8 |
| [docs/3cx_setup.md](docs/3cx_setup.md) | 3CX AI receptionist configuration |
| [docs/future_api_requirements.md](docs/future_api_requirements.md) | APIs to automate the 51 percent lookup demand |
| [docs/staff_faq.md](docs/staff_faq.md) | New-starter call response guide with real, anonymised examples |

## Limitations

- **LLM labelling.** Intents, outcomes and automation levels were assigned by an LLM at
  temperature 0 against a fixed schema, with invalid values mapped to `Other / Unclear` or
  `unknown`. Individual labels can be wrong; the figures are best read as proportions, not exact
  counts.
- **Mono audio.** Speaker turns were inferred from context, so a small share of turns may be
  attributed to the wrong speaker.
- **Sample period.** 99 percent of the recordings are from late May to mid June 2026, so seasonal
  patterns (for example, more delivery calls at peak times) are not captured.
