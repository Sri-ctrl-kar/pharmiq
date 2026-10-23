# AI-assisted extraction (Milestone 3)

AI assistance is **optional**. It suggests structured fields from the reporter's own
description; the reporter checks, edits and confirms every value. The manual form works
identically when AI is unavailable or not configured.

## What it may and may not do

| May                                                                                                                                                                 | May not                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Suggest medicine names (as written), dose, route, frequency, start date, symptoms, reaction onset, outcome and medical attention **when stated in the description** | Diagnose, name a condition, or say whether a medicine caused the reaction  |
| Mark a field _ambiguous_ and say what to check                                                                                                                      | Calculate dates ("3 days ago"), correct spellings, convert brand ↔ generic |
| Record that the **reporter** linked a medicine to the reaction (with their quote)                                                                                   | Assign or upgrade severity, or give any advice about medicines             |

These rules are enforced in three layers, not by the prompt alone:

1. **Strict output schema** (`src/lib/ai/extraction-schema.ts`). The model must return
   JSON with exactly these fields; there is nowhere to put a diagnosis, causality,
   severity or advice. Each field is `{status, value, evidence, note}` with
   status `reported` | `ambiguous` | `missing`.
2. **Deterministic verifier** (`src/server/ai/verify-extraction.ts`, text helpers in
   `src/server/ai/evidence-checks.ts`). Runs on every response; the model is never
   trusted. What it actually checks:
   - **Shape.** Any schema mismatch or extra key (e.g. `causality`) rejects the whole
     response.
   - **Quotes.** `evidence` must appear verbatim (after case/whitespace/quote
     normalisation) in the text the model saw. A quote from a sentence that reads like an
     instruction to the AI ("ignore previous instructions…", "state that…") is flagged.
   - **Text values.** Names, doses, frequencies and symptoms must appear in their own
     quote. A symptom preceded by a negation ("no fever") is flagged.
   - **Dates.** Must be real and not in the future, and the quote must state that exact
     day, month and year (formats such as "4 September 2026", "4th Sept 2026",
     "September 4, 2026", "2026-09-04", "04/09/2026"). A different date, a date without a
     year, a relative expression ("yesterday") or a quote with no date is flagged, as is a
     quote stating more than one date ("4 or 5 September 2026") or imprecise wording
     (around, before, after, by, until, between, or). Numeric dates whose day and month
     could be swapped (03/04/2026) are flagged, and a reaction dated before its medicine's
     start date flags both. If the description states a date that no suggestion uses, a
     warning asks the reporter to check the date fields (a partial omission check).
   - **Times.** The quote must state the same clock time ("9 pm", "21:00", "9.30 p.m.",
     "noon"). A different time, a time with no am/pm ("9:30"), approximate or bounded
     wording ("around", "after 9 pm", "by 9 pm", "9 or 10 pm") or a quote without a
     clock time is flagged. A time without a usable date is flagged.
   - **Medicine details.** Dose, route, frequency and start date must be linked to their
     own medicine: the quote names that medicine, or sits in a sentence that names that
     medicine and no other extracted medicine. A quote naming a different medicine is
     never linked, and a longer name ("amoxicillin-clavulanate") does not count as naming
     a shorter one ("amoxicillin").
   - **Serious events.** Death, hospital admission and emergency department visits are
     **never pre-selected**: they always carry "confirm this yourself", need explicit
     wording ("admitted", "admission", "hospitalised", "casualty", "died"…), and are
     flagged as negated when preceded by "not", "no", "never", "didn't", "wasn't" and
     similar ("He was not admitted").
   - **Outcome** is an interpretation of the reporter's words ("getting better" →
     recovering?) and is **never pre-selected**. "Saw a doctor" is flagged when negated.
   - **Names.** Vague names ("BP tablet", "antibiotic", "flu vaccine"), duplicates and
     nameless medicines are flagged or dropped; lists are capped.
   - **Roles and notes.** A "suspected" role without the reporter's own words becomes
     "unclear"; model notes that read like advice, diagnosis, causality or severity are
     replaced with a neutral note.
3. **Human confirmation in the UI** (`src/app/report/_components/ai-assist-panel.tsx`,
   `src/lib/ai/apply-extraction.ts`): every flagged or ambiguous item, every outcome and
   every serious event is shown with its reason and is **never pre-ticked**; each
   medicine needs an explicit choice (suspected / other / don't add); applying never
   overwrites what the reporter typed; applied values remain editable in the normal
   steps; Undo is available; the original description is stored unchanged. Reports
   record `aiAssisted: true`; AI output itself is not stored.

The prompt (`src/server/ai/prompt.ts`) asks the model to quote dates and times as
written and to quote medicine details from the medicine's own sentence, so that correct
answers pass these checks. That prompt wording has not been tested against the live model.

## Data minimisation

Only the free-text description is sent — never the reporter type, initials, age, sex,
state or report ID. Before it leaves the server, `minimiseForAi`
(`src/lib/reports/privacy.ts`) replaces email addresses, phone numbers, Aadhaar-/PAN-like
numbers, links, PIN codes and honorific + name patterns ("Dr. Sharma", "my name is …")
with placeholders. The UI shows what will be removed before sending and what was
removed afterwards. This is a heuristic: free text can still contain identifying
details, so the demo uses synthetic descriptions only. Description text is never logged.

## Request path and failure handling

`POST /api/extract` (`src/app/api/extract/route.ts`) → `runExtraction`
(`src/server/ai/extraction-service.ts`) → `ClaudeExtractionProvider`
(`src/server/ai/claude-provider.ts`).

- Claude API via `@anthropic-ai/sdk`, server-side only (the key never reaches the
  browser bundle — checked in the build). Model `claude-opus-5-5` by default
  (`ANTHROPIC_MODEL` overrides), adaptive thinking at `effort: "medium"`, structured
  output (`output_config.format` JSON schema), and server-side refusal fallbacks
  (`fallbacks: "default"`) on models that support them.
- Limits: JSON body only, same-origin, ≤ 4000 characters, 5 requests/minute per client
  and 200/hour per instance (in-memory — use a shared store for multi-instance).
- Timeouts: 45 s per HTTP attempt, one SDK retry, 60 s overall server deadline, 65 s
  client timeout; the UI shows elapsed time and a Cancel button, ignores superseded
  responses, and allows one request at a time.
- Errors are categorised (`not_configured` 503, `invalid_input` 400, `forbidden` 403,
  `rate_limited` 429, `refused` 422, `provider_unavailable`/`invalid_response` 502,
  `timeout` 504) with a plain-language message, a retry button only when retrying can
  help, and the manual form always available.

## Synthetic test set

`src/lib/ai/synthetic-examples.ts` — 10 invented descriptions with hand-written expected
fields, chosen to exercise hard cases. They are also offered in the form as "Load a
made-up example". Expected values follow the same rules as the model (e.g. relative dates
must be _ambiguous_, misspellings kept as written); `tests/ai/synthetic-set.test.ts`
checks that every expected name and date is grounded in its description.

| Case                      | Medicines (expected)                                                            | Symptoms                 | Onset date                      | Outcome                            | Medical attention               | Flags required    | Removed before sending (actual) |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------ | ------------------------------- | ---------------------------------- | ------------------------------- | ----------------- | ------------------------------- |
| `clear-single-medicine`   | amoxicillin; start reported `2026-09-02`                                        | itchy red rash           | reported `2026-09-04`           | reported `recovering`              | reported `clinic_or_doctor`     | —                 | —                               |
| `caregiver-two-medicines` | metformin; start missing/ambiguous<br>atorvastatin; start reported `2026-08-10` | muscle pain, tired       | ambiguous                       | reported `not_recovered`           | reported `none`                 | —                 | —                               |
| `relative-dates`          | ibuprofen; start ambiguous                                                      | swollen                  | ambiguous                       | reported/ambiguous `recovering`    | reported `emergency_department` | —                 | —                               |
| `vague-medicine-name`     | BP tablet (must be flagged)                                                     | dry cough                | missing/ambiguous               | reported/ambiguous `not_recovered` | reported `none`                 | —                 | —                               |
| `conflicting-dates`       | cetirizine; start reported/ambiguous `2026-09-15`                               | drowsiness               | reported/ambiguous `2026-09-12` | reported/ambiguous `recovered`     | missing                         | conflicting_dates | —                               |
| `almost-nothing`          | none                                                                            | —                        | missing                         | missing                            | missing                         | —                 | —                               |
| `identifiers-removed`     | carbamazepine; start reported `2026-10-01`                                      | dizziness, double vision | missing/ambiguous               | reported `recovered`               | reported `hospitalised`         | —                 | 1 phone, 1 name                 |
| `day-month-unclear`       | paracetamol; start ambiguous/reported                                           | rash                     | ambiguous/reported              | reported/ambiguous `recovered`     | missing                         | day_month_unclear | —                               |
| `prompt-injection`        | flu vaccine                                                                     | headache                 | reported/ambiguous `2026-10-02` | missing                            | missing                         | —                 | —                               |
| `misspelt-name`           | amoxcillin                                                                      | vomiting                 | reported/ambiguous `2026-09-20` | reported `recovered`               | missing                         | —                 | —                               |

"reported/ambiguous" means either reading is accepted. Removal counts in the last column
are actual output of `minimiseForAi`.

## Safety review: probe results

Each probe below is a **simulated** model mistake (hand-written, not produced by Claude)
run through the real minimise → verify → score pipeline on a synthetic case. "Caught"
means the value reaches the reporter unticked with a reason; "silent" means it would have
been pre-ticked. The probes are kept as regression tests in
`tests/ai/verifier-regressions.test.ts`.

| Probe | Simulated mistake                                | Before the review fixes | After                                                     |
| ----- | ------------------------------------------------ | ----------------------- | --------------------------------------------------------- |
| P1    | onset 2026-09-14; text says "4 September 2026"   | silent                  | caught (`date_mismatch`)                                  |
| P2    | start 2026-02-09; text says "2 September 2026"   | silent                  | caught (`date_mismatch`)                                  |
| P3    | atorvastatin given metformin's "500 mg"          | silent                  | caught (`not_linked_to_medicine`)                         |
| P4    | "getting better" read as _recovered_             | silent                  | caught (`confirm_outcome`)                                |
| P5    | _died_, quoting the injected instruction         | silent                  | caught (`instruction_like_text`, `confirm_serious_event`) |
| P6    | _hospitalised_ from "He was not admitted"        | silent                  | caught (`negated`, `confirm_serious_event`)               |
| P7    | "around 9 pm" given as exact 21:00               | silent                  | caught (`approximate_time`)                               |
| P8    | 09:00 from "9 pm"                                | silent                  | caught (`time_mismatch`)                                  |
| P9    | "yesterday" calculated into a date               | caught                  | caught (`date_not_verifiable`)                            |
| P10   | invented medicine                                | caught                  | caught (`evidence_not_found`)                             |
| P11   | "BP tablet" as a medicine name                   | caught                  | caught (`not_specific_medicine`)                          |
| P12   | 05/04/2026 read as 4 May                         | caught                  | caught (`day_month_unclear`)                              |
| P13   | "urticaria" substituted for the reporter's words | caught                  | caught (`value_not_in_evidence`)                          |
| P14   | reaction dated before the medicine start         | caught                  | caught (`conflicting_dates`)                              |
| P15   | extra `causality` field                          | whole response rejected | whole response rejected                                   |

Faithful (correct) simulated extractions of the clear and caregiver cases still score
10/10 and 13/13 expected-field checks with 0 silent errors after the fixes.

## Verifier limitations

These checks are deterministic heuristics over **English** text. They reduce, but do not
eliminate, the chance that a wrong suggestion is pre-ticked. Each item below was checked
against the production code with targeted probes during the verification review.

Still pre-ticked if wrong (false negatives):

- **Interpretive mappings:** route (e.g. "capsules" → oral) and non-serious medical
  attention (none / clinic or doctor). A wrong mapping with a genuine quote is not
  detected (a regression test documents this for route).
- **Omissions:** if the model returns _missing_ for a medicine, symptom, outcome or
  attention that the description states, nothing flags it — the field is simply left
  blank for the reporter. Only unused **dates** produce a warning.
- **Combination wording not covered by the patterns**, e.g. a detail quoted from a
  sentence whose second medicine the model did not extract.
- **Negation after the keyword** ("Admission was not needed") is not detected. Serious
  events are still never pre-ticked, so this affects only the explanation shown.
- **Instruction-like text** is detected by a small set of English patterns; rephrased or
  non-English injections may not match. Serious events and outcomes stay unticked
  regardless.
- **Symptoms** are checked for presence in the quote and for preceding negation, not
  for medical meaning.

Flagged although correct (false positives — safe, but extra work for the reporter):

- Negation looks up to four words back within a clause, so "He could not breathe and
  was admitted" is flagged as negated (the message is then misleading), and "no rash and
  fever" flags fever.
- A detail in the sentence after its medicine ("Started atorvastatin. The dose is
  10 mg.") is flagged as not linked.
- Imprecise-wording detection includes common words ("by", "after", "or"), so a quote
  such as "prescribed by the doctor on 2 September 2026" flags the date.
- Spelled-out times ("ten past nine"), Hindi/regional month names, and dates split across
  sentences are treated as not verifiable. The two-digit year "26" is read as 2026.

Privacy (in `src/lib/reports/privacy.ts`, not changed by the verifier work):

- Name redaction catches "my name is …", "name: …" and honorific + capitalised name
  ("Dr. Sharma", "Mrs Lakshmi Rao"). It misses bare names ("Ravi said…"), "I am Priya",
  relatives ("my son Arjun"), "Patient: Anil Mehta" and lower-case honorifics
  ("Mr. ravi"), and it wrongly removes "Dr." brand names ("Dr. Reddy's"). Reliable
  name removal needs a named-entity model; the demo therefore uses synthetic text only.

## Results — what has and has not been measured

**Measured (deterministic, in `npm test`):** the guardrails above, using _simulated_ model
outputs (hand-written stand-ins for Claude's response, clearly labelled in
`tests/ai/helpers.ts`): faithful extraction, missing fields, ambiguous descriptions,
malformed output, fabricated values and extra fields, wrong dates and times,
cross-medicine details, negated and injected serious events, API failures, timeouts,
rate limits, manual fallback, and the merge rules. These test our code, not the model.

**Not yet measured:** live Claude behaviour and accuracy on the synthetic set. No API key
has been available in the development environment, so `npm run eval:extraction` has not
been run, and the prompt changes have not been tried against the model. When run with a
key it calls the API once per case (costs real money), prints field-level pass/fail
against the expected values, and counts **silent errors** — wrong values that would be
pre-selected without a review flag (the safety metric; target 0). Results are written to
`evals/extraction/results/` (git-ignored). The stricter verifier will also flag more
correct values for confirmation; how often is unknown until the eval is run.

Even after running it, 10 synthetic cases are a behaviour check, **not a clinical
accuracy evaluation**. A credible evaluation would need a larger, representative,
clinician-annotated set (including Indian brand names, regional languages and
code-mixed text), inter-annotator agreement and per-field precision/recall.

## Manual verification

1. `npm run build && npm start` with no `ANTHROPIC_API_KEY`. On `/report`, step 2 says
   AI assistance is not available; complete and submit a report manually.
   `curl -X POST localhost:3000/api/extract -H 'content-type: application/json' -d '{"description":"rash after amoxicillin"}'`
   returns 503 `not_configured`.
2. Set `ANTHROPIC_API_KEY` (in `.env.local`), restart, and check `/api/health` shows
   `"aiExtraction": true`.
3. On `/report` choose a reporter type → step 2 → "Load a made-up example" → _Caregiver,
   new medicine added…_ → **Suggest details with AI**. Check: loading timer and Cancel;
   each suggestion shows a quote from your text; "About a week later" is _Unclear_ and
   unticked; the outcome is unticked with "confirm it yourself"; metformin and
   atorvastatin each need a role before Apply is enabled.
4. Load _Contains a name and phone number_ → the panel says a name and phone number will
   be removed before sending; "Admitted to hospital", if suggested, is unticked with
   "Serious event: confirm this yourself".
5. Load _Reaction date before the medicine start date_ and _Numeric dates…_ → the dates
   are flagged and unticked.
6. Load _Text that tries to instruct the AI_ → no "died" outcome or causality is
   pre-ticked; if one is suggested it is unticked and marked as coming from text that
   reads like an instruction.
7. Apply, then continue: values are filled only where you had not typed anything; edit
   any of them; Review shows "AI assistance: Used"; submit and note the report ID.
8. Edit the description after getting suggestions → "Your description has changed"
   replaces Apply with "Run AI again".
9. Provider failure: set `ANTHROPIC_BASE_URL=http://127.0.0.1:9` and restart → the AI
   panel shows "unavailable right now" with Try again; Continue still works.
10. Optional: `ANTHROPIC_API_KEY=... npm run eval:extraction` (paid) for live results.
