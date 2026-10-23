# ADR Connect India

AI-assisted adverse drug reaction (ADR) reporting, tracking and analytics — a
**HEALTHX 2026 hackathon prototype**.

> Independent prototype. Not affiliated with, endorsed by, or integrated with the
> Pharmacovigilance Programme of India (PvPI), IPC or CDSCO. It does not diagnose,
> assess causality, or give medical advice. Analytics use synthetic data only.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture, database
schema and milestone plan.

## Status

Milestone 1 (foundation) is complete: Next.js app shell, design system, safety copy,
env validation and a health endpoint. Reporting, AI extraction, the reviewer workflow
and analytics are placeholders until their milestones land.

## Getting started

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local   # optional for now; the app runs without any keys
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

Useful routes: `/design-system` (living style guide), `/api/health` (which
integrations are configured — booleans only).

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS v4 ·
Supabase (Postgres + Auth) · Claude API (optional) · Zod · Vitest.
