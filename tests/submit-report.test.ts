import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidReportId } from "@/lib/reports/report-id";
import { handleReportSubmission } from "@/server/reports/handle-submission";
import { LocalDemoReportRepository } from "@/server/reports/local-demo-repository";
import {
  ReportIdConflictError,
  StorageUnavailableError,
  type NewReportRecord,
  type ReportRepository,
} from "@/server/reports/repository";
import { resolveStorageStatus } from "@/server/reports/storage";
import {
  MAX_REPORT_ID_ATTEMPTS,
  submitReport,
} from "@/server/reports/submit-report";
import { minimalDraft, validDraft } from "./fixtures";

let dir: string;
let filePath: string;
const silent = () => {};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "adr-reports-"));
  filePath = path.join(dir, "demo-reports.json");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function failingRepository(error: Error): ReportRepository {
  return { mode: "supabase", create: vi.fn().mockRejectedValue(error) };
}

describe("submitReport", () => {
  it("stores a valid report and returns its new ID", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const result = await submitReport(validDraft(), { repository });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isValidReportId(result.reportId)).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.missingInformation).toEqual([]);

    const [stored] = await repository.list();
    expect(stored.reportId).toBe(result.reportId);
    expect(stored.status).toBe("submitted");
    expect(stored.isSynthetic).toBe(false);
    expect(stored.content.medicines[0].name).toBe("Amoxicillin");
  });

  it("stores reports with missing information and records which fields are missing", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const result = await submitReport(minimalDraft(), { repository });
    expect(result.ok && result.missingInformation.length).toBe(9);
    const [stored] = await repository.list();
    expect(stored.missingFields).toContain("reaction.onsetDate");
    expect(stored.content.reaction.onsetDate).toBeNull();
  });

  it("returns field errors and writes nothing when validation fails", async () => {
    const repository = { mode: "local-demo" as const, create: vi.fn() };
    const result = await submitReport(validDraft({ reporterType: "" }), {
      repository,
    });
    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("retries with a fresh ID when the generated ID is already taken", async () => {
    const create = vi
      .fn<
        (
          record: NewReportRecord,
        ) => Promise<
          never | { reportId: string; submittedAt: string; duplicate: boolean }
        >
      >()
      .mockRejectedValueOnce(new ReportIdConflictError())
      .mockImplementation(async (record) => ({
        reportId: record.reportId,
        submittedAt: "2026-10-23T06:00:00.000Z",
        duplicate: false,
      }));
    const ids = ["ADR-2026-AAAAAA", "ADR-2026-BBBBBB"];
    const result = await submitReport(validDraft(), {
      repository: { mode: "supabase", create },
      generateId: () => ids.shift()!,
    });
    expect(result).toMatchObject({ ok: true, reportId: "ADR-2026-BBBBBB" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated ID conflicts", async () => {
    const repository = failingRepository(new ReportIdConflictError());
    const result = await submitReport(validDraft(), {
      repository,
      logError: silent,
    });
    expect(result).toEqual({ ok: false, reason: "storage" });
    expect(repository.create).toHaveBeenCalledTimes(MAX_REPORT_ID_ATTEMPTS);
  });

  it("reports a storage failure without leaking report content to logs", async () => {
    const logError = vi.fn();
    const error = Object.assign(
      new StorageUnavailableError("db down: Amoxicillin"),
      { code: "08006" },
    );
    const result = await submitReport(validDraft(), {
      repository: failingRepository(error),
      logError,
    });
    expect(result).toEqual({ ok: false, reason: "storage" });
    expect(logError).toHaveBeenCalledOnce();
    const logged = logError.mock.calls[0][0] as string;
    expect(logged).toContain("08006");
    expect(logged).not.toMatch(/Amoxicillin|rash/i);
  });
});

describe("LocalDemoReportRepository", () => {
  it("seeds clearly labelled synthetic records on first use", async () => {
    const repository = new LocalDemoReportRepository(filePath);
    const reports = await repository.list();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((report) => report.isSynthetic)).toBe(true);
    const file = JSON.parse(await readFile(filePath, "utf8"));
    expect(file.notice).toMatch(/not a secure production database/i);
  });

  it("persists reports across repository instances (server restarts)", async () => {
    const first = new LocalDemoReportRepository(filePath, []);
    const result = await submitReport(validDraft(), { repository: first });
    const second = new LocalDemoReportRepository(filePath, []);
    expect((await second.list()).map((r) => r.reportId)).toEqual([
      result.ok && result.reportId,
    ]);
  });

  it("returns the original report for a repeated submission (duplicate protection)", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const first = await submitReport(validDraft(), { repository });
    const again = await submitReport(validDraft(), { repository });
    expect(again).toMatchObject({
      ok: true,
      duplicate: true,
      reportId: first.ok && first.reportId,
    });
    expect(await repository.list()).toHaveLength(1);
  });

  it("does not create duplicates when the same submission arrives concurrently", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        submitReport(validDraft(), { repository }),
      ),
    );
    const ids = new Set(results.map((r) => r.ok && r.reportId));
    expect(ids.size).toBe(1);
    expect(await repository.list()).toHaveLength(1);
  });

  it("keeps separate submissions separate", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    await submitReport(validDraft(), { repository });
    await submitReport(validDraft({ idempotencyKey: crypto.randomUUID() }), {
      repository,
    });
    expect(await repository.list()).toHaveLength(2);
  });

  it("signals an ID conflict instead of overwriting an existing report", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const result = await submitReport(validDraft(), { repository });
    const takenId = result.ok ? result.reportId : "";
    await expect(
      repository.create({
        reportId: takenId,
        idempotencyKey: crypto.randomUUID(),
        content: (await repository.list())[0].content,
        missingFields: [],
      }),
    ).rejects.toBeInstanceOf(ReportIdConflictError);
  });

  it("fails safely and leaves a corrupt store untouched", async () => {
    await writeFile(filePath, "{ not json");
    const repository = new LocalDemoReportRepository(filePath, []);
    const result = await submitReport(validDraft(), {
      repository,
      logError: silent,
    });
    expect(result).toEqual({ ok: false, reason: "storage" });
    expect(await readFile(filePath, "utf8")).toBe("{ not json");
  });

  it("fails safely when the store cannot be written", async () => {
    // A path below a regular file can never be created.
    await writeFile(path.join(dir, "blocker"), "");
    const repository = new LocalDemoReportRepository(
      path.join(dir, "blocker", "store.json"),
      [],
    );
    const result = await submitReport(validDraft(), {
      repository,
      logError: silent,
    });
    expect(result).toEqual({ ok: false, reason: "storage" });
  });
});

describe("handleReportSubmission", () => {
  const form = (payload?: string) => {
    const data = new FormData();
    if (payload !== undefined) data.set("payload", payload);
    return data;
  };

  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("returns the report ID and storage mode on success", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const state = await handleReportSubmission(
      form(JSON.stringify(validDraft())),
      repository,
    );
    expect(state).toMatchObject({
      status: "success",
      duplicate: false,
      storageMode: "local-demo",
    });
    expect(state.status === "success" && isValidReportId(state.reportId)).toBe(
      true,
    );
  });

  it("rejects missing, oversized and malformed payloads", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    for (const payload of [undefined, "", "{not json", "x".repeat(70_000)]) {
      const state = await handleReportSubmission(form(payload), repository);
      expect(state.status).toBe("invalid");
    }
    expect(await repository.list()).toHaveLength(0);
  });

  it("returns field errors for invalid answers", async () => {
    const repository = new LocalDemoReportRepository(filePath, []);
    const state = await handleReportSubmission(
      form(JSON.stringify(validDraft({ declaration: false }))),
      repository,
    );
    expect(state).toMatchObject({
      status: "invalid",
      fieldErrors: { declaration: expect.any(String) },
    });
  });

  it("returns a retryable error when storage fails or is misconfigured", async () => {
    const payload = JSON.stringify(validDraft());
    const failed = await handleReportSubmission(
      form(payload),
      failingRepository(new StorageUnavailableError("x")),
    );
    expect(failed).toMatchObject({
      status: "error",
      message: expect.stringMatching(/Nothing was recorded/),
    });
    const misconfigured = await handleReportSubmission(form(payload), null);
    expect(misconfigured.status).toBe("error");
  });

  it("never echoes submitted values back to the client", async () => {
    const draft = validDraft({ medicalHistory: "SECRET-HISTORY" });
    draft.reaction.outcome = "";
    const state = await handleReportSubmission(
      form(JSON.stringify(draft)),
      null,
    );
    expect(JSON.stringify(state)).not.toContain("SECRET-HISTORY");
  });
});

describe("resolveStorageStatus", () => {
  it("uses local demo storage only when no Supabase variable is set", () => {
    expect(resolveStorageStatus({})).toEqual({ mode: "local-demo" });
  });

  it("uses Supabase only when fully configured", () => {
    expect(
      resolveStorageStatus({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      }),
    ).toEqual({ mode: "supabase" });
  });

  it("fails closed on partial Supabase configuration", () => {
    expect(
      resolveStorageStatus({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      }),
    ).toEqual({
      mode: "misconfigured",
      missing: ["SUPABASE_SERVICE_ROLE_KEY"],
    });
  });
});
