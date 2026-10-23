# ADR Connect India

AI-assisted adverse drug reaction (ADR) reporting, tracking and analytics — a
**HEALTHX 2026 hackathon prototype**.

> Independent prototype. Not affiliated with, endorsed by, or integrated with the
> Pharmacovigilance Programme of India (PvPI), IPC or CDSCO. It does not diagnose,
> assess causality, or give medical advice. Analytics use synthetic data only.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture, database
schema and milestone plan.

## Status

| Milestone                                             | State                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| M1 Foundation — app shell, design system, safety copy | Done                                                        |
| M2 Reporting form and data layer                      | Done                                                        |
| M3 AI-assisted extraction (optional, user-confirmed)  | Done — see [`docs/AI_EXTRACTION.md`](docs/AI_EXTRACTION.md) |
| M4 Reviewer workflow · M5 Analytics                   | Not started (placeholder pages)                             |

**Working now, with no credentials:** the `/report` form (reporter, what happened,
suspected medicines, reaction details incl. symptoms, other information, review),
client- and server-side validation, missing-information checks, report IDs
(`ADR-2026-XXXXXX`), duplicate-submission protection, saving to the **local
demonstration store**, and 10 synthetic example descriptions.

**Needs credentials:**

- _Persistent production storage_ — Supabase (below). Migrations and RLS are tested
  against a real Postgres engine (PGlite) but not yet against a live Supabase project.
- _AI-assisted extraction_ — `ANTHROPIC_API_KEY`. Without it the form shows "AI
  assistance is not available" and works manually. Guardrails are tested with simulated
  model outputs; **live model accuracy has not been measured** (`npm run eval:extraction`).

## Report storage

The storage backend is chosen at request time (`GET /api/health` shows which):

| Supabase variables set | Storage                                                               | Notes                                                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None                   | **Local demo store** — `.data/demo-reports.json` (or `DEMO_DATA_DIR`) | Plain JSON file on the server: **not encrypted, no access control, no backups. Not a secure production database.** Seeded with 3 clearly labelled synthetic records. The UI tells users to enter test data only. Needs a writable filesystem, so it will not persist on serverless hosts. |
| All three              | **Supabase Postgres**                                                 | Writes go through the `submit_report` database function using the service-role key on the server only. RLS blocks all direct reads and writes from `anon` and `authenticated` users; only reviewer/admin profiles can read reports.                                                       |
| Some                   | **Submission disabled**                                               | Fails closed with an "unavailable" message rather than writing to the demo store.                                                                                                                                                                                                         |

### Enabling persistent Supabase storage

1. Create a Supabase project.
2. Apply the migrations in order (`supabase/migrations/*.sql`): run each in the SQL
   editor, or `supabase link` then `supabase db push`.
3. Optionally load the synthetic demo records: `supabase/seed.sql`.
4. Set these in `.env.local` (or your host's environment), from Project settings → API:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   The service-role key is server-only; never prefix it with `NEXT_PUBLIC_`.
5. Restart and check `GET /api/health` returns `"storage": "supabase"`, then submit a test report.
6. Reviewer access (Milestone 4): add a row to `public.profiles` with `role = 'reviewer'`
   for a Supabase Auth user.

Before handling real reports you would also need a hosting/data-protection review (e.g.
India's DPDP Act obligations), rate limiting on the public form, backups and monitoring.

## Getting started

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local   # optional: with no keys, reports go to the local demo store
npm run dev                  # http://localhost:3000
```

| Script                        | Purpose                   |
| ----------------------------- | ------------------------- |
| `npm run dev`                 | Development server        |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint`                | ESLint                    |
| `npm run typecheck`           | TypeScript                |
| `npm test`                    | Vitest unit tests         |
| `npm run format`              | Prettier                  |

Useful routes: `/report` (reporting form), `/design-system` (living style guide),
`/api/health` (storage mode and which integrations are configured — never values),
`/api/extract` (AI suggestions; server-side only).

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS v4 ·
Supabase (Postgres + Auth) · Claude API via `@anthropic-ai/sdk` (optional) · Zod · Vitest · PGlite (tests).
