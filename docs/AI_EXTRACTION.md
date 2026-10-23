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
2. **Deterministic verifier** (`src/server/ai/verify-extraction.ts`). Runs on every
   response; the model is never trusted:
   - any schema mismatch or extra key (e.g. `causality`) rejects the whole response;
   - `evidence` must appear verbatim in the text the model saw, and values must appear in
     their quote (names, doses, frequencies, symptoms);
   - dates must be real, not in the future, have the year written, and not be
     day/month-ambiguous (03/04/2026); reaction-before-medicine dates are flagged;
   - "died", "admitted to hospital", "emergency department" need explicit wording;
   - vague names ("BP tablet", "antibiotic", "flu vaccine"), duplicates and nameless
     medicines are flagged or dropped; lists are capped;
   - a "suspected" role without the reporter's own words becomes "unclear";
   - model notes that read like advice, diagnosis, causality or severity are replaced.
3. **Human confirmation in the UI** (`src/app/report/_components/ai-assist-panel.tsx`,
   `src/lib/ai/apply-extraction.ts`): ambiguous or flagged items are shown with the
   reason and are **never pre-ticked**; each medicine needs an explicit choice
   (suspected / other / don't add); applying never overwrites what the reporter typed;
   applied values remain editable in the normal steps; Undo is available; the original
   description is stored unchanged. Reports record `aiAssisted: true`; AI output itself
   is not stored.

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

## Results — what has and has not been measured

**Measured (deterministic, in `npm test`):** the guardrails above, using _simulated_ model
outputs (hand-written stand-ins for Claude's response, clearly labelled in
`tests/ai/helpers.ts`): faithful extraction, missing fields, ambiguous descriptions,
malformed output, fabricated values and extra fields, API failures, timeouts, rate limits,
manual fallback, and the merge rules. These test our code, not the model.

**Not yet measured:** live Claude accuracy on the synthetic set. No API key was available
in the development environment, so `npm run eval:extraction` has not been run. When run
with a key it calls the API once per case (costs real money), prints field-level
pass/fail against the expected values, and counts **silent errors** — wrong values that
would be pre-selected without a review flag (the safety metric; target 0). Results are
written to `evals/extraction/results/` (git-ignored).

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
   unticked; metformin and atorvastatin each need a role before Apply is enabled.
4. Load _Contains a name and phone number_ → the panel says a name and phone number will
   be removed before sending.
5. Load _Reaction date before the medicine start date_ and _Numeric dates…_ → the dates
   are flagged and unticked.
6. Load _Text that tries to instruct the AI_ → no "died" outcome or causality appears.
7. Apply, then continue: values are filled only where you had not typed anything; edit
   any of them; Review shows "AI assistance: Used"; submit and note the report ID.
8. Edit the description after getting suggestions → "Your description has changed"
   replaces Apply with "Run AI again".
9. Provider failure: set `ANTHROPIC_BASE_URL=http://127.0.0.1:9` and restart → the AI
   panel shows "unavailable right now" with Try again; Continue still works.
10. Optional: `ANTHROPIC_API_KEY=... npm run eval:extraction` (paid) for live results.
