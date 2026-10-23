import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/review/timeline";
import { reviewReport } from "./fixtures";

describe("buildTimeline (report details)", () => {
  const report = reviewReport({
    submittedAt: "2026-09-10T06:00:00.000Z",
    content: undefined,
    medicines: ["Metformin", "Atorvastatin"],
    reaction: { onsetDate: "2026-09-05", onsetTime: "21:00" },
    aiAssisted: true,
    events: [
      {
        at: "2026-09-12T04:00:00.000Z",
        from: "submitted",
        to: "under_review",
        note: null,
        reviewer: "Demo reviewer",
      },
      {
        at: "2026-09-13T04:00:00.000Z",
        from: "under_review",
        to: "reviewed",
        note: "Checked.",
        reviewer: "Demo reviewer",
      },
    ],
  });
  report.content.medicines[1].startDate = "2026-08-10";

  it("orders reporter dates, submission and status changes chronologically", () => {
    const { entries } = buildTimeline(report);
    expect(entries.map((e) => [e.kind, e.when])).toEqual([
      ["medicine_started", "2026-08-10"],
      ["reaction_onset", "2026-09-05"],
      ["submitted", "2026-09-10T06:00:00.000Z"],
      ["status_change", "2026-09-12T04:00:00.000Z"],
      ["status_change", "2026-09-13T04:00:00.000Z"],
    ]);
    expect(entries[0]).toMatchObject({
      title: "Started Atorvastatin (suspected)",
      source: "reporter",
      detail: "500 mg",
    });
    expect(entries[1].detail).toBe("At 21:00 (as reported)");
    expect(entries[2].detail).toMatch(/AI suggestions were used and confirmed/);
    expect(entries[4]).toMatchObject({
      title: "Under review → Reviewed",
      detail: "Demo reviewer — Checked.",
      source: "reviewer",
    });
  });

  it("lists dates the reporter did not give instead of estimating them", () => {
    expect(buildTimeline(report).notProvided).toEqual([
      "Start date for Metformin",
    ]);
    const bare = reviewReport({ reaction: { onsetDate: null } });
    expect(buildTimeline(bare).notProvided).toEqual([
      "Start date for Amoxicillin",
      "Reaction start date",
    ]);
    expect(buildTimeline(bare).entries.map((e) => e.kind)).toEqual([
      "submitted",
    ]);
  });
});
