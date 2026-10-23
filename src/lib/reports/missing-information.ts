import type { ReportContent } from "./schema";

export type MissingItem = {
  /** Field path, e.g. `suspectedMedicines.0.dose`. Stored with the report. */
  field: string;
  label: string;
};

/**
 * Lists clinically useful details the reporter did not provide or marked as not known.
 * Reports with gaps are still valid; this only tells the reporter and reviewers what is
 * absent. Nothing here guesses or fills in a value.
 */
export function findMissingInformation(report: ReportContent): MissingItem[] {
  const missing: MissingItem[] = [];
  const add = (field: string, label: string) => missing.push({ field, label });

  if (report.patient.ageYears === null) add("patient.ageYears", "Patient age");
  if (report.patient.sex === null || report.patient.sex === "unknown") {
    add("patient.sex", "Patient sex");
  }

  const several = report.suspectedMedicines.length > 1;
  report.suspectedMedicines.forEach((medicine, index) => {
    const prefix = several ? `${medicine.name}: ` : "";
    const path = `suspectedMedicines.${index}`;
    if (medicine.dose === null) add(`${path}.dose`, `${prefix}Dose`);
    if (medicine.route === null || medicine.route === "unknown") {
      add(`${path}.route`, `${prefix}How the medicine was taken`);
    }
    if (medicine.frequency === null)
      add(`${path}.frequency`, `${prefix}How often it was taken`);
    if (medicine.startDate === null)
      add(`${path}.startDate`, `${prefix}Date the medicine was started`);
  });

  if (report.reaction.onsetDate === null) {
    add("reaction.onsetDate", "Date the reaction started");
  }
  if (report.reaction.outcome === "unknown")
    add("reaction.outcome", "Outcome of the reaction");
  if (report.reaction.medicalAttention === "unknown") {
    add("reaction.medicalAttention", "Whether medical attention was sought");
  }

  return missing;
}
