import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  applyReportQuery,
  hasActiveFilters,
  istDate,
  parseReportQuery,
  queryToSearchParams,
} from "@/lib/review/query";
import { reviewReport } from "./fixtures";

const reports = [
  reviewReport({
    reportId: "ADR-2026-AAAAAA",
    submittedAt: "2026-08-01T05:00:00.000Z",
    status: "reviewed",
    medicines: ["Metformin", "Atorvastatin"],
    reaction: {
      symptoms: ["muscle aches"],
      outcome: "not_recovered",
      onsetDate: "2026-07-28",
      medicalAttention: "clinic_or_doctor",
    },
    reporterType: "caregiver",
  }),
  reviewReport({
    reportId: "ADR-2026-BBBBBB",
    submittedAt: "2026-09-15T05:00:00.000Z",
    status: "submitted",
    isSynthetic: false,
    medicines: ["Amoxicillin"],
    reaction: {
      symptoms: ["itchy rash", "swelling of lips"],
      outcome: "recovering",
      medicalAttention: "emergency_department",
      onsetDate: "2026-09-14",
    },
    aiAssisted: true,
  }),
  reviewReport({
    reportId: "ADR-2026-CCCCCC",
    submittedAt: "2026-10-02T20:00:00.000Z", // 3 Oct in India (UTC+5:30)
    status: "under_review",
    medicines: ["Cetirizine"],
    reaction: {
      symptoms: ["drowsiness"],
      outcome: "recovered",
      medicalAttention: "none",
    },
    reporterType: "healthcare_professional",
  }),
];

const ids = (query: Record<string, string>) =>
  applyReportQuery(reports, parseReportQuery(query)).items.map((r) =>
    r.reportId.slice(-1),
  );

describe("parseReportQuery", () => {
  it("falls back to safe defaults for invalid or unknown values", () => {
    const query = parseReportQuery({
      status: "deleted",
      sort: "drop table",
      page: "-3",
      from: "yesterday",
      q: ["first", "second"],
      outcome: "",
    });
    expect(query).toMatchObject({
      status: undefined,
      sort: "newest",
      page: 1,
      from: undefined,
      q: "first",
      outcome: undefined,
      data: "all",
    });
  });

  it("round-trips non-default values to the URL", () => {
    const query = parseReportQuery({
      status: "submitted",
      sort: "oldest",
      medicine: "amox",
    });
    expect(queryToSearchParams(query)).toBe(
      "?medicine=amox&status=submitted&sort=oldest",
    );
    expect(queryToSearchParams(parseReportQuery({}))).toBe("");
    expect(hasActiveFilters(parseReportQuery({ sort: "oldest" }))).toBe(false);
    expect(hasActiveFilters(query)).toBe(true);
  });
});

describe("filtering", () => {
  it("filters by status, outcome, medical attention and reporter type", () => {
    expect(ids({ status: "submitted" })).toEqual(["B"]);
    expect(ids({ outcome: "not_recovered" })).toEqual(["A"]);
    expect(ids({ attention: "emergency_department" })).toEqual(["B"]);
    expect(ids({ reporter: "healthcare_professional" })).toEqual(["C"]);
  });

  it("filters by suspected medicine (case-insensitive, partial)", () => {
    expect(ids({ medicine: "STATIN" })).toEqual(["A"]);
    expect(ids({ medicine: "paracetamol" })).toEqual([]);
  });

  it("searches report ID, description, symptoms and medicine names", () => {
    expect(ids({ q: "swelling" })).toEqual(["B"]);
    expect(ids({ q: "adr-2026-cccccc" })).toEqual(["C"]);
    expect(ids({ q: "metformin" })).toEqual(["A"]);
  });

  it("filters reported serious events, AI assistance and data source", () => {
    expect(ids({ serious: "1" })).toEqual(["B"]);
    expect(ids({ ai: "yes" })).toEqual(["B"]);
    expect(ids({ ai: "no" })).toEqual(["C", "A"]);
    expect(ids({ data: "submitted" })).toEqual(["B"]);
    expect(ids({ data: "synthetic" })).toEqual(["C", "A"]);
  });

  it("filters by submission date in India time, inclusive", () => {
    expect(istDate("2026-10-02T20:00:00.000Z")).toBe("2026-10-03");
    expect(ids({ from: "2026-10-03" })).toEqual(["C"]);
    expect(ids({ to: "2026-10-02" })).toEqual(["B", "A"]);
    expect(ids({ from: "2026-09-15", to: "2026-09-15" })).toEqual(["B"]);
  });

  it("combines filters", () => {
    expect(
      ids({ data: "synthetic", status: "reviewed", medicine: "metformin" }),
    ).toEqual(["A"]);
    expect(ids({ data: "synthetic", status: "submitted" })).toEqual([]);
  });
});

describe("sorting and pagination", () => {
  it("sorts by submission date, onset, status and medicine", () => {
    expect(ids({})).toEqual(["C", "B", "A"]);
    expect(ids({ sort: "oldest" })).toEqual(["A", "B", "C"]);
    expect(ids({ sort: "onset" })).toEqual(["B", "A", "C"]); // C has no onset date → last
    expect(ids({ sort: "status" })).toEqual(["B", "C", "A"]);
    expect(ids({ sort: "medicine" })).toEqual(["B", "C", "A"]); // Amoxicillin, Cetirizine, Metformin
  });

  it("paginates and clamps out-of-range pages", () => {
    const many = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) =>
      reviewReport({
        reportId: `ADR-2026-${String(i).padStart(6, "0")}`,
        submittedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
      }),
    );
    const third = applyReportQuery(many, parseReportQuery({ page: "3" }));
    expect(third).toMatchObject({ total: 43, page: 3, pageCount: 3 });
    expect(third.items).toHaveLength(3);
    expect(applyReportQuery(many, parseReportQuery({ page: "99" })).page).toBe(
      3,
    );
    expect(applyReportQuery([], parseReportQuery({}))).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
    });
  });
});
