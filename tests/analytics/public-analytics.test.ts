import { describe, expect, it } from "vitest";
import {
  ageBandOf,
  computePublicAnalytics,
  dateBuckets,
  effectiveRange,
  filterPublicRecords,
  granularityFor,
  hasPartialEdges,
  medicineOptionsOf,
  parsePublicQuery,
  publicQueryToSearchParams,
  toPublicRecord,
  weekStart,
  type PublicRecord,
} from "@/lib/analytics/public-analytics";
import { reviewReport } from "../review/fixtures";

/** SYNTHETIC public record for tests. */
const record = (overrides: Partial<PublicRecord> = {}): PublicRecord => ({
  submittedOn: "2026-06-10",
  status: "submitted",
  reporterType: "patient",
  sex: "female",
  ageBand: "18-44",
  outcome: "recovering",
  medicalAttention: "none",
  medicines: ["Amoxicillin"],
  reactionTerms: ["itchy rash"],
  ...overrides,
});
const COVERAGE = { from: "2026-01-01", to: "2026-12-31" };

describe("toPublicRecord (the boundary into public analytics)", () => {
  // Made-up marker values standing in for identifying details.
  const source = reviewReport({
    reportId: "ADR-2026-MARKER",
    submittedAt: "2026-03-31T20:00:00Z",
    content: {
      reporterType: "caregiver",
      patient: {
        initials: "Q.Z.",
        ageYears: 67,
        sex: "male",
        state: "Ladakh",
      },
      suspectedMedicines: [
        {
          name: "Ibuprofen",
          dose: "MARKER-DOSE",
          route: "oral",
          frequency: "MARKER-FREQUENCY",
          startDate: "2026-03-01",
        },
      ],
      reaction: {
        description: "MARKER description of what happened",
        onsetDate: "2026-03-05",
        onsetTime: "07:45",
        symptoms: ["stomach upset"],
        outcome: "recovered",
        medicalAttention: "clinic_or_doctor",
      },
      otherMedicines: "MARKER other medicines",
      medicalHistory: "MARKER medical history",
      aiAssisted: true,
    },
  });

  it("keeps only de-identified fields, with the submission day in IST", () => {
    const projected = toPublicRecord(source);
    expect(projected).toEqual({
      submittedOn: "2026-04-01",
      status: "submitted",
      reporterType: "caregiver",
      sex: "male",
      ageBand: "65+",
      outcome: "recovered",
      medicalAttention: "clinic_or_doctor",
      medicines: ["Ibuprofen"],
      reactionTerms: ["stomach upset"],
    });
    const text = JSON.stringify(projected);
    for (const sensitive of [
      "ADR-2026-MARKER",
      "Q.Z.",
      "Ladakh",
      "67",
      "MARKER",
      "07:45",
      "2026-03-05",
    ]) {
      expect(text).not.toContain(sensitive);
    }
  });

  it("refuses records that are not flagged synthetic", () => {
    expect(() => toPublicRecord({ ...source, isSynthetic: false })).toThrow(
      /synthetic records only/,
    );
  });

  it("bands ages and treats missing or invalid ages as not provided", () => {
    expect(ageBandOf(0)).toBe("0-17");
    expect(ageBandOf(17)).toBe("0-17");
    expect(ageBandOf(18)).toBe("18-44");
    expect(ageBandOf(44)).toBe("18-44");
    expect(ageBandOf(45)).toBe("45-64");
    expect(ageBandOf(64)).toBe("45-64");
    expect(ageBandOf(65)).toBe("65+");
    expect(ageBandOf(null)).toBeNull();
    expect(ageBandOf(undefined)).toBeNull();
    expect(ageBandOf(-1)).toBeNull();
    expect(ageBandOf(Number.NaN)).toBeNull();
  });
});

describe("parsePublicQuery", () => {
  const medicines = ["Amoxicillin", "Metformin"];

  it("falls back to 'any' for unknown or malformed values", () => {
    const { query, notices } = parsePublicQuery(
      {
        from: "2026-02-30",
        to: "yesterday",
        reporter: "robot",
        outcome: "",
        attention: "x",
        sex: "?",
        age: "200+",
        serious: "yes",
        q: "description search is not supported",
      },
      medicines,
    );
    expect(query).toEqual({});
    expect(notices).toEqual([]);
  });

  it("accepts valid values, matching medicine names case-insensitively", () => {
    const { query } = parsePublicQuery(
      {
        from: "2026-02-01",
        to: "2026-02-28",
        medicine: ["metformin", "ignored"],
        reporter: "healthcare_professional",
        sex: "female",
        age: "45-64",
        serious: "1",
      },
      medicines,
    );
    expect(query).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
      medicine: "Metformin",
      reporter: "healthcare_professional",
      sex: "female",
      age: "45-64",
      serious: "1",
    });
    expect(publicQueryToSearchParams(query)).toBe(
      "?from=2026-02-01&to=2026-02-28&medicine=Metformin&reporter=healthcare_professional&sex=female&age=45-64&serious=1",
    );
  });

  it("ignores medicines outside the dataset and inverted date ranges, with a notice", () => {
    const { query, notices } = parsePublicQuery(
      { medicine: "Unknownmab", from: "2026-05-01", to: "2026-04-01" },
      medicines,
    );
    expect(query).toEqual({});
    expect(notices).toHaveLength(2);
  });
});

describe("date ranges and buckets", () => {
  it("clips the selected range to the dataset's coverage", () => {
    expect(effectiveRange({}, COVERAGE)).toEqual(COVERAGE);
    expect(
      effectiveRange({ from: "2025-06-01", to: "2026-03-15" }, COVERAGE),
    ).toEqual({ from: "2026-01-01", to: "2026-03-15" });
    expect(effectiveRange({ from: "2027-01-01" }, COVERAGE)).toBeNull();
    expect(effectiveRange({ to: "2025-12-31" }, COVERAGE)).toBeNull();
  });

  it("uses weeks for ranges up to 92 days and months beyond", () => {
    expect(granularityFor({ from: "2026-01-01", to: "2026-04-02" })).toBe(
      "week",
    ); // 92 days
    expect(granularityFor({ from: "2026-01-01", to: "2026-04-03" })).toBe(
      "month",
    ); // 93 days
    expect(granularityFor({ from: "2026-06-10", to: "2026-06-10" })).toBe(
      "week",
    );
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // across a year
  });

  it("creates every bucket in the range, including empty ones and year changes", () => {
    const months = dateBuckets(
      { from: "2025-11-15", to: "2026-02-03" },
      "month",
    );
    expect(months.map((bucket) => bucket.key)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(months[0]).toMatchObject({
      label: "Nov 2025",
      shortLabel: "Nov ’25",
    });
    const weeks = dateBuckets({ from: "2026-10-01", to: "2026-10-20" }, "week");
    expect(weeks.map((bucket) => bucket.key)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(weeks[0].label).toBe("Week of 28 Sept 2026");
  });

  it("flags partial first or last periods", () => {
    expect(
      hasPartialEdges({ from: "2026-01-01", to: "2026-03-31" }, "month"),
    ).toBe(false);
    expect(
      hasPartialEdges({ from: "2026-01-02", to: "2026-03-31" }, "month"),
    ).toBe(true);
    expect(
      hasPartialEdges({ from: "2026-01-01", to: "2026-03-30" }, "month"),
    ).toBe(true);
    expect(
      hasPartialEdges({ from: "2026-10-05", to: "2026-10-18" }, "week"),
    ).toBe(false);
    expect(
      hasPartialEdges({ from: "2026-10-06", to: "2026-10-18" }, "week"),
    ).toBe(true);
  });
});

describe("filterPublicRecords", () => {
  const records = [
    record({ submittedOn: "2026-01-01", medicines: ["Metformin"] }),
    record({
      submittedOn: "2026-02-15",
      reporterType: "healthcare_professional",
      sex: null,
      ageBand: null,
      medicines: ["Amoxicillin", "Paracetamol"],
    }),
    record({
      submittedOn: "2026-03-31",
      outcome: "fatal",
      medicalAttention: "hospitalised",
      sex: "male",
      ageBand: "65+",
    }),
  ];
  const run = (query: Parameters<typeof filterPublicRecords>[1]) =>
    filterPublicRecords(records, query, effectiveRange(query, COVERAGE)).map(
      (r) => r.submittedOn,
    );

  it("includes both ends of the date range", () => {
    expect(run({ from: "2026-01-01", to: "2026-02-15" })).toEqual([
      "2026-01-01",
      "2026-02-15",
    ]);
    expect(run({ from: "2026-03-31" })).toEqual(["2026-03-31"]);
  });

  it("applies every field filter, combined with AND", () => {
    expect(run({ medicine: "paracetamol" })).toEqual(["2026-02-15"]);
    expect(run({ medicine: "Amoxicillin" })).toEqual([
      "2026-02-15",
      "2026-03-31",
    ]);
    expect(run({ reporter: "healthcare_professional" })).toEqual([
      "2026-02-15",
    ]);
    expect(run({ outcome: "fatal" })).toEqual(["2026-03-31"]);
    expect(run({ attention: "none" })).toEqual(["2026-01-01", "2026-02-15"]);
    expect(run({ sex: "male" })).toEqual(["2026-03-31"]);
    expect(run({ age: "18-44" })).toEqual(["2026-01-01"]);
    expect(run({ serious: "1" })).toEqual(["2026-03-31"]);
    expect(run({ medicine: "Amoxicillin", sex: "female" })).toEqual([]);
  });

  it("returns nothing when the range does not overlap the data", () => {
    expect(filterPublicRecords(records, {}, null)).toEqual([]);
  });
});

describe("computePublicAnalytics", () => {
  const records = [
    record({
      submittedOn: "2026-01-05",
      medicines: ["Amoxicillin", "Paracetamol"],
      reactionTerms: ["itchy rash", "Itchy rash", "hives"],
    }),
    // The same medicine twice in one report, spelled differently.
    record({
      submittedOn: "2026-01-20",
      medicines: ["Amoxicillin", "amoxicillin "],
      reactionTerms: [],
      sex: null,
      ageBand: null,
    }),
    // A blank medicine name and blank reaction terms.
    record({
      submittedOn: "2026-03-02",
      medicines: ["", "Metformin"],
      reactionTerms: ["  "],
      outcome: "fatal",
      status: "reviewed",
      reporterType: "healthcare_professional",
    }),
  ];
  const analytics = computePublicAnalytics(records, {}, COVERAGE);

  it("keeps report counts distinct from medicine-entry counts", () => {
    expect(analytics.reports).toBe(3);
    expect(analytics.medicineEntries).toBe(5); // named entries
    expect(analytics.medicineEntriesWithoutName).toBe(1);
    expect(analytics.distinctMedicines).toBe(3);
    // Reports naming each medicine: a report counts once per medicine.
    expect(
      analytics.topMedicines.map(({ label, count }) => [label, count]),
    ).toEqual([
      ["Amoxicillin", 2],
      ["Metformin", 1],
      ["Paracetamol", 1],
    ]);
  });

  it("counts reaction terms once per report and reports missing terms", () => {
    expect(
      analytics.topReactionTerms.map(({ label, count }) => [label, count]),
    ).toEqual([
      ["hives", 1],
      ["itchy rash", 1],
    ]);
    expect(analytics.reportsWithoutReactionTerms).toBe(2);
  });

  it("counts each report exactly once in the trend and in every breakdown", () => {
    const total = (items: { count: number }[]) =>
      items.reduce((sum, item) => sum + item.count, 0);
    expect(analytics.trend.granularity).toBe("month");
    expect(analytics.trend.items).toHaveLength(12);
    expect(analytics.trend.items.slice(0, 3).map((i) => i.count)).toEqual([
      2, 0, 1,
    ]);
    expect(total(analytics.trend.items)).toBe(3);
    for (const breakdown of [
      analytics.byStatus,
      analytics.byOutcome,
      analytics.byMedicalAttention,
      analytics.byReporterType,
      analytics.bySex,
      analytics.byAgeBand,
    ]) {
      expect(total(breakdown)).toBe(3);
    }
    expect(analytics.bySex.at(-1)).toMatchObject({
      key: "not_provided",
      count: 1,
    });
    expect(analytics.byAgeBand.at(-1)).toMatchObject({
      key: "not_provided",
      count: 1,
    });
    expect(analytics.reportedSerious).toBe(1);
  });

  it("buckets by week for short ranges, with the filters applied to every figure", () => {
    const narrow = computePublicAnalytics(
      records,
      { from: "2026-01-01", to: "2026-01-31", medicine: "Amoxicillin" },
      COVERAGE,
    );
    expect(narrow.reports).toBe(2);
    expect(narrow.trend.granularity).toBe("week");
    expect(narrow.trend.items.map((i) => [i.key, i.count])).toEqual([
      ["2025-12-29", 0],
      ["2026-01-05", 1],
      ["2026-01-12", 0],
      ["2026-01-19", 1],
      ["2026-01-26", 0],
    ]);
    expect(narrow.medicineEntries).toBe(4);
    expect(narrow.byStatus.find((s) => s.key === "reviewed")?.count).toBe(0);
  });

  it("handles an empty dataset and an out-of-range selection", () => {
    const empty = computePublicAnalytics([], {}, COVERAGE);
    expect(empty.reports).toBe(0);
    expect(empty.medicineEntries).toBe(0);
    expect(empty.topMedicines).toEqual([]);
    expect(empty.trend.items.every((item) => item.count === 0)).toBe(true);
    const outside = computePublicAnalytics(
      records,
      { from: "2027-01-01" },
      COVERAGE,
    );
    expect(outside.range).toBeNull();
    expect(outside.reports).toBe(0);
    expect(outside.trend.items).toEqual([]);
  });

  it("lists distinct medicine names for the filter, ignoring blanks", () => {
    expect(medicineOptionsOf(records)).toEqual([
      "Amoxicillin",
      "Metformin",
      "Paracetamol",
    ]);
  });
});
