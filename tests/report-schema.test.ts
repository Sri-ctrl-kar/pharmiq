import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorsForStep,
  isNotFutureDate,
  reportSubmissionSchema,
  toFieldErrors,
} from "@/lib/reports/schema";
import { minimalDraft, validDraft } from "./fixtures";

const errorsOf = (input: unknown) => {
  const result = reportSubmissionSchema.safeParse(input);
  return result.success ? {} : toFieldErrors(result.error.issues);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T06:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("reportSubmissionSchema", () => {
  it("accepts a complete report and normalises values", () => {
    const parsed = reportSubmissionSchema.parse(validDraft());
    expect(parsed.patient).toEqual({
      initials: "AK",
      ageYears: 34,
      sex: "female",
      state: "Karnataka",
    });
    expect(parsed.suspectedMedicines[0].name).toBe("Amoxicillin");
    expect(parsed.otherMedicines).toBeNull();
  });

  it("stores blank optional answers as null, never as invented defaults", () => {
    const parsed = reportSubmissionSchema.parse(minimalDraft());
    expect(parsed.patient).toEqual({
      initials: null,
      ageYears: null,
      sex: null,
      state: null,
    });
    expect(parsed.suspectedMedicines[0]).toEqual({
      name: "Paracetamol",
      dose: null,
      route: null,
      frequency: null,
      startDate: null,
    });
    expect(parsed.reaction.onsetDate).toBeNull();
    expect(parsed.reaction.onsetTime).toBeNull();
  });

  it("requires reporter type, a medicine name, a description, outcome and medical attention", () => {
    const draft = validDraft({ reporterType: "" });
    draft.suspectedMedicines[0].name = "";
    draft.reaction.description = "";
    draft.reaction.outcome = "";
    draft.reaction.medicalAttention = "";
    expect(Object.keys(errorsOf(draft)).sort()).toEqual([
      "reaction.description",
      "reaction.medicalAttention",
      "reaction.outcome",
      "reporterType",
      "suspectedMedicines.0.name",
    ]);
  });

  it("requires the accuracy declaration", () => {
    expect(errorsOf(validDraft({ declaration: false }))).toHaveProperty(
      "declaration",
    );
  });

  it("rejects future, impossible and malformed dates", () => {
    const draft = validDraft();
    draft.reaction.onsetDate = "2026-11-30";
    draft.suspectedMedicines[0].startDate = "2026-02-30";
    const errors = errorsOf(draft);
    expect(errors["reaction.onsetDate"]).toMatch(/future/);
    expect(errors["suspectedMedicines.0.startDate"]).toMatch(/valid date/);
  });

  it("allows today's date in time zones ahead of UTC", () => {
    expect(
      isNotFutureDate("2026-10-23", new Date("2026-10-22T20:00:00Z")),
    ).toBe(true);
    expect(
      isNotFutureDate("2026-10-25", new Date("2026-10-22T20:00:00Z")),
    ).toBe(false);
  });

  it("rejects an onset time without a date", () => {
    const draft = validDraft();
    draft.reaction.onsetDate = "";
    expect(errorsOf(draft)["reaction.onsetTime"]).toMatch(/date/);
  });

  it("validates age range and whole numbers", () => {
    for (const age of ["-1", "121", "4.5", "abc"]) {
      const draft = validDraft();
      draft.patient.ageYears = age;
      expect(errorsOf(draft)).toHaveProperty("patient.ageYears");
    }
  });

  it("rejects full names in the initials field", () => {
    const draft = validDraft();
    draft.patient.initials = "Ravi Kumar";
    expect(errorsOf(draft)["patient.initials"]).toMatch(/full name/);
  });

  it("rejects values outside the controlled vocabularies", () => {
    const draft = validDraft({ reporterType: "pharma_company" });
    draft.suspectedMedicines[0].route = "rectal-ish";
    draft.patient.state = "Atlantis";
    expect(Object.keys(errorsOf(draft))).toEqual(
      expect.arrayContaining([
        "reporterType",
        "suspectedMedicines.0.route",
        "patient.state",
      ]),
    );
  });

  it("supports several suspected medicines, but not duplicates or more than five", () => {
    const medicine = validDraft().suspectedMedicines[0];
    const two = validDraft({
      suspectedMedicines: [medicine, { ...medicine, name: "Cetirizine" }],
    });
    expect(reportSubmissionSchema.safeParse(two).success).toBe(true);

    const duplicate = validDraft({
      suspectedMedicines: [medicine, { ...medicine, name: "amoxicillin" }],
    });
    expect(errorsOf(duplicate)["suspectedMedicines.1.name"]).toMatch(
      /already listed/,
    );

    const six = validDraft({
      suspectedMedicines: Array.from({ length: 6 }, (_, i) => ({
        ...medicine,
        name: `Medicine ${i}`,
      })),
    });
    expect(errorsOf(six)).toHaveProperty("suspectedMedicines");

    expect(errorsOf(validDraft({ suspectedMedicines: [] }))).toHaveProperty(
      "suspectedMedicines",
    );
  });

  it("rejects oversized free text and a malformed idempotency key", () => {
    const draft = validDraft({
      idempotencyKey: "not-a-uuid",
      medicalHistory: "x".repeat(2001),
    });
    expect(Object.keys(errorsOf(draft))).toEqual(
      expect.arrayContaining(["idempotencyKey", "medicalHistory"]),
    );
  });

  it("rejects non-object input without throwing", () => {
    for (const input of [null, "report", 42, []]) {
      expect(reportSubmissionSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("errorsForStep", () => {
  it("returns only the errors belonging to a form step", () => {
    const errors = {
      reporterType: "a",
      "patient.ageYears": "b",
      "suspectedMedicines.0.name": "c",
      "reaction.outcome": "d",
      declaration: "e",
    };
    expect(Object.keys(errorsForStep(errors, "reporter"))).toEqual([
      "reporterType",
      "patient.ageYears",
    ]);
    expect(Object.keys(errorsForStep(errors, "medicines"))).toEqual([
      "suspectedMedicines.0.name",
    ]);
    expect(Object.keys(errorsForStep(errors, "review"))).toEqual([
      "declaration",
    ]);
  });
});
