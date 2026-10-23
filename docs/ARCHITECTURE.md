# ADR Connect India — Architecture & Delivery Plan

> HEALTHX 2026 hackathon MVP. AI-assisted adverse drug reaction (ADR) reporting,
> tracking and analytics. **Not** an official PvPI system and not integrated with
> PvPI, CDSCO or any regulator.

## 1. Guiding constraints

| Constraint                                | How the architecture enforces it                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never diagnose or claim causality         | AI prompts are extraction-only; AI output schema has no "cause"/"diagnosis" fields; UI copy says "suspected" and "reported". Causality assessment is a reviewer-only field, recorded as a professional opinion.                                     |
| Never advise stopping/changing medication | Fixed safety notice on every reporting step; AI system prompt forbids advice; output is validated against a strict Zod schema so free-form advice text is dropped.                                                                                  |
| Never invent clinical information         | AI must return `null` for anything not stated, plus a verbatim `evidence` quote per extracted item. Extracted values are _suggestions_ the reporter must confirm; nothing is saved unconfirmed.                                                     |
| Protect personal/medical data             | Supabase Row Level Security on every table; reporter identity stored separately from clinical content; minimal PII (initials, age band, sex, state); service-role key used server-side only; AI calls send the narrative only, not contact details. |
| Synthetic data for the demo               | The public dashboard reads a fixed, versioned synthetic dataset and never report storage; the reviewer overview charts only `is_synthetic` records. Every chart is labelled "Synthetic demonstration data". See `docs/ANALYTICS.md`.                |
| Secrets in env vars                       | Validated by `src/lib/env.ts`; `.env*` is git-ignored; `.env.example` documents names only.                                                                                                                                                         |

## 2. System architecture

```
Browser (Next.js App Router, React 19, Tailwind v4)
   │  Server Components render pages; Client Components only for interactive form steps & charts
   ▼
Next.js server (Node runtime)
   ├─ Server Actions ── submit report, confirm extraction, reviewer status changes
   ├─ Route Handlers ── /api/extract (AI), /api/health
   ├─ proxy.ts ─────── refreshes the Supabase auth cookie on /reviewer (not authorisation)
   ├─ Data Access Layer (src/server/*) ── every DB read/write; re-checks auth & role
   └─ AI service (src/server/ai/*) ── Claude API via @anthropic-ai/sdk, optional
          │                               falls back to "manual entry" when key absent
          ▼
Supabase
   ├─ Postgres (reports, medicines, reactions, reviews, audit log) with RLS
   └─ Auth (email magic link / password for reviewers; anonymous submit allowed)
```

Key decisions:

- **Next.js 16 App Router with Cache Components** (scaffold default). Public pages
  are static shells; anything reading the session sits behind `<Suspense>`.
- **Server Actions + Zod** for all mutations. The same Zod schema validates the
  client form, the server action and the AI output.
- **AI is optional.** If `ANTHROPIC_API_KEY` is unset the form works fully manually.
  AI suggestions are never auto-saved.
- **Report IDs** are human-readable (`ADR-2026-XXXXXX`, Crockford base32) generated
  in Postgres, separate from the internal UUID primary key.
- **Roles**: `reporter` (default / anonymous), `reviewer`, `admin`, stored in
  `profiles.role` and enforced in RLS policies _and_ the DAL.

## 3. Dependencies

Installed in the foundation milestone:

| Package                                              | Purpose                                    |
| ---------------------------------------------------- | ------------------------------------------ |
| `next@16`, `react@19`, `typescript`                  | App framework                              |
| `tailwindcss@4`                                      | Styling, design tokens via `@theme`        |
| `@supabase/supabase-js`, `@supabase/ssr`             | DB + Auth clients (server & browser)       |
| `zod@4`                                              | Env, form, action and AI-output validation |
| `clsx`, `tailwind-merge`, `class-variance-authority` | Component variant styling                  |
| `lucide-react`                                       | Icons                                      |
| `vitest`                                             | Unit tests                                 |
| `prettier`, `prettier-plugin-tailwindcss`            | Formatting                                 |

Added in M3: `@anthropic-ai/sdk` — Claude API (server-side only).

Added in M2: `@electric-sql/pglite` (dev) — in-process Postgres used by the test suite to
apply the real migration and verify RLS and `submit_report`.

Added in later milestones (not yet installed):

| Package              | Milestone | Purpose                                                          |
| -------------------- | --------- | ---------------------------------------------------------------- |
| ~~`recharts`~~       | M5        | Not needed: charts are server-rendered HTML with table fallbacks |
| `@playwright/test`   | M6        | End-to-end tests in CI                                           |
| `supabase` CLI (dev) | M4        | Local stack, type generation                                     |

## 4. File structure

```
.
├── docs/ARCHITECTURE.md
├── supabase/
│   ├── migrations/               ← SQL migrations (reports, RLS, submit_report, review_report)
│   └── seed.sql                  ← SYNTHETIC demo records
├── src/
│   ├── app/
│   │   ├── report/               ← guided reporting flow + server action (M2)
│   │   │   └── _components/      ← steps, review, confirmation
│   │   ├── dashboard/            ← public synthetic analytics dashboard (M5)
│   │   ├── reviewer/             ← reviewer overview, queue, report detail, sign-in, actions (M4)
│   │   ├── design-system/        ← living style guide
│   │   ├── api/health/route.ts   ← config + storage mode (no values)
│   │   └── api/extract/route.ts  ← AI suggestions (M3)
│   ├── components/{ui,layout,safety,charts}/
│   ├── lib/
│   │   ├── reports/              ← shared: constants, Zod schema, missing info, report ID, privacy
│   │   ├── ai/                   ← extraction contract, apply rules, synthetic examples
│   │   ├── review/               ← status transitions, queue filters/sort, analytics, timeline
│   │   ├── analytics/            ← public analytics: de-identified projection, filters, buckets
│   │   ├── env-schema.ts, site.ts, utils.ts
│   └── server/                   ← server-only
│       ├── env.ts
│       ├── reports/              ← repository contract, local demo + Supabase adapters, submit service
│       ├── auth/                 ← reviewer auth mode, demo session cookie, access resolution
│       ├── review/               ← review repository contract, Supabase adapter, action handlers
│       ├── analytics/            ← the public synthetic dataset (never reads report storage)
│       └── ai/                   ← prompt, Claude provider, verifier, rate limit, service
├── evals/extraction/             ← live eval runner + scorer (needs API key)
└── tests/                        ← vitest unit + Postgres (PGlite) tests
```

## 5. Data model and storage (implemented in M2)

The source of truth is `supabase/migrations/20261023000000_reports.sql`; the application
shape is `ReportContent` in `src/lib/reports/schema.ts`.

| Table              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reports`          | One row per report: `public_id` (`ADR-YYYY-XXXXXX`, unique, format-checked), `idempotency_key` (unique), `submitted_at`, `status` (`submitted` → `under_review` → `needs_info` / `reviewed` → `closed`), `reporter_type`, de-identified patient fields (initials, age, sex, state), reaction description in the reporter's words, onset date/time, outcome, medical attention, other medicines, medical history, `missing_fields[]`, `is_synthetic`. |
| `report_medicines` | 1–10 medicine entries per report (`position`, name, brand, strength, dose, route, frequency, start/end date, course status, previous dose/frequency and change date, manufacturer, batch, expiry month, how details were checked, `is_suspected`), `on delete cascade`, unique `(report_id, position)`. `reports.suspected_selection` is `marked` or `not_sure`.                                                                                     |
| `profiles`         | `role` (`reporter` / `reviewer` / `admin`) per `auth.users` row.                                                                                                                                                                                                                                                                                                                                                                                     |

Integrity and unknown values:

- Every optional field is nullable and `null` means "not provided". Enumerated answers that
  are required (outcome, medical attention) have an explicit `unknown` value. Nothing is
  defaulted or inferred.
- `missing_fields` records which clinically useful fields were blank or "not known" at
  submission (`findMissingInformation`).
- Check constraints mirror the Zod limits (lengths, age 0–120, ID format, onset time
  requires a date, medicine count 1–5).

Write path and access control:

```
Browser ─ Server Action ─ handleReportSubmission ─ submitReport (Zod validation,
          missing-info, report ID + collision retry, idempotency)
                              └─ ReportRepository
                                   ├─ SupabaseReportRepository ─ rpc submit_report (service role)
                                   └─ LocalDemoReportRepository ─ .data/demo-reports.json
```

- `submit_report(jsonb)` is `security definer`, executable **only by `service_role`**. It
  re-validates (dates not in the future, medicine count, idempotency key present), forces
  `status = 'submitted'` and `is_synthetic = false`, inserts the report and medicines in
  one transaction, and returns the existing report for a repeated idempotency key.
- `anon` and `authenticated` have no insert/update/delete on any table (Supabase's
  default grants are revoked). Authenticated users with `reviewer`/`admin` role can read
  reports via RLS; users read only their own profile and cannot change their role.
- Storage selection (`src/server/reports/storage.ts`): all three Supabase variables set →
  Supabase; none set → local demo store; partially set → submission disabled (fails
  closed).
- The local demo store is a plain JSON file: not encrypted, no access control, no
  backups. It is labelled as such in the UI, the file and the docs.

Deviations from the original draft: reporter contact details (`report_contacts`) are not
collected yet — the form asks for no names, phone numbers or addresses. `report_reviews` and
`audit_log` arrive with the milestones that use them. `ai_extractions` (storing raw AI
output) was dropped by design: only the reporter-confirmed values and an `ai_assisted`
flag are stored. M3 added `reaction_symptoms text[]` and `ai_assisted`.

M6 added (`supabase/migrations/20261026000000_medicine_entries.sql`) structured medicine
entries: the columns above, `medicine_course_status` and `product_detail_source` enums,
integrity checks (end ≥ start; no end date while "still taking"; previous dose/frequency
and change date only with "dose changed"; batch and expiry formats) and a replaced
`submit_report` that accepts `medicines` (1–10) plus `suspected_selection`, rejecting
"marked" with no suspected medicine and "not_sure" with any. Earlier rows are backfilled
as suspected (the earlier form listed only suspected medicines); new rows must state
`is_suspected`. The function still accepts the older `suspected_medicines` key. Stored
local-demo content in the old shape is normalised on read
(`normaliseReportContent`).

M4 added (`supabase/migrations/20261025000000_reviewer_workflow.sql`):

- `report_status_events` — append-only status history: `report_id`, `reviewer_id`
  (`auth.users`, set null on delete), `from_status`, `to_status`, `note` (≤ 1000 chars),
  `created_at`. Readable only by reviewers/admins via RLS; no direct writes for any client
  role.
- `review_report(public_id, expected, next, note)` — `security definer`, executable only by
  `authenticated`. Checks `is_reviewer()`, the allowed transition (`submitted ⇄
under_review ⇄ reviewed`; reopening a reviewed report needs a note), locks the row and
  rejects a stale `expected` status (optimistic concurrency), then updates the status and
  writes the event with `auth.uid()` in one transaction. Reviewer reads use the signed-in
  user's client (anon key + JWT) so RLS applies; the service-role key is never used for
  reviewer reads.

There is still no `report_reviews` (causality opinion) or general `audit_log` table — see
`docs/REVIEWER.md`.

## 6. Milestones

| #      | Milestone                           | Status / exit criteria                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1** | Foundation                          | Done. App shell, design system, safety copy, env validation, health endpoint.                                                                                                                                                                                                                                                                                                  |
| **M2** | Reporting form and data layer       | Done. Multi-step form with review, shared Zod validation, missing-information checks, report IDs, idempotent submission, local demo store, Supabase migration + RLS + RPC tested against Postgres.                                                                                                                                                                             |
| **M3** | AI-assisted extraction              | Done. `/api/extract` with Claude structured output, evidence quotes, deterministic verifier, data minimisation, rate limits, accept/edit/reject each suggestion, manual fallback. AI output is not stored (only `ai_assisted`). See `docs/AI_EXTRACTION.md`.                                                                                                                   |
| **M4** | Reviewer workflow                   | Done. Server-side reviewer authorisation (Supabase Auth + `profiles.role`, or a signed shared-code demo session with local demo storage only), review workload counts plus synthetic-only analytics, filterable queue, report detail with timeline, status transitions with notes and history. Causality opinion and a general audit log are deferred. See `docs/REVIEWER.md`. |
| **M5** | Synthetic analytics                 | Done. Public `/dashboard` over a fixed, versioned synthetic dataset (300 records) reduced to de-identified fields; filters, weekly/monthly trends, medicine and reaction-term counts, breakdowns, labelled limitations. Deviation from the plan: no aggregate RPCs over `is_synthetic` rows — the dashboard does not read report storage at all. See `docs/ANALYTICS.md`.      |
| **M6** | Multiple medicines & demo hardening | Done. Structured medicine entries (course, course changes, product details), reporter-marked suspected medicines or "Not sure", AI timelines per medicine, reviewer per-medicine display and timeline, report vs entry counts. Not done from the original plan: Playwright E2E in CI, deployment, a formal privacy review.                                                     |
