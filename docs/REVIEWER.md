# Reviewer workflow (Milestone 4)

The reviewer area at `/reviewer` lets an authorised reviewer see the review workload and
demonstration analytics, search and filter submitted reports, read a report in full and
move it through review. Reports record **associations suspected by the reporter**.
Nothing here records or implies that a medicine caused a reaction, and counts are not
incidence rates or safety signals.

## Access: who can see reports

Authorisation is checked on the server for every page render and every action
(`getReviewerAccess()` in `src/server/auth/reviewer-session.ts`). There is no client-side
role selector. Without access, pages render a locked message and no report data, and the
status-change action refuses before reading any input.

| Storage                       | How reviewers sign in                                                                                                   | What enforces it                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase (all three vars set) | Supabase Auth email + password at `/reviewer/sign-in`. The user's `public.profiles.role` must be `reviewer` or `admin`. | Postgres RLS (`is_reviewer()`) on every read, and the `review_report` function for status changes. Reads use the user's JWT, not the service role. |
| Local demo store              | **Shared demo access code** — see below. Not individual authentication.                                                 | The server verifies a signed, expiring session cookie on every request. The code can only unlock the local demo store, never Supabase.             |
| Demo store, code not set      | Not possible — the area is locked and lists the missing variables.                                                      | —                                                                                                                                                  |
| Supabase partly configured    | Not possible — locked, same as report submission.                                                                       | —                                                                                                                                                  |

`src/proxy.ts` only refreshes Supabase session cookies on `/reviewer/*`. It is not an
authorisation check.

### Setting up Supabase reviewers

1. Apply all migrations, including `20261025000000_reviewer_workflow.sql`.
2. Create the user in Supabase (Authentication → Users), with email + password.
3. In the SQL editor:

   ```sql
   insert into public.profiles (id, role)
   select id, 'reviewer' from auth.users where email = 'reviewer@example.org'
   on conflict (id) do update set role = excluded.role;
   ```

4. Sign in at `/reviewer/sign-in`. A signed-in user without the role sees "not a reviewer".

### Demo access-code mode (local demo store only) — not production authentication

```bash
REVIEWER_DEMO_ACCESS_CODE=<at least 12 characters; use a random value>
REVIEWER_SESSION_SECRET=$(openssl rand -base64 48)
```

What it does:

- The submitted code is compared in constant time (HMACs of both values).
- A correct code sets `adr_reviewer_demo`: `base64url(payload).HMAC-SHA256`, where the
  signing key is derived from **both** the session secret and the access code. The
  payload carries only issue and expiry times — no personal data.
- Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/reviewer`, `Secure` in
  production builds, `Max-Age` 8 hours.
- Every request re-verifies the signature, the expiry, and that the lifetime is no longer
  than 8 hours and the issue time is not in the future.
- Sign-in attempts are limited to 5 per minute per client address **and** 30 per minute
  across the whole server instance.

Limitations — treat it as a demo gate, not as authentication:

- **Shared, not individual.** Anyone with the code is "Demo reviewer (shared access
  code)". Actions cannot be attributed to a person, and one person's access cannot be
  removed without removing everyone's.
- **No server-side sessions.** Signing out deletes the cookie in that browser, but a
  copied cookie remains valid until it expires (up to 8 hours). The only revocation is
  changing `REVIEWER_DEMO_ACCESS_CODE` or `REVIEWER_SESSION_SECRET`, which signs every
  demo session out.
- **Code strength is the operator's job.** Only the length (≥ 12) is checked; a guessable
  code is guessable.
- **Rate limiting is per instance and in memory.** It resets on restart, is not shared
  between instances, and the per-client key comes from `X-Forwarded-For`, which a client
  can spoof unless a trusted proxy sets it (the server-wide cap still applies). The
  server-wide cap also means someone hammering the form can lock legitimate demo
  reviewers out for a minute.
- **No MFA, no password policy, no account lockout, no login audit trail.**
- It is only available with the local demo store, which itself is an unencrypted JSON file
  meant for synthetic data. Use Supabase Auth for anything beyond a demonstration.

## Pages

- **Overview** (`/reviewer`)
  - _Review workload_ — total, pending review, under review and reviewed, each split into
    "submitted through the form" and "synthetic". Counts only; no report text.
  - _Demonstration analytics_ — **synthetic demonstration records only** (see below):
    reported serious events (death, admission or emergency visit, as reported), missing
    details, AI-assisted reports, reports per month (last six months, IST), outcome and
    medical attention as reported, most frequently named suspected medicines and symptoms
    (each counted once per report), and median days from submission to first "reviewed".
    Labelled with `SyntheticDataBanner`; each chart has a "View as table" fallback.
- **Review queue** (`/reviewer/reports`) — search (report ID, medicine, symptom,
  description), filters for suspected medicine, status, outcome, medical attention,
  reporter type, AI assistance, submission date range (IST), data source and reported
  serious events; sort by newest, oldest, onset date, status or medicine; 20 per page.
  Each row is marked "Synthetic demonstration data" or "Submitted through the form".
- **Report detail** (`/reviewer/reports/[reportId]`) — the data source, the reporter's
  original description (unchanged), whether AI assistance was used, suspected medicines,
  reporter-confirmed details with "Not provided" for anything missing, a timeline
  (medicine start, reaction onset, submission, status changes; missing dates are listed,
  never estimated) and the status form.

There is no coded "reaction category" in the data model, so the queue and overview use
outcome, medical attention, reporter type and the reporter's symptom words instead.

### Analytics scope

`AGENTS.md` says "Analytics use synthetic data only and must show
`SyntheticDataBadge`/`SyntheticDataBanner`", without limiting it to the public dashboard.
The reviewer overview therefore computes every chart and aggregate figure from synthetic
records only (`analyticsRecords()` in `src/lib/review/analytics.ts`). Reports submitted
through the form are counted in the review workload (numbers per status) and listed in
the queue, which are review tools rather than analytics. The analytics never output
patient fields (initials, age, sex, state), descriptions, other medicines or medical
history; they do output medicine names and symptom words, which is one reason real
submissions are excluded. Changing this scope requires changing the rule in `AGENTS.md`
and `docs/ARCHITECTURE.md` first.

## Status workflow

| From           | Allowed next             | Notes                                    |
| -------------- | ------------------------ | ---------------------------------------- |
| Pending review | Under review             | Optional note                            |
| Under review   | Pending review, Reviewed | Optional note                            |
| Reviewed       | Under review             | **Note required** (reason for reopening) |

"Pending review" is the stored `submitted` status. `needs_info` and `closed` exist in the
schema but have no transitions in this version. Every change records who, when, from, to
and the note. The form sends the status it was showing; if someone else changed the report
in the meantime the change is refused ("changed by someone else"), so two reviewers cannot
silently overwrite each other. Notes are limited to 1000 characters and the form asks
reviewers not to record causality conclusions or patient identifiers.

## Verification status

- **Tested:** status rules, filters, analytics, timeline, demo tokens and sign-in, access
  resolution and action refusal (Vitest); the migration, RLS policies, `is_reviewer()`
  and `review_report` on a real Postgres engine (PGlite) with stand-ins for Supabase's
  `auth` schema (`auth.users`, `auth.uid()`) and the `anon`/`authenticated` roles; the demo-mode UI end to end in a
  browser against a production build.
- **Not tested:** anything against a live Supabase project — applying the migration there,
  Supabase Auth sign-in and sign-out, cookie refresh in `proxy.ts`, and RLS with real JWTs.

## Not included (deliberately or not yet)

- **Causality opinion** — no field exists; reviewers record only review status and notes.
- **Raw AI suggestions** — not stored (data minimisation since M3), so the detail page
  shows only whether AI assistance was used and the reporter-confirmed values.
- **General audit log** — only status changes are recorded; report reads are not logged.
- **Scale** — the Supabase adapter loads up to 1000 most recent reports and filters in the
  server; larger volumes need database-side filtering and pagination.
