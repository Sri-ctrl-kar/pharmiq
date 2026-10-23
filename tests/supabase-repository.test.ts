import { describe, expect, it, vi } from "vitest";
import { reportSubmissionSchema, toReportContent } from "@/lib/reports/schema";
import {
  ReportIdConflictError,
  StorageUnavailableError,
  type NewReportRecord,
} from "@/server/reports/repository";
import {
  SupabaseReportRepository,
  type RpcClient,
} from "@/server/reports/supabase-repository";
import { validDraft } from "./fixtures";

const submission = reportSubmissionSchema.parse(validDraft());
const { idempotencyKey } = submission;
const content = toReportContent(submission);
const record: NewReportRecord = {
  reportId: "ADR-2026-ABCDEF",
  idempotencyKey,
  content,
  missingFields: [],
};

const clientReturning = (response: Awaited<ReturnType<RpcClient["rpc"]>>) => {
  const rpc = vi.fn().mockResolvedValue(response);
  return { client: { rpc } as RpcClient, rpc };
};

describe("SupabaseReportRepository", () => {
  it("calls submit_report with a snake_case payload and maps the result", async () => {
    const { client, rpc } = clientReturning({
      data: {
        report_id: "ADR-2026-ABCDEF",
        submitted_at: "2026-10-23T06:00:00+00:00",
        duplicate: false,
      },
      error: null,
    });
    const result = await new SupabaseReportRepository(client).create(record);

    expect(result).toEqual({
      reportId: "ADR-2026-ABCDEF",
      submittedAt: "2026-10-23T06:00:00.000Z",
      duplicate: false,
    });
    const [fn, { p_report }] = rpc.mock.calls[0];
    expect(fn).toBe("submit_report");
    expect(p_report).toMatchObject({
      public_id: "ADR-2026-ABCDEF",
      idempotency_key: idempotencyKey,
      reporter_type: "patient",
      patient_age_years: 34,
      reaction_onset_time: "09:15",
      suspected_medicines: [
        {
          name: "Amoxicillin",
          dose: "500 mg",
          route: "oral",
          start_date: "2026-08-28",
        },
      ],
    });
    // Status, synthetic flag and timestamps are decided by the database, not the caller.
    expect(p_report).not.toHaveProperty("status");
    expect(p_report).not.toHaveProperty("is_synthetic");
  });

  it("maps a public_id unique violation to an ID conflict", async () => {
    const { client } = clientReturning({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "reports_public_id_key"',
      },
    });
    await expect(
      new SupabaseReportRepository(client).create(record),
    ).rejects.toBeInstanceOf(ReportIdConflictError);
  });

  it("maps other database errors and unexpected responses to storage failures", async () => {
    const failing = clientReturning({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    await expect(
      new SupabaseReportRepository(failing.client).create(record),
    ).rejects.toMatchObject({
      name: "StorageUnavailableError",
      code: "42501",
    });
    const garbled = clientReturning({ data: { ok: 1 }, error: null });
    await expect(
      new SupabaseReportRepository(garbled.client).create(record),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
