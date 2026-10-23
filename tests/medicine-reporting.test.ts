import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computePublicAnalytics,
  toPublicRecord,
} from "@/lib/analytics/public-analytics";
import { toMedicineEntry } from "@/lib/reports/medicines";
import {
  analyticsRecords,
  computeReviewMetrics,
  computeWorkload,
} from "@/lib/review/analytics";
import { applyReportQuery, parseReportQuery } from "@/lib/review/query";
import { buildTimeline } from "@/lib/review/timeline";
import { LocalDemoReportRepository } from "@/server/reports/local-demo-repository";
import { submitReport } from "@/server/reports/submit-report";
import { medicineDraft, validDraft } from "./fixtures";
import { reviewReport } from "./review/fixtures";

/**
 * Milestone 6 end to end below the UI: several medicines submitted, stored, read back
 * for review, shown on a timeline, and counted as ONE report. All data is synthetic.
 */

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "adr-medicines-"));
  file = path.join(dir, "demo-reports.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const threeMedicines = () =>
  validDraft({
    idempotencyKey: crypto.randomUUID(),
    medicines: [
      medicineDraft({
        name: "Amoxicillin",
        strength: "500 mg",
        dose: "1 capsule",
        frequency: "Three times a day",
        route: "oral",
        startDate: "2026-08-28",
        endDate: "2026-08-31",
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
        startDate: "2026-06-01",
        courseStatus: "dose_changed",
        previousDose: "10 mg",
        changeDate: "2026-08-15",
        suspected: true,
      }),
      medicineDraft({
        name: "Paracetamol",
        dose: "650 mg",
        courseStatus: "currently_taking",
      }),
    ],
  });

describe("persistence (local demo store)", () => {
  it("stores every medicine with its own details and returns them for review", async () => {
    const repository = new LocalDemoReportRepository(file, []);
    const result = await submitReport(threeMedicines(), { repository });
    if (!result.ok) throw new Error("submit failed");

    const report = (await repository.getReport(result.reportId))!;
    expect(report.content.suspectedSelection).toBe("marked");
    expect(
      report.content.medicines.map((m) => [
        m.name,
        m.suspected,
        m.courseStatus,
      ]),
    ).toEqual([
      ["Amoxicillin", true, "stopped"],
      ["Atorvastatin", true, "dose_changed"],
      ["Paracetamol", false, "currently_taking"],
    ]);
    expect(report.content.medicines[0]).toMatchObject({
      batchNumber: "SYN-B1234",
      expiryDate: "2027-06",
      detailsSource: "pack_or_label",
    });
    expect(report.content.medicines[1]).toMatchObject({
      previousDose: "10 mg",
      changeDate: "2026-08-15",
    });

    // Persisted across instances (it is a file, not memory).
    const again = await new LocalDemoReportRepository(file, []).getReport(
      result.reportId,
    );
    expect(again).toEqual(report);
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(raw.reports).toHaveLength(1);
  });

  it("reads a demo file written before Milestone 6", async () => {
    const { medicines: _new, suspectedSelection: _sel, ...rest } = validDraft();
    await writeFile(
      file,
      JSON.stringify({
        notice: "x",
        version: 1,
        reports: [
          {
            reportId: "ADR-2026-PRE006",
            idempotencyKey: null,
            submittedAt: "2026-08-01T00:00:00.000Z",
            status: "submitted",
            isSynthetic: true,
            content: {
              ...rest,
              patient: { initials: null, ageYears: 40, sex: null, state: null },
              suspectedMedicines: [
                {
                  name: "Amoxicillin",
                  dose: "500 mg",
                  route: "oral",
                  frequency: null,
                  startDate: null,
                },
              ],
            },
            missingFields: ["suspectedMedicines.0.startDate"],
          },
        ],
      }),
    );
    const repository = new LocalDemoReportRepository(file, []);
    const [report] = await repository.listReports();
    expect(report.content.medicines).toEqual([
      toMedicineEntry({
        name: "Amoxicillin",
        dose: "500 mg",
        route: "oral",
        suspected: true,
      }),
    ]);
    expect(report.content.suspectedSelection).toBe("marked");
    const [stored] = await repository.list();
    expect(stored.content.medicines[0].name).toBe("Amoxicillin");
  });
});

describe("reviewer display", () => {
  const report = reviewReport({
    content: {
      ...reviewReport().content,
      medicines: [
        toMedicineEntry({
          name: "Atorvastatin",
          dose: "20 mg",
          startDate: "2026-06-01",
          courseStatus: "dose_changed",
          previousDose: "10 mg",
          changeDate: "2026-08-15",
          suspected: true,
        }),
        toMedicineEntry({
          name: "Amoxicillin",
          startDate: "2026-08-28",
          endDate: "2026-08-31",
          courseStatus: "completed",
        }),
        toMedicineEntry({ name: "Cetirizine", courseStatus: "stopped" }),
      ],
      reaction: { ...reviewReport().content.reaction, onsetDate: "2026-08-30" },
    },
  });

  it("shows each medicine's own start, change and end on the timeline", () => {
    const { entries, notProvided } = buildTimeline(report);
    expect(
      entries
        .filter((e) => e.precision === "date")
        .map((e) => [e.when, e.kind, e.title]),
    ).toEqual([
      ["2026-06-01", "medicine_started", "Started Atorvastatin (suspected)"],
      [
        "2026-08-15",
        "medicine_changed",
        "Dose or frequency of Atorvastatin (suspected) changed (approximate date)",
      ],
      ["2026-08-28", "medicine_started", "Started Amoxicillin"],
      ["2026-08-30", "reaction_onset", "Reaction started"],
      ["2026-08-31", "medicine_ended", "Finished Amoxicillin"],
    ]);
    expect(entries.find((e) => e.kind === "medicine_changed")?.detail).toBe(
      "10 mg → 20 mg",
    );
    expect(notProvided).toEqual([
      "Start date for Cetirizine",
      "End date for Cetirizine",
    ]);
  });

  it("finds a report by any listed medicine, suspected or not", () => {
    const query = parseReportQuery({ medicine: "cetirizine" });
    expect(applyReportQuery([report], query).total).toBe(1);
  });
});

describe("report-count integrity", () => {
  const reports = [
    reviewReport({
      reportId: "ADR-2026-AAAAA1",
      content: {
        ...reviewReport().content,
        medicines: [
          toMedicineEntry({ name: "Amoxicillin", suspected: true }),
          toMedicineEntry({ name: "Paracetamol", suspected: false }),
          toMedicineEntry({ name: "Cetirizine", suspected: true }),
        ],
      },
    }),
    reviewReport({
      reportId: "ADR-2026-AAAAA2",
      content: {
        ...reviewReport().content,
        suspectedSelection: "not_sure",
        medicines: [
          toMedicineEntry({ name: "Amoxicillin" }),
          toMedicineEntry({ name: "Metformin" }),
        ],
      },
    }),
  ];

  it("counts reports once, with medicine entries counted separately", () => {
    const metrics = computeReviewMetrics(analyticsRecords(reports));
    expect(metrics.total).toBe(2);
    expect(metrics.medicineEntries).toBe(5);
    expect(metrics.reportsNotSure).toBe(1);
    expect(computeWorkload(reports).all.total).toBe(2);
    const sum = (items: { count: number }[]) =>
      items.reduce((total, item) => total + item.count, 0);
    expect(sum(metrics.byOutcome)).toBe(2);
    expect(sum(metrics.perMonth)).toBeLessThanOrEqual(2);
  });

  it("charts only medicines the reporter marked as suspected", () => {
    const metrics = computeReviewMetrics(reports);
    expect(
      metrics.topSuspectedMedicines.map((item) => [item.label, item.count]),
    ).toEqual([
      ["Amoxicillin", 1],
      ["Cetirizine", 1],
    ]);
  });

  it("keeps public analytics to suspected medicines and one count per report", () => {
    const records = reports.map(toPublicRecord);
    expect(records.map((r) => r.medicines)).toEqual([
      ["Amoxicillin", "Cetirizine"],
      [],
    ]);
    const analytics = computePublicAnalytics(
      records,
      {},
      { from: "2026-01-01", to: "2026-12-31" },
    );
    expect(analytics.reports).toBe(2);
    expect(analytics.medicineEntries).toBe(2);
  });
});
