import { describe, expect, it, vi } from "vitest";
import { computePublicAnalytics } from "@/lib/analytics/public-analytics";

// The public dataset must never read report storage (local demo store or Supabase).
// Any call into storage or the Supabase client fails the test.
vi.mock("@/server/reports/storage", () => {
  const forbidden = () => {
    throw new Error("public analytics must not read report storage");
  };
  return {
    resolveStorageStatus: forbidden,
    getStorageStatus: forbidden,
    getReportRepository: forbidden,
  };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("public analytics must not use Supabase");
  },
}));

const { getPublicDataset } = await import("@/server/analytics/public-dataset");

const ALLOWED_KEYS = [
  "ageBand",
  "medicalAttention",
  "medicines",
  "outcome",
  "reactionTerms",
  "reporterType",
  "sex",
  "status",
  "submittedOn",
].sort();

describe("public dataset", () => {
  const dataset = getPublicDataset();

  it("is a fixed, labelled synthetic dataset", () => {
    expect(dataset.source).toBe("synthetic");
    expect(dataset.records).toHaveLength(300);
    expect(dataset.coverage.from <= dataset.coverage.to).toBe(true);
    expect(
      dataset.records.every(
        (record) =>
          record.submittedOn >= dataset.coverage.from &&
          record.submittedOn <= dataset.coverage.to,
      ),
    ).toBe(true);
    expect(dataset.medicineOptions.length).toBeGreaterThan(0);
  });

  it("is deterministic", async () => {
    vi.resetModules();
    const again = (await import("@/server/analytics/public-dataset"))
      .getPublicDataset;
    expect(again()).toEqual(dataset);
  });

  it("holds only de-identified fields — no IDs, descriptions, notes or exact details", () => {
    for (const record of dataset.records) {
      expect(Object.keys(record).sort()).toEqual(ALLOWED_KEYS);
    }
    const text = JSON.stringify(dataset);
    for (const pattern of [
      /ADR-\d{4}-/,
      /Synthetic demo record/,
      /Synthetic demo reviewer/,
      /Review completed/,
      /initials|ageYears|state|description|medicalHistory|otherMedicines|dose|frequency|onset|events|reportId/,
    ]) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("publishes aggregates only", () => {
    const analytics = computePublicAnalytics(
      dataset.records,
      {},
      dataset.coverage,
    );
    expect(analytics.reports).toBe(300);
    expect(analytics.datasetTotal).toBe(300);
    // More medicine entries than reports: some reports name two medicines.
    expect(analytics.medicineEntries).toBeGreaterThan(analytics.reports);
    const text = JSON.stringify(analytics);
    expect(text).not.toMatch(/ADR-\d{4}-|Synthetic demo record|description/);
    // No bucket or category is keyed by anything finer than a week.
    expect(analytics.trend.granularity).toBe("month");
  });
});
