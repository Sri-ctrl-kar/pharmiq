import { describe, expect, it } from "vitest";
import { findMissingInformation } from "@/lib/reports/missing-information";
import { reportSubmissionSchema, toReportContent } from "@/lib/reports/schema";
import { syntheticSeedReports } from "@/server/reports/demo-seed";
import { minimalDraft, validDraft } from "./fixtures";

const content = (draft: unknown) =>
  toReportContent(reportSubmissionSchema.parse(draft));

describe("findMissingInformation", () => {
  it("reports nothing missing for a complete report", () => {
    expect(findMissingInformation(content(validDraft()))).toEqual([]);
  });

  it("lists every blank or 'not known' clinically useful field", () => {
    expect(
      findMissingInformation(content(minimalDraft())).map((item) => item.field),
    ).toEqual([
      "patient.ageYears",
      "patient.sex",
      "suspectedMedicines.0.dose",
      "suspectedMedicines.0.route",
      "suspectedMedicines.0.frequency",
      "suspectedMedicines.0.startDate",
      "reaction.onsetDate",
      "reaction.outcome",
      "reaction.medicalAttention",
    ]);
  });

  it("names the medicine when several are listed", () => {
    const medicine = validDraft().suspectedMedicines[0];
    const draft = validDraft({
      suspectedMedicines: [
        medicine,
        { ...medicine, name: "Cetirizine", dose: "" },
      ],
    });
    expect(findMissingInformation(content(draft))).toEqual([
      { field: "suspectedMedicines.1.dose", label: "Cetirizine: Dose" },
    ]);
  });

  it("matches the missing fields recorded on the synthetic seed records", () => {
    for (const report of syntheticSeedReports) {
      expect(report.isSynthetic).toBe(true);
      expect(
        findMissingInformation(report.content).map((item) => item.field),
      ).toEqual(report.missingFields);
    }
  });
});
