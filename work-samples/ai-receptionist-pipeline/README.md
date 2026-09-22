# AI Phone-Receptionist Pipeline

A working AI phone-receptionist system built from real customer calls. The pipeline transcribes
and classifies call recordings, builds a knowledge base of standard responses from them, and uses
that knowledge in an LLM-driven triage engine that answers simple questions and routes every other
caller to the right team. Text and voice agents reproduce the behaviour planned for the
company's 3CX phone system.

| | |
|---|---|
| **Context** | Internal AI project, Excel Intelligent Pty Ltd |
| **Data** | 2,391 real call recordings from the company phone system |
| **Stack** | Python, Whisper Large V3 Turbo, Gemini 2.5 Flash (both through OpenRouter), edge-tts, fpdf2 |
| **Target platform** | 3CX AI receptionist (OpenAI Realtime) |
| **Status** | Pipeline complete; triage engine validated locally; 3CX configuration prepared |
| **Analysis log** | [ANALYSIS.md](ANALYSIS.md) |

---

## Overview

**Problem.** Every incoming call was answered by a person and often transferred by hand. There was
no data on why customers call, which calls could be answered without a person, or which team each
call should reach.

**Approach.** Instead of writing a receptionist script from assumptions, the design was derived
from the calls themselves:

1. **Transcribe** every recording and label who is speaking.
2. **Discover** the reasons people call, then fix an intent taxonomy.
3. **Classify** every conversation by intent, outcome and sentiment.
4. **Extract** how each type of question was handled and who handled it, and aggregate that into a
   knowledge base of standard responses.
5. **Decide** - a triage engine uses the knowledge base and company facts to answer, redirect or
   route each caller.
6. **Test** the engine locally through a text agent and a voice agent before moving it to 3CX.

**Result.** The analysis showed that 11 percent of calls can be answered from static facts, 51
percent need a live system lookup, and 38 percent need a person
(see [ANALYSIS.md](ANALYSIS.md)). The triage engine was built around that finding: answer the
static questions, collect details and route the rest to one of three groups, and hand the
receiving colleague a summary so the caller does not repeat themselves.

## Architecture

```
 call recordings (.wav)
        |
        v
+----------------+   Whisper (speech to text)
| transcript.py  |-- LLM (speaker labels, real conversation vs automated/empty)
+----------------+
        |  output/<call>.json   (metadata, raw transcript, labelled turns, status)
        v
+--------------------+
| explore_intents.py |-- 150-call sample -> free-form labels -> proposed taxonomy
+--------------------+
        |  intents_exploration.json -> fixed 11-intent taxonomy
        v
+----------------+
| classify.py    |-- intent, summary, resolution status, products, sentiment
+----------------+
        v
+----------------+     +-----------------+
| build_kb.py    |---->| aggregate_kb.py |-- knowledge_base.json
| per-call: how  |     | per intent:     |   (61 question categories, each with a
| resolved, who, |     | standard answer,|    standard response, automation level
| automation     |     | route           |    and route)
+----------------+     +-----------------+
                                |
          +---------------------+----------------------+
          v                     v                      v
+-------------------+  +--------------------+  +-----------------------+
| decision_engine.py|  | interactive_agent  |  | analyze*.py           |
| replay historical |  | text agent         |  | statistics            |
| calls, compare    |  | voice_agent.py     |  | build_staff_guide.py  |
| decisions         |  | mic->STT->brain->  |  | build_staff_pdf.py    |
+-------------------+  | TTS                |  | new-starter guide     |
                       +--------------------+  +-----------------------+
                                |
                                v
                  docs/3cx_setup.md - 3CX AI agent configuration
```

## Components

### Data pipeline

| Script | Step | Output |
|---|---|---|
| `transcript.py` | Transcribes each recording with Whisper, then uses an LLM to split speaker turns and mark the call as `conversation`, `short`, `automated` or `empty`. Resume-safe, with retry and back-off for rate limits | `output/<call>.json` |
| `explore_intents.py` | Labels a random sample of 150 conversations with free-form intents and asks the LLM to merge them into a taxonomy | `intents_exploration.json` |
| `classify.py` | Assigns each conversation one of 11 fixed intents, plus a summary, resolution status, products mentioned and sentiment | `classification` field per call |
| `build_kb.py` | For each call, extracts the question type, how it was resolved, the team it went to, and whether an AI could handle it | `kb` field per call |
| `aggregate_kb.py` | Collapses per-call question types into standard categories per intent, with a standard response, automation level and route | `knowledge_base.json` |

### Triage engine and agents

| Script | Purpose |
|---|---|
| `decision_engine.py` | Replays historical transcripts through the engine to check its decisions against what staff actually did |
| `interactive_agent.py` | Text version of the receptionist, following the final 3CX design |
| `voice_agent.py` | Voice version of the same engine: microphone with silence detection, Whisper, the shared engine, and an Australian edge-tts voice |

Each turn, the engine returns structured JSON with one action:

| Action | When | Result |
|---|---|---|
| `answer` | Hours, address, dispatch times, warranty and returns policy | Answer from `company_facts.json` only |
| `email` | Damaged, faulty, wrong or missing items, returns | Caller is asked to email photos and the order number; not transferred |
| `clarify` | Required detail missing, vague request, or a request for a specific person | One question, such as "Have you already placed an order, or are you enquiring about buying?" |
| `transfer` | All details collected | Route to **Sales** (before purchase), **Operations** (after purchase) or **Warehouse** (physical stock), with a handoff summary |

Guardrails written into the engine's instructions:

- Callers who have already bought are never routed to Sales.
- The engine never names the company, a department or an extension to the caller.
- A reply containing a question cannot also be a transfer, so no transfer happens with details missing.
- Requests that look like social engineering (for example, claims to be from a bank asking for
  account details) are refused and not routed.
- Replies are always in English; the caller's language is recorded in the handoff.

### Reporting

| Script | Purpose |
|---|---|
| `analyze.py` | Intent, resolution and sentiment distributions; intents least often resolved on the call |
| `analyze_transfers.py` | Why calls need a person and which team receives them |
| `build_staff_guide.py`, `build_staff_pdf.py` | Build the new-starter call response guide from the knowledge base and real examples |

## Repository contents

| Path | Contents |
|---|---|
| `*.py` | Pipeline, engine, agents and reports (described above) |
| `company_facts.json` | Static facts the engine may answer from: hours, address, policies, routing groups |
| `knowledge_base.json` | 10 intents, 61 question categories with standard responses, automation level and route |
| `intents_exploration.json` | Raw labels and the proposed taxonomy from the exploration step |
| `docs/3cx_setup.md` | Field-by-field configuration for the 3CX AI receptionist |
| `docs/future_api_requirements.md` | Nine system APIs that would let the AI answer lookup questions itself |
| `docs/staff_faq.md` | New-starter call response guide generated from the knowledge base |
| `ANALYSIS.md` | Findings from the call data and the design decisions they drove |

## Running the pipeline

### Prerequisites

- Python 3.10 or later
- An OpenRouter API key
- Your own call recordings (`.wav`); none are included

```bash
pip install requests
pip install sounddevice soundfile numpy edge-tts   # voice agent only
pip install fpdf2                                  # PDF guide only
```

### Steps

```powershell
$env:OPENROUTER_API_KEY = "<your key>"   # or set API_KEY in transcript.py

python transcript.py          # .wav files in this folder -> output/*.json
python explore_intents.py     # optional: propose an intent taxonomy
python classify.py            # add intent, outcome, sentiment
python build_kb.py            # per-call knowledge extraction
python aggregate_kb.py        # -> knowledge_base.json
python analyze.py             # statistics
python analyze_transfers.py
python build_staff_guide.py   # -> docs/staff_faq.md
```

Every LLM step skips calls it has already processed, so an interrupted run can be restarted
safely. The exploration, classification and extraction steps run eight requests in parallel. `classify.py`, `build_kb.py` and
`decision_engine.py` accept a number (for example `python classify.py 30`) to process a small
sample first.

### Try the receptionist

```bash
python interactive_agent.py   # type as the caller; 'reset' starts a new call, 'quit' exits
python voice_agent.py         # speak after the greeting; say "goodbye" to end
python decision_engine.py 12  # replay 12 random historical calls
```

The knowledge base and company facts in this repository are enough to run both agents without
any call data.

## Data handling and sanitisation

| Item | Treatment |
|---|---|
| Call recordings and transcripts | Excluded (`*.wav` and `output/` are in `.gitignore`); they contain customer conversations |
| Staff and customer names | Replaced with "a colleague" and "the customer" |
| Company, brand, address, email, phone numbers | Replaced with placeholders such as `Example Wholesale Co.` and `support@example.com` |
| API key | Removed; placeholder in `transcript.py` |
| Staff-level analysis | Not published |

The standard responses in `docs/staff_faq.md` are patterns aggregated from real calls, not an
approved company procedure.

## Limitations and next steps

- **Mono recordings.** Both parties share one audio channel, so speaker labels are inferred by the
  LLM from context rather than by audio diarisation.
- **Live lookups deferred.** Stock, delivery-cost and order-status questions (51 percent of
  calls) are routed to a person until the APIs in `docs/future_api_requirements.md` exist.
- **Model difference.** The local agents use Whisper, Gemini and edge-tts; 3CX uses OpenAI
  Realtime. Routing behaviour matches; voice quality and latency do not.
- **Screen pop.** The handoff summary is printed locally; passing it to the receiving agent in 3CX
  is a documented integration requirement.

## Skills demonstrated

| Area | Detail |
|---|---|
| Speech and LLM pipelines | Whisper transcription, LLM speaker labelling, structured JSON output with validation |
| Data analysis | Taxonomy discovery, classification at scale, quantified automation potential |
| Prompt engineering | Routing rules, guardrails and one-action-per-turn output for a live voice agent |
| Reliability | Resume-safe batch processing, retry with exponential back-off, parallel workers |
| Systems integration | Mapping a prototype to 3CX AI receptionist configuration and routing groups |
| Privacy | Excluding PII and anonymising all published material |

## Related documents

- [ANALYSIS.md](ANALYSIS.md) - findings from 2,391 calls and the design decisions they drove
- [docs/3cx_setup.md](docs/3cx_setup.md) - 3CX configuration
- [docs/future_api_requirements.md](docs/future_api_requirements.md) - planned system APIs
- [Work samples overview](../README.md)
