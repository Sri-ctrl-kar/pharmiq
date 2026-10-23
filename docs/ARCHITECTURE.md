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
| Synthetic data for the demo               | Analytics reads from a `synthetic_reports` view / `is_synthetic` flag; every chart is labelled "Synthetic demonstration data".                                                                                                                      |
| Secrets in env vars                       | Validated by `src/lib/env.ts`; `.env*` is git-ignored; `.env.example` documents names only.                                                                                                                                                         |

## 2. System architecture

```
Browser (Next.js App Router, React 19, Tailwind v4)
   │  Server Components render pages; Client Components only for interactive form steps & charts
   ▼
Next.js server (Node runtime)
   ├─ Server Actions ── submit report, confirm extraction, reviewer status changes
   ├─ Route Handlers ── /api/extract (AI), /api/health
   ├─ proxy.ts ─────── refreshes Supabase auth cookie, optimistic redirect for /reviewer
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

Added in later milestones (not yet installed):

| Package                                   | Milestone      | Purpose                     |
| ----------------------------------------- | -------------- | --------------------------- |
| `@anthropic-ai/sdk`                       | M4             | Claude API extraction       |
| `recharts`                                | M6             | Dashboard charts            |
| `react-hook-form` + `@hookform/resolvers` | M3 (if needed) | Multi-step form state       |
| `@playwright/test`                        | M3+            | End-to-end smoke tests      |
| `supabase` CLI (dev)                      | M2             | Migrations, type generation |

## 4. File structure

```
.
├── docs/ARCHITECTURE.md          ← this file
├── supabase/
│   ├── migrations/               ← SQL migrations (M2)
│   └── seed.sql                  ← synthetic demo data (M6)
├── src/
│   ├── proxy.ts                  ← auth cookie refresh, /reviewer guard (M5)
│   ├── app/
│   │   ├── layout.tsx            ← shell: header, footer, safety banner
│   │   ├── page.tsx              ← landing
│   │   ├── report/               ← guided reporting flow (M3–M4)
│   │   ├── report/[reportId]/    ← confirmation / status lookup (M3)
│   │   ├── dashboard/            ← synthetic analytics (M6)
│   │   ├── reviewer/             ← protected reviewer workflow (M5)
│   │   ├── login/                ← reviewer sign-in (M5)
│   │   ├── design-system/        ← living style guide
│   │   └── api/
│   │       ├── health/route.ts   ← config status (booleans only)
│   │       └── extract/route.ts  ← AI extraction (M4)
│   ├── components/
│   │   ├── ui/                   ← primitives: Button, Card, Badge, Alert, form fields
│   │   ├── layout/               ← SiteHeader, SiteFooter, PageHeader, Container
│   │   └── safety/               ← SafetyNotice, SyntheticDataBadge
│   ├── lib/
│   │   ├── env.ts                ← validated, server-only env access
│   │   ├── utils.ts              ← cn() etc.
│   │   ├── site.ts               ← nav + product copy
│   │   └── schemas/              ← shared Zod schemas (M3)
│   └── server/                   ← server-only DAL, Supabase clients, AI service
└── tests/                        ← vitest unit tests
```

## 5. Database schema (draft — implemented in M2)

```sql
create type report_status    as enum ('submitted','under_review','needs_info','reviewed','closed');
create type reporter_type    as enum ('patient','caregiver','healthcare_professional','other');
create type seriousness      as enum ('not_serious','serious','unknown');
create type reaction_outcome as enum ('recovered','recovering','not_recovered','recovered_with_sequelae','fatal','unknown');
create type user_role        as enum ('reporter','reviewer','admin');

create table profiles (               -- 1:1 with auth.users
  id         uuid primary key references auth.users on delete cascade,
  role       user_role not null default 'reporter',
  full_name  text,
  created_at timestamptz not null default now()
);

create table reports (
  id                uuid primary key default gen_random_uuid(),
  public_id         text unique not null,          -- ADR-2026-XXXXXX
  status            report_status not null default 'submitted',
  reporter_type     reporter_type not null,
  submitted_by      uuid references auth.users,    -- null for anonymous
  -- patient (de-identified)
  patient_initials  text check (char_length(patient_initials) <= 4),
  patient_age_years int  check (patient_age_years between 0 and 120),
  patient_sex       text check (patient_sex in ('female','male','other','unknown')),
  patient_state     text,                          -- Indian state / UT
  -- event
  narrative         text not null,                 -- reporter's own words
  onset_date        date,
  seriousness       seriousness not null default 'unknown',
  outcome           reaction_outcome not null default 'unknown',
  ai_assisted       boolean not null default false,
  missing_fields    text[] not null default '{}',  -- computed at submit
  is_synthetic      boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table report_contacts (        -- PII split out; reviewer-only RLS
  report_id  uuid primary key references reports on delete cascade,
  name       text, email text, phone text,
  consent_to_contact boolean not null default false
);

create table report_medicines (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports on delete cascade,
  name        text not null,               -- as reported (brand or generic)
  role        text not null default 'suspected' check (role in ('suspected','concomitant')),
  dose_text   text, route text, indication text,
  start_date  date, stop_date date,
  action_taken text check (action_taken in ('withdrawn','dose_reduced','dose_increased','not_changed','unknown','not_applicable'))
);

create table report_reactions (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports on delete cascade,
  description text not null,               -- reporter's term, verbatim
  onset_date  date, end_date date,
  outcome     reaction_outcome not null default 'unknown'
);

create table ai_extractions (           -- audit of AI suggestions vs confirmed values
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid references reports on delete cascade,
  model       text not null,
  suggestion  jsonb not null,              -- raw validated AI output incl. evidence quotes
  accepted    jsonb,                       -- what the user confirmed
  created_at  timestamptz not null default now()
);

create table report_reviews (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports on delete cascade,
  reviewer_id uuid not null references auth.users,
  from_status report_status, to_status report_status not null,
  causality_opinion text check (causality_opinion in ('certain','probable','possible','unlikely','unclassified','unassessable')),
  note        text,
  created_at  timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key, actor uuid, action text not null,
  entity text not null, entity_id uuid, at timestamptz not null default now()
);
```

RLS summary:

- `reports`, `report_medicines`, `report_reactions`: insert allowed to anon/auth via
  a `security definer` RPC (`submit_report`) only; select allowed to the submitter
  and to `reviewer`/`admin`; update only by `reviewer`/`admin`.
- `report_contacts`: select only `reviewer`/`admin`; never exposed to analytics.
- `report_reviews`, `audit_log`: reviewer/admin insert & select; no update/delete.
- Analytics: a `security definer` function returning **aggregates over
  `is_synthetic = true` rows only**, so the dashboard never touches real reports.
- Public status lookup by `public_id` returns status only (no clinical content).

## 6. Milestones

| #      | Milestone                  | Deliverable / exit criteria                                                                                                                                                                                         |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | **Foundation** _(this PR)_ | Next.js app, design system tokens + primitives, layout shell, safety copy, env validation, health endpoint, lint/typecheck/test/build green.                                                                        |
| M2     | Database & Supabase wiring | Migrations for the schema above, RLS policies, `submit_report` RPC, generated TS types, server/browser Supabase clients, `proxy.ts` session refresh.                                                                |
| M3     | Guided reporting form      | Multi-step form (reporter → patient → medicines → reaction → review), shared Zod schema, missing-field checks, Server Action persistence, report ID confirmation page. Works with no AI.                            |
| M4     | AI-assisted extraction     | `/api/extract` with Claude, structured output + evidence quotes, rate limiting, "review suggestions" step where users accept/edit/reject each item; audit in `ai_extractions`. Graceful fallback when unconfigured. |
| M5     | Reviewer workflow          | Supabase Auth login, role-gated `/reviewer` queue, report detail, status transitions, causality opinion & notes, audit log.                                                                                         |
| M6     | Synthetic analytics        | Seed script for clearly-synthetic reports, aggregate RPCs, dashboard (trends, top medicines/reactions, seriousness, state map/table) with persistent "Synthetic data" labelling.                                    |
| M7     | Hardening & demo polish    | Accessibility pass, E2E smoke tests, privacy review, demo script, deployment.                                                                                                                                       |
