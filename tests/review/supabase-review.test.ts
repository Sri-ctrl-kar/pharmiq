import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { statusChangeSchema } from "@/lib/review/status";
import {
  SupabaseReviewRepository,
  type ReviewDbClient,
} from "@/server/review/supabase-review-repository";
import {
  SupabaseReportRepository,
  type RpcClient,
} from "@/server/reports/supabase-repository";
import { reportSubmissionSchema, toReportContent } from "@/lib/reports/schema";
import { medicineDraft, validDraft } from "../fixtures";

/**
 * Milestone 4 database layer: the real migrations on in-process Postgres (PGlite), with
 * Supabase's auth schema and roles stubbed. Every query below runs as the given role and
 * user, so row-level security and the review_report() checks are exercised for real.
 */

const STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;
const REVIEWER = "00000000-0000-4000-8000-0000000000a1";
const REPORTER = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;

async function as<T>(
  role: string,
  sub: string | null,
  run: () => Promise<T>,
): Promise<T> {
  await db.exec(
    `set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false);`,
  );
  try {
    return await run();
  } finally {
    await db.exec("reset role;");
  }
}

// Rows shaped like the PostgREST embed used by REVIEW_SELECT.
const ROW_SQL = `
  select row_to_json(x) as row from (
    select r.*,
      (select coalesce(json_agg(m), '[]') from public.report_medicines m where m.report_id = r.id) as report_medicines,
      (select coalesce(json_agg(e), '[]') from public.report_status_events e where e.report_id = r.id) as report_status_events
    from public.reports r
  ) x`;

/** A ReviewDbClient that runs as `role`/`sub`, like a user-scoped Supabase client. */
function clientAs(role: string, sub: string | null): ReviewDbClient {
  const result = async (sql: string, params: unknown[] = []) => {
    try {
      const { rows } = await as(role, sub, () =>
        db.query<{ row?: unknown; result?: unknown }>(sql, params),
      );
      return { data: rows, error: null };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { data: null, error: { code, message } };
    }
  };
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async (count: number) => {
            const { data, error } = await result(
              `${ROW_SQL} order by x.submitted_at desc limit ${count}`,
            );
            return { data: data?.map((r) => r.row) ?? null, error };
          },
        }),
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            const { data, error } = await result(
              `${ROW_SQL} where x.public_id = $1`,
              [value],
            );
            return { data: data?.[0]?.row ?? null, error };
          },
        }),
      }),
    }),
    rpc: async (_fn, args) => {
      const { error } = await result(
        "select public.review_report($1, $2, $3, $4) as result",
        [args.p_public_id, args.p_expected, args.p_next, args.p_note],
      );
      return { data: null, error };
    },
  };
}

const reviewer = { id: REVIEWER, label: "reviewer@example.test" };
const change = (
  reportId: string,
  expectedStatus: string,
  nextStatus: string,
  note = "",
) => statusChangeSchema.parse({ reportId, expectedStatus, nextStatus, note });
const rawChange = (
  reportId: string,
  expectedStatus: string,
  nextStatus: string,
  note: string | null = null,
) => ({ reportId, expectedStatus, nextStatus, note }) as never;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  for (const file of (await readdir("supabase/migrations")).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.exec(`
    insert into auth.users values ('${REVIEWER}'), ('${REPORTER}');
    insert into public.profiles (id, role) values ('${REVIEWER}', 'reviewer'), ('${REPORTER}', 'reporter');
  `);
  // One report submitted through the real write path (service role).
  const submitClient: RpcClient = {
    rpc: async (_fn, { p_report }) => {
      const { rows } = await as("service_role", null, () =>
        db.query<{ result: unknown }>(
          "select public.submit_report($1::jsonb) as result",
          [JSON.stringify(p_report)],
        ),
      );
      return { data: rows[0].result, error: null };
    },
  };
  const content = toReportContent(
    reportSubmissionSchema.parse(
      validDraft({
        medicines: [
          validDraft().medicines[0],
          medicineDraft({
            name: "Atorvastatin",
            dose: "20 mg",
            courseStatus: "dose_changed",
            previousDose: "10 mg",
            changeDate: "2026-08-15",
            batchNumber: "SYN-ATV-01",
            expiryDate: "2027-01",
            detailsSource: "prescription",
          }),
        ],
      }),
    ),
  );
  await new SupabaseReportRepository(submitClient).create({
    reportId: "ADR-2026-REVW01",
    idempotencyKey: crypto.randomUUID(),
    content,
    missingFields: [],
  });
}, 60_000);

describe("reviewer reads (RLS)", () => {
  it("maps each medicine's own details and the reporter's suspected marks", async () => {
    const report = await new SupabaseReviewRepository(
      clientAs("authenticated", REVIEWER),
      reviewer,
    ).getReport("ADR-2026-REVW01");
    expect(report!.content.suspectedSelection).toBe("marked");
    expect(report!.content.medicines).toEqual([
      expect.objectContaining({ name: "Amoxicillin", suspected: true }),
      expect.objectContaining({
        name: "Atorvastatin",
        suspected: false,
        dose: "20 mg",
        courseStatus: "dose_changed",
        previousDose: "10 mg",
        changeDate: "2026-08-15",
        batchNumber: "SYN-ATV-01",
        expiryDate: "2027-01",
        detailsSource: "prescription",
      }),
    ]);
  });

  it("gives reviewers every report, mapped with medicines and history", async () => {
    const reports = await new SupabaseReviewRepository(
      clientAs("authenticated", REVIEWER),
      reviewer,
    ).listReports();
    expect(reports.map((r) => r.reportId)).toEqual(
      expect.arrayContaining([
        "ADR-2026-SYN001",
        "ADR-2026-SYN002",
        "ADR-2026-SYN003",
        "ADR-2026-REVW01",
      ]),
    );
    const syn2 = reports.find((r) => r.reportId === "ADR-2026-SYN002")!;
    expect(syn2.isSynthetic).toBe(true);
    expect(syn2.content.medicines.map((m) => m.name)).toEqual([
      "Metformin",
      "Atorvastatin",
    ]);
    // Seed rows predate Milestone 6 semantics: every listed medicine was suspected.
    expect(syn2.content.medicines.every((m) => m.suspected)).toBe(true);
    expect(syn2.content.suspectedSelection).toBe("marked");
    expect(syn2.content.medicines[1]).toMatchObject({
      courseStatus: null,
      endDate: null,
      batchNumber: null,
    });
    expect(syn2.content.reaction.symptoms).toEqual([
      "muscle aches",
      "tiredness",
    ]);
    const syn3 = reports.find((r) => r.reportId === "ADR-2026-SYN003")!;
    expect(syn3.content.reaction.onsetTime).toBe("16:00");
  });

  it("gives signed-in non-reviewers nothing and anonymous users an error", async () => {
    expect(
      await new SupabaseReviewRepository(
        clientAs("authenticated", REPORTER),
        reviewer,
      ).listReports(),
    ).toEqual([]);
    await expect(
      new SupabaseReviewRepository(
        clientAs("anon", null),
        reviewer,
      ).listReports(),
    ).rejects.toMatchObject({
      name: "StorageUnavailableError",
      code: "42501",
    });
    expect(
      await new SupabaseReviewRepository(
        clientAs("authenticated", REPORTER),
        reviewer,
      ).getReport("ADR-2026-REVW01"),
    ).toBeNull();
  });
});

describe("review_report() status changes", () => {
  const repo = () =>
    new SupabaseReviewRepository(clientAs("authenticated", REVIEWER), reviewer);

  it("lets a reviewer move a report through the workflow and records who did it", async () => {
    const started = await repo().updateStatus(
      change("ADR-2026-REVW01", "submitted", "under_review"),
      reviewer,
    );
    expect(started).toMatchObject({
      ok: true,
      report: { status: "under_review" },
    });
    const done = await repo().updateStatus(
      change(
        "ADR-2026-REVW01",
        "under_review",
        "reviewed",
        "Checked against description.",
      ),
      reviewer,
    );
    expect(
      done.ok &&
        done.report.events.map((e) => [e.from, e.to, e.note, e.reviewer]),
    ).toEqual([
      ["submitted", "under_review", null, "reviewer@example.test (you)"],
      [
        "under_review",
        "reviewed",
        "Checked against description.",
        "reviewer@example.test (you)",
      ],
    ]);
    const { rows } = await db.query<{ reviewer_id: string }>(
      "select reviewer_id from public.report_status_events e join public.reports r on r.id = e.report_id where r.public_id = 'ADR-2026-REVW01'",
    );
    expect(rows.every((row) => row.reviewer_id === REVIEWER)).toBe(true);
  });

  it("requires a note to reopen, then allows it", async () => {
    expect(
      await repo().updateStatus(
        rawChange("ADR-2026-REVW01", "reviewed", "under_review", "   "),
        reviewer,
      ),
    ).toEqual({ ok: false, reason: "invalid_transition" });
    expect(
      (
        await repo().updateStatus(
          change(
            "ADR-2026-REVW01",
            "reviewed",
            "under_review",
            "New information.",
          ),
          reviewer,
        )
      ).ok,
    ).toBe(true);
  });

  it("rejects stale, disallowed and unknown changes", async () => {
    expect(
      await repo().updateStatus(
        rawChange("ADR-2026-REVW01", "submitted", "under_review"),
        reviewer,
      ),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(
      await repo().updateStatus(
        rawChange("ADR-2026-SYN001", "submitted", "reviewed"),
        reviewer,
      ),
    ).toEqual({ ok: false, reason: "invalid_transition" });
    expect(
      await repo().updateStatus(
        rawChange("ADR-2026-ZZZZZZ", "submitted", "under_review"),
        reviewer,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses non-reviewers and anonymous callers, changing nothing", async () => {
    const before = await db.query<{ status: string }>(
      "select status from public.reports where public_id = 'ADR-2026-SYN001'",
    );
    const asReporter = new SupabaseReviewRepository(
      clientAs("authenticated", REPORTER),
      reviewer,
    );
    expect(
      await asReporter.updateStatus(
        change("ADR-2026-SYN001", "submitted", "under_review"),
        reviewer,
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    const asAnon = new SupabaseReviewRepository(
      clientAs("anon", null),
      reviewer,
    );
    expect(
      await asAnon.updateStatus(
        change("ADR-2026-SYN001", "submitted", "under_review"),
        reviewer,
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
    const after = await db.query<{ status: string }>(
      "select status from public.reports where public_id = 'ADR-2026-SYN001'",
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("does not allow status or history to be written directly", async () => {
    await expect(
      as("authenticated", REVIEWER, () =>
        db.query("update public.reports set status = 'closed'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as("authenticated", REVIEWER, () =>
        db.query(
          "insert into public.report_status_events (report_id, from_status, to_status) select id, 'submitted', 'reviewed' from public.reports limit 1",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    const history = await as("authenticated", REPORTER, () =>
      db.query("select * from public.report_status_events"),
    );
    expect(history.rows).toEqual([]);
  });
});
