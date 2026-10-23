import { describe, expect, it } from "vitest";
import type {
  VerifiedExtraction,
  VerifiedField,
} from "@/lib/ai/extraction-schema";
import { syntheticExtractionCases } from "@/lib/ai/synthetic-examples";
import { verifyExtraction } from "@/server/ai/verify-extraction";
import {
  asEnumField,
  medicine,
  missing,
  reported,
  simulatedOutput,
} from "./helpers";

/**
 * Milestone 6: several medicines with their own timelines. All model outputs here are
 * SIMULATED, hand-written stand-ins; the live Claude API is not called.
 */

const NOW = new Date("2026-10-23T06:00:00Z");
const source = syntheticExtractionCases.find(
  (c) => c.id === "dose-change-two-medicines",
)!.description;

function verified(raw: unknown, text = source): VerifiedExtraction {
  const result = verifyExtraction(raw, text, NOW);
  if (!result.ok) throw new Error("expected verification to succeed");
  return result.extraction;
}
const codes = (field: VerifiedField) => field.flags.map((flag) => flag.code);

const amlodipine = () =>
  medicine({
    name: reported("amlodipine", "amlodipine 5 mg once daily"),
    dose: reported("5 mg", "amlodipine 5 mg once daily"),
    frequency: reported("once daily", "amlodipine 5 mg once daily"),
    course_status: asEnumField(
      reported("currently_taking", "is still taking it"),
    ),
  });
const atorvastatin = (
  overrides: Parameters<typeof medicine>[0] | object = {},
) =>
  medicine({
    name: reported("atorvastatin", "atorvastatin from 10 mg to 20 mg"),
    dose: reported("20 mg", "atorvastatin from 10 mg to 20 mg"),
    course_status: asEnumField(
      reported("dose_changed", "increased his atorvastatin"),
    ),
    previous_dose: reported("10 mg", "atorvastatin from 10 mg to 20 mg"),
    change_date: reported(
      "2026-10-01",
      "On 1 October 2026 his doctor increased his atorvastatin",
    ),
    end_date: reported(
      "2026-10-10",
      "He stopped the atorvastatin on 10 October 2026",
    ),
    ...overrides,
  });

const onset = () => reported("2026-10-08", "On 8 October 2026 he got pain");

describe("separate timelines for several medicines", () => {
  it("keeps each medicine's details and requires review of every course change", () => {
    const result = verified(
      simulatedOutput({
        medicines: [amlodipine(), atorvastatin()],
        reaction_onset_date: onset(),
      }),
    );
    const [first, second] = result.medicines;
    expect(first.dose).toMatchObject({ value: "5 mg", needsReview: false });
    expect(second.dose).toMatchObject({ value: "20 mg", needsReview: false });
    expect(second.endDate).toMatchObject({
      value: "2026-10-10",
      needsReview: false,
    });
    for (const field of [
      first.courseStatus,
      second.courseStatus,
      second.previousDose,
      second.changeDate,
    ]) {
      expect(field.needsReview).toBe(true);
      expect(codes(field)).toContain("confirm_course_change");
    }
    expect(result.warnings).toEqual([]);
  });

  it("flags a dose or previous dose quoted from another medicine's sentence", () => {
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("amlodipine", "amlodipine 5 mg once daily"),
            // Taken from the atorvastatin sentence: belongs to the other medicine.
            dose: reported("20 mg", "atorvastatin from 10 mg to 20 mg"),
            previous_dose: reported(
              "10 mg",
              "atorvastatin from 10 mg to 20 mg",
            ),
          }),
          atorvastatin(),
        ],
      }),
    );
    const [amlo] = result.medicines;
    expect(codes(amlo.dose)).toContain("not_linked_to_medicine");
    expect(codes(amlo.previousDose)).toContain("not_linked_to_medicine");
    expect(amlo.dose.needsReview).toBe(true);
  });

  it("flags an end date before the start date, and a change outside the course", () => {
    const text =
      "Took cetirizine from 10 October 2026. Stopped cetirizine on 2 October 2026. Changed the cetirizine dose on 20 October 2026.";
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported(
              "cetirizine",
              "Took cetirizine from 10 October 2026",
            ),
            start_date: reported(
              "2026-10-10",
              "Took cetirizine from 10 October 2026",
            ),
            end_date: reported(
              "2026-10-02",
              "Stopped cetirizine on 2 October 2026",
            ),
            course_status: asEnumField(
              reported("dose_changed", "Changed the cetirizine dose"),
            ),
            change_date: reported(
              "2026-10-20",
              "Changed the cetirizine dose on 20 October 2026",
            ),
          }),
        ],
      }),
      text,
    );
    const [cet] = result.medicines;
    expect(codes(cet.endDate)).toContain("conflicting_dates");
    expect(codes(cet.startDate)).toContain("conflicting_dates");
    expect(codes(cet.changeDate)).toContain("conflicting_dates");
  });

  it("does not accept an end date the quote does not state", () => {
    const result = verified(
      simulatedOutput({
        medicines: [
          atorvastatin({
            end_date: reported("2026-10-10", "He stopped the atorvastatin"),
          }),
        ],
      }),
    );
    expect(codes(result.medicines[0].endDate)).toContain("date_not_verifiable");
  });

  it("warns when a stated date is not used by any suggestion", () => {
    const result = verified(
      simulatedOutput({
        medicines: [atorvastatin({ end_date: missing() })],
        reaction_onset_date: onset(),
      }),
    );
    expect(result.warnings.join(" ")).toMatch(/mentions a date/);
  });

  it("rejects model output missing the timeline fields (strict schema)", () => {
    const { end_date: _dropped, ...partial } = atorvastatin();
    const result = verifyExtraction(
      simulatedOutput({ medicines: [partial as never] }),
      source,
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "schema" });
  });
});
