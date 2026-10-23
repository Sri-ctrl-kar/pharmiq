import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { reportSubmissionSchema, toReportContent } from "@/lib/reports/schema";
import {
  SupabaseReportRepository,
  toSubmitReportPayload,
  type RpcClient,
} from "@/server/reports/supabase-repository";
import { medicineDraft, validDraft } from "./fixtures";

/**
 * Milestone 6 migration (structured medicine entries) on a real Postgres engine (PGlite),
 * applied on top of a database that already holds a report written by the earlier
 * submit_report — the upgrade path an existing Supabase project would take.
 * Supabase's auth schema and roles are stubbed. All data is synthetic.
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
const M6 = "20261026000000_medicine_entries.sql";

let db: PGlite;

async function asServiceRole<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role;");
  try {
    return await run();
  } finally {
    await db.exec("reset role;");
  }
}

const callRaw = (payload: object) =>
  asServiceRole(() =>
    db.query<{ result: { report_id: string } }>(
      "select public.submit_report($1::jsonb) as result",
      [JSON.stringify(payload)],
    ),
  );

const rpcClient: RpcClient = {
  async rpc(_fn, { p_report }) {
    try {
      const { rows } = await callRaw(p_report);
      return { data: rows[0].result, error: null };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { data: null, error: { code, message } };
    }
  },
};

let reportCounter = 0;
const nextId = () =>
  `ADR-2026-M6T${String(++reportCounter).padStart(3, "0")}`.replace(
    /[ILOU]/g,
    "X",
  );

/** A valid Milestone 6 payload with the given medicines and selection. */
function payload(
  medicines = [
    medicineDraft({ name: "Amoxicillin", suspected: true }),
    medicineDraft({ name: "Paracetamol", suspected: false }),
  ],
  suspectedSelection = "marked",
) {
  const content = toReportContent(
    reportSubmissionSchema.parse(
      validDraft({
        idempotencyKey: crypto.randomUUID(),
        medicines,
        suspectedSelection,
      }),
    ),
  );
  return toSubmitReportPayload({
    reportId: nextId(),
    idempotencyKey: crypto.randomUUID(),
    content,
    missingFields: [],
  });
}

const medicinesOf = async (publicId: string) =>
  (
    await db.query<Record<string, unknown>>(
      `select m.* from public.report_medicines m
       join public.reports r on r.id = m.report_id
       where r.public_id = $1 order by m.position`,
      [publicId],
    )
  ).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  const migrations = (await readdir("supabase/migrations")).sort();
  expect(migrations).toContain(M6);
  for (const file of migrations.filter((name) => name < M6)) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  // A report stored by the earlier submit_report: only suspected medicines.
  await callRaw({
    public_id: "ADR-2026-PRE001",
    idempotency_key: crypto.randomUUID(),
    reporter_type: "patient",
    reaction_description: "[Synthetic test] Rash after starting two medicines.",
    reaction_outcome: "recovering",
    medical_attention: "none",
    suspected_medicines: [
      { name: "Amoxicillin", dose: "500 mg", route: "oral" },
      { name: "Cetirizine", dose: null, route: null },
    ],
  });
  for (const file of migrations.filter((name) => name >= M6)) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
}, 60_000);

describe("upgrading an existing database", () => {
  it("keeps earlier reports, marking their medicines suspected as the old form recorded", async () => {
    const [report] = (
      await db.query<{ suspected_selection: string }>(
        "select suspected_selection from public.reports where public_id = 'ADR-2026-PRE001'",
      )
    ).rows;
    expect(report.suspected_selection).toBe("marked");
    const rows = await medicinesOf("ADR-2026-PRE001");
    expect(rows.map((row) => [row.name, row.is_suspected])).toEqual([
      ["Amoxicillin", true],
      ["Cetirizine", true],
    ]);
    expect(rows[0]).toMatchObject({
      course_status: null,
      end_date: null,
      batch_number: null,
      expiry_month: null,
    });
  });

  it("requires new rows to state whether the medicine is suspected (no default)", async () => {
    const [{ id }] = (
      await db.query<{ id: string }>(
        "select id from public.reports where public_id = 'ADR-2026-PRE001'",
      )
    ).rows;
    await expect(
      asServiceRole(() =>
        db.query(
          "insert into public.report_medicines (report_id, position, name) values ($1, 9, 'Ibuprofen')",
          [id],
        ),
      ),
    ).rejects.toThrow(/is_suspected/);
  });

  it("still accepts the older payload shape, treating every medicine as suspected", async () => {
    const legacy = {
      public_id: "ADR-2026-PRE002",
      idempotency_key: crypto.randomUUID(),
      reporter_type: "caregiver",
      reaction_description: "[Synthetic test] Dizziness in the evening.",
      reaction_outcome: "recovered",
      medical_attention: "none",
      suspected_medicines: [{ name: "Amlodipine" }],
    };
    await callRaw(legacy);
    expect(
      (await medicinesOf("ADR-2026-PRE002")).map((row) => row.is_suspected),
    ).toEqual([true]);
  });
});

describe("medicine entries", () => {
  const repository = new SupabaseReportRepository(rpcClient);

  it("stores every field of every medicine independently, in order", async () => {
    const input = payload([
      medicineDraft({
        name: "Amoxicillin",
        brand: "Synthetic Brand A",
        strength: "500 mg",
        dose: "1 capsule",
        frequency: "Three times a day",
        route: "oral",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        courseStatus: "stopped",
        manufacturer: "Synthetic Example Pharma",
        batchNumber: "SYN-B1234",
        expiryDate: "2027-06",
        detailsSource: "pack_or_label",
        suspected: true,
      }),
      medicineDraft({
        name: "Atorvastatin",
        dose: "20 mg",
        frequency: "Once at night",
        startDate: "2026-06-01",
        courseStatus: "dose_changed",
        previousDose: "10 mg",
        previousFrequency: "Once at night",
        changeDate: "2026-07-15",
        suspected: false,
      }),
    ]);
    await callRaw(input);
    const rows = await medicinesOf(input.public_id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      position: 1,
      name: "Amoxicillin",
      brand: "Synthetic Brand A",
      strength: "500 mg",
      dose: "1 capsule",
      course_status: "stopped",
      manufacturer: "Synthetic Example Pharma",
      batch_number: "SYN-B1234",
      expiry_month: "2027-06",
      details_source: "pack_or_label",
      is_suspected: true,
      previous_dose: null,
    });
    expect(rows[1]).toMatchObject({
      position: 2,
      name: "Atorvastatin",
      dose: "20 mg",
      course_status: "dose_changed",
      previous_dose: "10 mg",
      previous_frequency: "Once at night",
      is_suspected: false,
      brand: null,
      batch_number: null,
    });
    expect(String(rows[1].change_date)).toMatch(/2026|Jul/);
  });

  it("stores the reporter's choice: marked medicines, or not sure", async () => {
    const notSure = payload(
      [
        medicineDraft({ name: "Amoxicillin" }),
        medicineDraft({ name: "Paracetamol" }),
      ],
      "not_sure",
    );
    const result = await repository.create({
      reportId: notSure.public_id,
      idempotencyKey: notSure.idempotency_key,
      content: toReportContent(
        reportSubmissionSchema.parse(
          validDraft({
            idempotencyKey: crypto.randomUUID(),
            medicines: [
              medicineDraft({ name: "Amoxicillin" }),
              medicineDraft({ name: "Paracetamol" }),
            ],
            suspectedSelection: "not_sure",
          }),
        ),
      ),
      missingFields: [],
    });
    expect(result.duplicate).toBe(false);
    const [report] = (
      await db.query<{ suspected_selection: string }>(
        "select suspected_selection from public.reports where public_id = $1",
        [notSure.public_id],
      )
    ).rows;
    expect(report.suspected_selection).toBe("not_sure");
    expect(
      (await medicinesOf(notSure.public_id)).every((row) => !row.is_suspected),
    ).toBe(true);
  });

  it("re-validates the suspected choice in SQL", async () => {
    const base = payload();
    const none = base.medicines.map((m) => ({ ...m, is_suspected: false }));
    await expect(
      callRaw({ ...base, public_id: nextId(), medicines: none }),
    ).rejects.toThrow(/at least one suspected/);
    await expect(
      callRaw({
        ...base,
        public_id: nextId(),
        idempotency_key: crypto.randomUUID(),
        suspected_selection: "not_sure",
      }),
    ).rejects.toThrow(/not sure/);
    await expect(
      callRaw({
        ...base,
        public_id: nextId(),
        idempotency_key: crypto.randomUUID(),
        suspected_selection: "probably",
      }),
    ).rejects.toThrow();
  });

  it("allows up to 10 medicines per report and no more", async () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      medicineDraft({
        name: `Synthetic medicine ${i + 1}`,
        suspected: i === 0,
      }),
    );
    const ok = payload(ten);
    await callRaw(ok);
    expect(await medicinesOf(ok.public_id)).toHaveLength(10);
    await expect(
      callRaw({
        ...ok,
        public_id: nextId(),
        idempotency_key: crypto.randomUUID(),
        medicines: [...ok.medicines, { ...ok.medicines[1], name: "Extra" }],
      }),
    ).rejects.toThrow(/between 1 and 10/);
  });

  it("enforces per-medicine integrity rules, leaving no partial report", async () => {
    const before = (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.reports",
      )
    ).rows[0].n;
    const base = payload();
    const broken = [
      { start_date: "2026-08-10", end_date: "2026-08-01" },
      { course_status: "currently_taking", end_date: "2026-08-01" },
      { course_status: "stopped", previous_dose: "10 mg" },
      { batch_number: "<script>" },
      { expiry_month: "2027-13" },
      { end_date: "2999-01-01" },
      { course_status: "paused" },
      { details_source: "guessed" },
    ];
    for (const change of broken) {
      await expect(
        callRaw({
          ...base,
          public_id: nextId(),
          idempotency_key: crypto.randomUUID(),
          medicines: [{ ...base.medicines[0], ...change }, base.medicines[1]],
        }),
      ).rejects.toThrow();
    }
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.reports",
        )
      ).rows[0].n,
    ).toBe(before);
  });

  it("counts as one report however many medicines it lists", async () => {
    const { rows } = await db.query<{ reports: number; entries: number }>(
      `select (select count(*)::int from public.reports) as reports,
              (select count(*)::int from public.report_medicines) as entries`,
    );
    expect(rows[0].entries).toBeGreaterThan(rows[0].reports);
  });
});
