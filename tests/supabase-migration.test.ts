import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { reportSubmissionSchema, toReportContent } from "@/lib/reports/schema";
import {
  ReportIdConflictError,
  type NewReportRecord,
} from "@/server/reports/repository";
import { submitReport } from "@/server/reports/submit-report";
import {
  SupabaseReportRepository,
  toSubmitReportPayload,
  type RpcClient,
} from "@/server/reports/supabase-repository";
import { validDraft } from "./fixtures";

/**
 * Applies the real migration and seed to an in-process Postgres (PGlite) and checks
 * behaviour and access control. Supabase-provided objects (auth schema, auth.uid(),
 * anon/authenticated/service_role roles) are stubbed the way Supabase defines them.
 */

const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase's default privileges, which the migration must revoke.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

const REVIEWER_ID = "00000000-0000-4000-8000-000000000001";
const REPORTER_ID = "00000000-0000-4000-8000-000000000002";

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

/** RpcClient backed by PGlite, executing as service_role like the server would. */
const rpcClient: RpcClient = {
  async rpc(_fn, { p_report }) {
    try {
      const { rows } = await as("service_role", null, () =>
        db.query<{ result: unknown }>(
          "select public.submit_report($1::jsonb) as result",
          [JSON.stringify(p_report)],
        ),
      );
      return { data: rows[0].result, error: null };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { data: null, error: { code, message } };
    }
  },
};

function record(overrides: Partial<NewReportRecord> = {}): NewReportRecord {
  const medicine = validDraft().suspectedMedicines[0];
  const content = toReportContent(
    reportSubmissionSchema.parse(
      validDraft({
        suspectedMedicines: [
          medicine,
          { ...medicine, name: "Cetirizine", dose: "" },
        ],
      }),
    ),
  );
  return {
    reportId: "ADR-2026-TEST01",
    idempotencyKey: crypto.randomUUID(),
    content,
    missingFields: ["suspectedMedicines.1.dose"],
    ...overrides,
  };
}

async function callRaw(role: string, payload: object) {
  return as(role, null, () =>
    db.query("select public.submit_report($1::jsonb)", [
      JSON.stringify(payload),
    ]),
  );
}

async function count(table: string) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return rows[0].n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  // Apply every migration in filename order, as `supabase db push` does.
  const migrations = (await readdir("supabase/migrations")).sort();
  expect(migrations.length).toBeGreaterThanOrEqual(2);
  for (const file of migrations) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.exec(`
    insert into auth.users values ('${REVIEWER_ID}'), ('${REPORTER_ID}');
    insert into public.profiles (id, role) values ('${REVIEWER_ID}', 'reviewer'), ('${REPORTER_ID}', 'reporter');
  `);
}, 60_000);

describe("seed", () => {
  it("contains only rows flagged as synthetic", async () => {
    const { rows } = await db.query<{
      public_id: string;
      is_synthetic: boolean;
    }>("select public_id, is_synthetic from public.reports order by public_id");
    expect(rows.map((r) => r.public_id)).toEqual([
      "ADR-2026-SYN001",
      "ADR-2026-SYN002",
      "ADR-2026-SYN003",
    ]);
    expect(rows.every((r) => r.is_synthetic)).toBe(true);
    expect(await count("public.report_medicines")).toBe(4);
  });
});

describe("submit_report via SupabaseReportRepository", () => {
  const repository = new SupabaseReportRepository(rpcClient);

  it("stores a report with several medicines in order", async () => {
    const input = record({ reportId: "ADR-2026-TEST01" });
    const result = await repository.create(input);
    expect(result).toMatchObject({
      reportId: "ADR-2026-TEST01",
      duplicate: false,
    });

    const { rows } = await db.query<Record<string, unknown>>(
      `select r.status, r.is_synthetic, r.patient_age_years, r.reaction_onset_time::text as onset_time,
              r.missing_fields, m.position, m.name, m.dose, m.route
       from public.reports r join public.report_medicines m on m.report_id = r.id
       where r.public_id = 'ADR-2026-TEST01' order by m.position`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      status: "submitted",
      is_synthetic: false,
      patient_age_years: 34,
      onset_time: "09:15:00",
      missing_fields: ["suspectedMedicines.1.dose"],
      position: 1,
      name: "Amoxicillin",
    });
    expect(rows[1]).toMatchObject({
      position: 2,
      name: "Cetirizine",
      dose: null,
    });
  });

  it("returns the original report for a repeated idempotency key", async () => {
    const input = record({ reportId: "ADR-2026-TEST02" });
    await repository.create(input);
    const before = await count("public.reports");
    const again = await repository.create({
      ...input,
      reportId: "ADR-2026-TEST03",
    });
    expect(again).toMatchObject({
      reportId: "ADR-2026-TEST02",
      duplicate: true,
    });
    expect(await count("public.reports")).toBe(before);
  });

  it("surfaces a report ID collision so the service can retry", async () => {
    await expect(
      repository.create(record({ reportId: "ADR-2026-SYN001" })),
    ).rejects.toBeInstanceOf(ReportIdConflictError);
  });

  it("works end to end through submitReport, including ID collision retry", async () => {
    const ids = ["ADR-2026-SYN002", "ADR-2026-TEST04"];
    const result = await submitReport(
      validDraft({ idempotencyKey: crypto.randomUUID() }),
      { repository, generateId: () => ids.shift()! },
    );
    expect(result).toMatchObject({ ok: true, reportId: "ADR-2026-TEST04" });
  });

  it("is atomic: an invalid medicine leaves no partial report behind", async () => {
    const before = await count("public.reports");
    const bad = toSubmitReportPayload(record({ reportId: "ADR-2026-TEST05" }));
    bad.suspected_medicines[1].name = "x";
    await expect(callRaw("service_role", bad)).rejects.toThrow(
      /check constraint/,
    );
    expect(await count("public.reports")).toBe(before);
  });

  it("re-validates in SQL: future dates, bad enums, medicine count, missing key", async () => {
    const base = toSubmitReportPayload(record({ reportId: "ADR-2026-TEST06" }));
    const cases = [
      { ...base, reaction_onset_date: "2999-01-01" },
      { ...base, reporter_type: "pharma_company" },
      { ...base, suspected_medicines: [] },
      { ...base, idempotency_key: null },
      { ...base, public_id: "not-an-id" },
      { ...base, patient_age_years: 300 },
    ];
    for (const payload of cases) {
      await expect(callRaw("service_role", payload)).rejects.toThrow();
    }
  });

  it("ignores caller attempts to set status or the synthetic flag", async () => {
    const payload = {
      ...toSubmitReportPayload(record({ reportId: "ADR-2026-TEST07" })),
      status: "closed",
      is_synthetic: true,
    };
    await callRaw("service_role", payload);
    const { rows } = await db.query(
      "select status, is_synthetic from public.reports where public_id = 'ADR-2026-TEST07'",
    );
    expect(rows[0]).toEqual({ status: "submitted", is_synthetic: false });
  });
});

describe("access control", () => {
  const payload = () =>
    toSubmitReportPayload(record({ reportId: "ADR-2026-TEST08" }));

  it("anon cannot read, write or call submit_report", async () => {
    await expect(
      as("anon", null, () => db.query("select * from public.reports")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as("anon", null, () => db.query("select * from public.report_medicines")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as("anon", null, () =>
        db.query(
          "insert into public.reports (public_id, reporter_type, reaction_description, reaction_outcome, medical_attention) values ('ADR-2026-ANON01','patient','long enough text','unknown','unknown')",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(callRaw("anon", payload())).rejects.toThrow(
      /permission denied/,
    );
  });

  it("signed-in non-reviewers see no reports and cannot write or escalate their role", async () => {
    const visible = await as("authenticated", REPORTER_ID, () =>
      db.query("select * from public.reports"),
    );
    expect(visible.rows).toHaveLength(0);
    await expect(callRaw("authenticated", payload())).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as("authenticated", REPORTER_ID, () =>
        db.query(
          `update public.profiles set role = 'admin' where id = '${REPORTER_ID}'`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as("authenticated", REPORTER_ID, () =>
        db.query("update public.reports set status = 'closed'"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("signed-in users can read only their own profile", async () => {
    const { rows } = await as("authenticated", REPORTER_ID, () =>
      db.query<{ id: string }>("select id from public.profiles"),
    );
    expect(rows).toEqual([{ id: REPORTER_ID }]);
  });

  it("reviewers can read all reports and medicines", async () => {
    const total = await count("public.reports");
    const reports = await as("authenticated", REVIEWER_ID, () =>
      db.query("select * from public.reports"),
    );
    expect(reports.rows).toHaveLength(total);
    const medicines = await as("authenticated", REVIEWER_ID, () =>
      db.query("select * from public.report_medicines"),
    );
    expect(medicines.rows.length).toBeGreaterThan(0);
  });
});

describe("symptoms and AI-assistance flag (migration 2)", () => {
  const repository = () => new SupabaseReportRepository(rpcClient);

  it("stores symptoms and the ai_assisted flag", async () => {
    const input = record({ reportId: "ADR-2026-TEST20" });
    input.content = {
      ...input.content,
      reaction: {
        ...input.content.reaction,
        symptoms: ["itchy rash", "swollen lips"],
      },
      aiAssisted: true,
    };
    await repository().create(input);
    const { rows } = await db.query(
      "select reaction_symptoms, ai_assisted from public.reports where public_id = 'ADR-2026-TEST20'",
    );
    expect(rows[0]).toEqual({
      reaction_symptoms: ["itchy rash", "swollen lips"],
      ai_assisted: true,
    });
  });

  it("defaults to no symptoms and not AI-assisted for older payloads", async () => {
    const {
      reaction_symptoms: _s,
      ai_assisted: _a,
      ...legacy
    } = toSubmitReportPayload(record({ reportId: "ADR-2026-TEST21" }));
    await callRaw("service_role", legacy);
    const { rows } = await db.query(
      "select reaction_symptoms, ai_assisted from public.reports where public_id = 'ADR-2026-TEST21'",
    );
    expect(rows[0]).toEqual({ reaction_symptoms: [], ai_assisted: false });
  });

  it("rejects malformed symptom lists", async () => {
    const base = toSubmitReportPayload(record({ reportId: "ADR-2026-TEST22" }));
    for (const reaction_symptoms of [
      Array.from({ length: 11 }, (_, i) => `symptom ${i}`),
      ["x"],
      ["y".repeat(101)],
      [42],
    ]) {
      await expect(
        callRaw("service_role", { ...base, reaction_symptoms }),
      ).rejects.toThrow();
    }
  });
});
