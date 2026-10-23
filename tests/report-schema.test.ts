import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorsForStep,
  isNotFutureDate,
  reportSubmissionSchema,
  toFieldErrors,
} from "@/lib/reports/schema";
import { toMedicineEntry } from "@/lib/reports/medicines";
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
    expect(parsed.medicines[0].name).toBe("Amoxicillin");
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
    expect(parsed.medicines[0]).toEqual(
      toMedicineEntry({ name: "Paracetamol", suspected: true }),
    );
    expect(parsed.reaction.onsetDate).toBeNull();
    expect(parsed.reaction.onsetTime).toBeNull();
  });

  it("requires reporter type, a medicine name, a description, outcome and medical attention", () => {
    const draft = validDraft({ reporterType: "" });
    draft.medicines[0].name = "";
    draft.reaction.description = "";
    draft.reaction.outcome = "";
    draft.reaction.medicalAttention = "";
    expect(Object.keys(errorsOf(draft)).sort()).toEqual([
      "medicines.0.name",
      "reaction.description",
      "reaction.medicalAttention",
      "reaction.outcome",
      "reporterType",
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
    draft.medicines[0].startDate = "2026-02-30";
    const errors = errorsOf(draft);
    expect(errors["reaction.onsetDate"]).toMatch(/future/);
    expect(errors["medicines.0.startDate"]).toMatch(/valid date/);
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
    draft.medicines[0].route = "rectal-ish";
    draft.patient.state = "Atlantis";
    expect(Object.keys(errorsOf(draft))).toEqual(
      expect.arrayContaining([
        "reporterType",
        "medicines.0.route",
        "patient.state",
      ]),
    );
  });

  it("supports several medicines, but not duplicates or more than ten", () => {
    const medicine = validDraft().medicines[0];
    const two = validDraft({
      medicines: [medicine, { ...medicine, name: "Cetirizine" }],
    });
    expect(reportSubmissionSchema.safeParse(two).success).toBe(true);

    const duplicate = validDraft({
      medicines: [medicine, { ...medicine, name: "amoxicillin" }],
    });
    expect(errorsOf(duplicate)["medicines.1.name"]).toMatch(/already listed/);

    const ten = validDraft({
      medicines: Array.from({ length: 10 }, (_, i) => ({
        ...medicine,
        name: `Medicine ${i}`,
      })),
    });
    expect(reportSubmissionSchema.safeParse(ten).success).toBe(true);
    const eleven = validDraft({
      medicines: Array.from({ length: 11 }, (_, i) => ({
        ...medicine,
        name: `Medicine ${i}`,
      })),
    });
    expect(errorsOf(eleven)).toHaveProperty("medicines");

    expect(errorsOf(validDraft({ medicines: [] }))).toHaveProperty("medicines");
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
      "medicines.0.name": "c",
      suspectedSelection: "f",
      "reaction.outcome": "d",
      declaration: "e",
    };
    expect(Object.keys(errorsForStep(errors, "reporter"))).toEqual([
      "reporterType",
      "patient.ageYears",
    ]);
    expect(Object.keys(errorsForStep(errors, "medicines"))).toEqual([
      "medicines.0.name",
      "suspectedSelection",
    ]);
    expect(Object.keys(errorsForStep(errors, "review"))).toEqual([
      "declaration",
    ]);
  });
});
