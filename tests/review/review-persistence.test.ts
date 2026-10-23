import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusChangeSchema } from "@/lib/review/status";
import { syntheticSeedReports } from "@/server/reports/demo-seed";
import { LocalDemoReportRepository } from "@/server/reports/local-demo-repository";
import { submitReport } from "@/server/reports/submit-report";
import { validDraft } from "../fixtures";

const REVIEWER = { id: "demo-reviewer", label: "Demo reviewer (test)" };
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "adr-review-"));
  file = path.join(dir, "demo-reports.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const change = (
  reportId: string,
  expectedStatus: string,
  nextStatus: string,
  note = "",
) => statusChangeSchema.parse({ reportId, expectedStatus, nextStatus, note });

async function submitted(repository: LocalDemoReportRepository) {
  const result = await submitReport(validDraft(), { repository });
  if (!result.ok) throw new Error("submit failed");
  return result.reportId;
}

describe("local demo store: reviewer access and persistence", () => {
  it("lists seeded synthetic records with their synthetic status history", async () => {
    const repository = new LocalDemoReportRepository(file);
    const reports = await repository.listReports();
    expect(reports).toHaveLength(syntheticSeedReports.length);
    expect(reports.every((r) => r.isSynthetic)).toBe(true);
    expect(reports.some((r) => r.events.length > 0)).toBe(true);
  });

  it("returns a submitted report with its reporter-confirmed content", async () => {
    const repository = new LocalDemoReportRepository(file, []);
    const reportId = await submitted(repository);
    const report = await repository.getReport(reportId);
    expect(report).toMatchObject({
      reportId,
      status: "submitted",
      isSynthetic: false,
      events: [],
    });
    expect(report!.content.reaction.description).toBe(
      validDraft().reaction.description,
    );
    expect(await repository.getReport("ADR-2026-ZZZZZZ")).toBeNull();
  });

  it("persists status changes and history across repository instances", async () => {
    const first = new LocalDemoReportRepository(file, []);
    const reportId = await submitted(first);
    const started = await first.updateStatus(
      change(reportId, "submitted", "under_review"),
      REVIEWER,
    );
    expect(started).toMatchObject({
      ok: true,
      report: { status: "under_review" },
    });
    await first.updateStatus(
      change(reportId, "under_review", "reviewed", "Checked."),
      REVIEWER,
    );

    const second = new LocalDemoReportRepository(file, []); // simulates a server restart
    const report = await second.getReport(reportId);
    expect(report!.status).toBe("reviewed");
    expect(
      report!.events.map((e) => [e.from, e.to, e.note, e.reviewer]),
    ).toEqual([
      ["submitted", "under_review", null, REVIEWER.label],
      ["under_review", "reviewed", "Checked.", REVIEWER.label],
    ]);
    expect(report!.updatedAt).toBe(report!.events[1].at);
    expect(JSON.parse(await readFile(file, "utf8")).notice).toMatch(
      /not a secure production database/i,
    );
  });

  it("rejects a change based on a stale status (concurrent reviewers)", async () => {
    const repository = new LocalDemoReportRepository(file, []);
    const reportId = await submitted(repository);
    const [a, b] = await Promise.all([
      repository.updateStatus(
        change(reportId, "submitted", "under_review"),
        REVIEWER,
      ),
      repository.updateStatus(
        change(reportId, "submitted", "under_review"),
        REVIEWER,
      ),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect((await repository.getReport(reportId))!.events).toHaveLength(1);
  });

  it("refuses transitions outside the workflow even if validation was bypassed", async () => {
    const repository = new LocalDemoReportRepository(file, []);
    const reportId = await submitted(repository);
    const bypass = {
      reportId,
      expectedStatus: "submitted",
      nextStatus: "reviewed",
      note: null,
    } as const;
    expect(await repository.updateStatus(bypass, REVIEWER)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(
      await repository.updateStatus(
        change("ADR-2026-ZZZZZZ", "submitted", "under_review"),
        REVIEWER,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await repository.getReport(reportId))!.status).toBe("submitted");
  });

  it("reads demo files written before Milestone 4", async () => {
    const { writeFile } = await import("node:fs/promises");
    const legacy = {
      notice: "x",
      version: 1,
      reports: [
        {
          reportId: "ADR-2026-LEGACY",
          idempotencyKey: null,
          submittedAt: "2026-08-01T00:00:00.000Z",
          status: "submitted",
          isSynthetic: true,
          content: {
            ...validDraft(),
            reaction: { ...validDraft().reaction, symptoms: undefined },
            aiAssisted: undefined,
          },
          missingFields: [],
        },
      ],
    };
    await writeFile(file, JSON.stringify(legacy));
    const [report] = await new LocalDemoReportRepository(
      file,
      [],
    ).listReports();
    expect(report).toMatchObject({
      events: [],
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(report.content.reaction.symptoms).toEqual([]);
    expect(report.content.aiAssisted).toBe(false);
  });
});
