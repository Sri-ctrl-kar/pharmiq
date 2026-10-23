import { describe, expect, it } from "vitest";
import {
  analyticsRecords,
  computeReviewMetrics,
  computeWorkload,
} from "@/lib/review/analytics";
import { generateSyntheticReports } from "@/server/reports/demo-seed";
import { reviewReport } from "./fixtures";

const NOW = new Date("2026-10-23T06:00:00Z");

describe("computeReviewMetrics", () => {
  const reports = [
    reviewReport({
      reportId: "ADR-2026-AAAAAA",
      status: "submitted",
      submittedAt: "2026-10-01T04:00:00Z",
      medicines: ["Amoxicillin"],
      reaction: { symptoms: ["Itchy rash"], medicalAttention: "hospitalised" },
      aiAssisted: true,
    }),
    reviewReport({
      reportId: "ADR-2026-BBBBBB",
      status: "under_review",
      submittedAt: "2026-09-20T04:00:00Z",
      medicines: ["amoxicillin", "Cetirizine"],
      reaction: {
        symptoms: ["itchy rash", "drowsiness"],
        outcome: "recovered",
      },
      isSynthetic: false,
    }),
    reviewReport({
      reportId: "ADR-2026-CCCCCC",
      status: "reviewed",
      submittedAt: "2026-05-02T04:00:00Z",
      missingFields: ["reaction.onsetDate"],
      events: [
        {
          at: "2026-05-03T04:00:00Z",
          from: "submitted",
          to: "under_review",
          note: null,
          reviewer: "x",
        },
        {
          at: "2026-05-06T04:00:00Z",
          from: "under_review",
          to: "reviewed",
          note: null,
          reviewer: "x",
        },
      ],
    }),
    // Outside the six-month window: counted in totals, not in the monthly series.
    reviewReport({
      reportId: "ADR-2026-DDDDDD",
      status: "reviewed",
      submittedAt: "2026-03-15T04:00:00Z",
      reaction: { outcome: "fatal" },
    }),
  ];
  const metrics = computeReviewMetrics(reports, NOW);

  it("counts totals, statuses and data sources", () => {
    expect(metrics.total).toBe(4);
    expect(metrics.byStatus).toEqual({
      submitted: 1,
      under_review: 1,
      needs_info: 0,
      reviewed: 2,
      closed: 0,
    });
    expect(metrics.synthetic).toBe(3);
    expect(metrics.submittedThroughForm).toBe(1);
    expect(metrics.aiAssisted).toBe(1);
    expect(metrics.withMissingInformation).toBe(1);
  });

  it("counts reported serious events (death, admission, emergency visit)", () => {
    expect(metrics.reportedSerious).toBe(2);
  });

  it("buckets reports per month in India time over the last six months, with zero months", () => {
    expect(metrics.perMonth.map((m) => [m.key, m.count])).toEqual([
      ["2026-05", 1],
      ["2026-06", 0],
      ["2026-07", 0],
      ["2026-08", 0],
      ["2026-09", 1],
      ["2026-10", 1],
    ]);
    expect(metrics.perMonth[0].label).toBe("May 2026");
  });

  it("counts each medicine or symptom once per report, case-insensitively", () => {
    expect(metrics.topSuspectedMedicines.slice(0, 2)).toEqual([
      { key: "amoxicillin", label: "Amoxicillin", count: 4 },
      { key: "cetirizine", label: "Cetirizine", count: 1 },
    ]);
    expect(metrics.topSymptoms[0]).toEqual({
      key: "itchy rash",
      label: "itchy rash",
      count: 4,
    });
  });

  it("covers every outcome and medical attention category, including zeros", () => {
    expect(metrics.byOutcome.map((o) => o.key)).toEqual([
      "recovered",
      "recovering",
      "not_recovered",
      "recovered_with_sequelae",
      "fatal",
      "unknown",
    ]);
    expect(metrics.byOutcome.find((o) => o.key === "fatal")!.count).toBe(1);
    expect(
      metrics.byMedicalAttention.reduce((sum, a) => sum + a.count, 0),
    ).toBe(4);
  });

  it("computes median days from submission to first 'reviewed'", () => {
    expect(metrics.medianDaysToReviewed).toBe(4);
    expect(computeReviewMetrics([], NOW).medianDaysToReviewed).toBeNull();
  });

  it("handles an empty dataset", () => {
    const empty = computeReviewMetrics([], NOW);
    expect(empty.total).toBe(0);
    expect(empty.perMonth.every((m) => m.count === 0)).toBe(true);
    expect(empty.topSuspectedMedicines).toEqual([]);
  });
});

describe("synthetic demo generator", () => {
  it("is deterministic, flagged synthetic and uses valid report IDs", () => {
    const first = generateSyntheticReports(10);
    expect(generateSyntheticReports(10)).toEqual(first);
    expect(
      first.every(
        (r) =>
          r.isSynthetic &&
          /^ADR-2026-SYN[0-9A-HJKMNP-TV-Z]{3}$/.test(r.reportId),
      ),
    ).toBe(true);
    expect(new Set(first.map((r) => r.reportId)).size).toBe(10);
    expect(
      first.every((r) =>
        r.content.reaction.description.startsWith("[Synthetic demo record]"),
      ),
    ).toBe(true);
  });
});

describe("analytics scope (synthetic data only)", () => {
  // Made-up values standing in for what a real submission might contain.
  const submitted = reviewReport({
    reportId: "ADR-2026-REAL01",
    isSynthetic: false,
    status: "under_review",
    medicines: ["Zzmarkermedicine"],
    reaction: {
      symptoms: ["zzmarker symptom"],
      description: "ZZMARKER description text",
    },
    content: {
      reporterType: "patient",
      patient: {
        initials: "Q.X.",
        ageYears: 117,
        sex: "male",
        state: "Ladakh",
      },
      suspectedMedicines: [
        {
          name: "Zzmarkermedicine",
          dose: null,
          route: null,
          frequency: null,
          startDate: null,
        },
      ],
      reaction: {
        description: "ZZMARKER description text",
        onsetDate: null,
        onsetTime: null,
        symptoms: ["zzmarker symptom"],
        outcome: "fatal",
        medicalAttention: "hospitalised",
      },
      otherMedicines: "ZZMARKER other medicines",
      medicalHistory: "ZZMARKER history",
      aiAssisted: false,
    },
  });
  const synthetic = [
    reviewReport({ reportId: "ADR-2026-SYNAAA", status: "submitted" }),
    reviewReport({ reportId: "ADR-2026-SYNBBB", status: "reviewed" }),
  ];
  const all = [submitted, ...synthetic];

  it("keeps reports submitted through the form out of every chart and figure", () => {
    expect(analyticsRecords(all).map((r) => r.reportId)).toEqual([
      "ADR-2026-SYNAAA",
      "ADR-2026-SYNBBB",
    ]);
    const metrics = computeReviewMetrics(analyticsRecords(all), NOW);
    expect(metrics.total).toBe(2);
    expect(metrics.submittedThroughForm).toBe(0);
    expect(metrics.reportedSerious).toBe(0);
    expect(JSON.stringify(metrics)).not.toMatch(/zzmarker/i);
  });

  it("counts the workload by status, split by data source, as numbers only", () => {
    const workload = computeWorkload(all);
    expect(workload.all).toEqual({
      total: 3,
      synthetic: 2,
      submittedThroughForm: 1,
    });
    expect(workload.byStatus.under_review).toEqual({
      total: 1,
      synthetic: 0,
      submittedThroughForm: 1,
    });
    expect(workload.byStatus.submitted.synthetic).toBe(1);
    expect(JSON.stringify(workload)).not.toMatch(/zzmarker|Q\.X\.|Ladakh|117/i);
  });

  it("never outputs patient fields, descriptions or history, even for synthetic records", () => {
    const record = { ...submitted, isSynthetic: true };
    const output = JSON.stringify(computeReviewMetrics([record], NOW));
    for (const value of [
      "Q.X.",
      "Ladakh",
      "117",
      "ZZMARKER description",
      "ZZMARKER other",
      "ZZMARKER history",
      "ADR-2026-REAL01",
    ]) {
      expect(output).not.toContain(value);
    }
  });
});
