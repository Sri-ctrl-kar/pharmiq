import { describe, expect, it } from "vitest";
import {
  allowedNextStatuses,
  canTransition,
  reviewerStatusLabels,
  statusChangeSchema,
} from "@/lib/review/status";

const input = (overrides: Record<string, unknown> = {}) => ({
  reportId: "ADR-2026-TEST01",
  expectedStatus: "submitted",
  nextStatus: "under_review",
  note: "",
  ...overrides,
});

describe("review status workflow", () => {
  it("labels 'submitted' as Pending review", () => {
    expect(reviewerStatusLabels.submitted).toBe("Pending review");
  });

  it("allows only the defined transitions", () => {
    expect(allowedNextStatuses("submitted")).toEqual(["under_review"]);
    expect(allowedNextStatuses("under_review")).toEqual([
      "submitted",
      "reviewed",
    ]);
    expect(allowedNextStatuses("reviewed")).toEqual(["under_review"]);
    expect(allowedNextStatuses("needs_info")).toEqual([]);
    expect(allowedNextStatuses("closed")).toEqual([]);
    expect(canTransition("submitted", "reviewed")).toBe(false);
    expect(canTransition("reviewed", "submitted")).toBe(false);
  });

  it("accepts a valid change and normalises an empty note to null", () => {
    expect(statusChangeSchema.parse(input())).toEqual({
      reportId: "ADR-2026-TEST01",
      expectedStatus: "submitted",
      nextStatus: "under_review",
      note: null,
    });
  });

  it.each([
    ["skipping straight to reviewed", { nextStatus: "reviewed" }, "nextStatus"],
    [
      "no change",
      { expectedStatus: "under_review", nextStatus: "under_review" },
      "nextStatus",
    ],
    ["an unknown target status", { nextStatus: "closed" }, "nextStatus"],
    ["a malformed report ID", { reportId: "../etc/passwd" }, "reportId"],
    ["an oversized note", { note: "x".repeat(1001) }, "note"],
    [
      "reopening without a note",
      { expectedStatus: "reviewed", nextStatus: "under_review" },
      "note",
    ],
  ])("rejects %s", (_label, overrides, field) => {
    const result = statusChangeSchema.safeParse(input(overrides));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it("allows reopening with a note", () => {
    const result = statusChangeSchema.safeParse(
      input({
        expectedStatus: "reviewed",
        nextStatus: "under_review",
        note: "  New information received. ",
      }),
    );
    expect(result.success && result.data.note).toBe(
      "New information received.",
    );
  });
});
