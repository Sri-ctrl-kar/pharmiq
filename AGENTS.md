<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules — ADR Connect India

- Healthcare safety: never diagnose, never state or imply a medicine caused a reaction
  (use "suspected"/"reported"), never advise stopping or changing medication, never
  invent missing clinical data. AI output is a suggestion the user must confirm.
- Never claim official PvPI/CDSCO integration. Analytics use synthetic data only and
  must show `SyntheticDataBadge`/`SyntheticDataBanner`.
- Secrets live in env vars only; access them through `src/server/env.ts` (server-only).
  Never log or return env values.
- Reuse shared safety wording from `src/lib/site.ts` (`safetyCopy`).
- Style with semantic tokens from `src/app/globals.css` (`bg-primary`, `text-muted`,
  `border-border`…), not raw Tailwind palette colours.
- Before committing: `npm run lint && npm run typecheck && npm test && npm run build`.
- AI assistance is optional and advisory. Model output must pass
  `src/server/ai/verify-extraction.ts`; values needing review are never pre-selected; never
  overwrite reporter input; send only the minimised description (`minimiseForAi`), never
  patient fields; never log description text. The manual flow must work without AI.
