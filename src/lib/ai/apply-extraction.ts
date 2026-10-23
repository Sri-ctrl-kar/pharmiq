import { MAX_SUSPECTED_MEDICINES, MAX_SYMPTOMS } from "@/lib/reports/constants";
import {
  emptyMedicineDraft,
  type MedicineDraft,
  type ReportDraft,
} from "@/lib/reports/schema";
import type { VerifiedExtraction, VerifiedField } from "./extraction-schema";

/**
 * The reporter's decisions about AI suggestions, and how they are merged into the form.
 *
 * Rules:
 * - Only suggestions the reporter accepted are applied, using their (possibly edited) value.
 * - Suggestions needing review are never accepted by default.
 * - Values the reporter already entered are never overwritten.
 * - A medicine is only added once the reporter decides how (suspected / other / skip).
 */

export type FieldDecision = { accept: boolean; value: string };

export type MedicineRoleChoice = "suspected" | "other" | "skip" | "undecided";

export type MedicineDecision = {
  role: MedicineRoleChoice;
  name: string;
  dose: FieldDecision;
  route: FieldDecision;
  frequency: FieldDecision;
  startDate: FieldDecision;
};

export type ExtractionDecisions = {
  medicines: MedicineDecision[];
  symptoms: FieldDecision[];
  onsetDate: FieldDecision;
  onsetTime: FieldDecision;
  outcome: FieldDecision;
  medicalAttention: FieldDecision;
};

const initialField = (field: VerifiedField): FieldDecision => ({
  accept:
    field.status !== "missing" && field.value !== null && !field.needsReview,
  value: field.value ?? "",
});

export function initialDecisions(
  extraction: VerifiedExtraction,
): ExtractionDecisions {
  return {
    medicines: extraction.medicines.map((medicine) => ({
      role: medicine.name.needsReview
        ? "undecided"
        : medicine.reporterRole === "unclear"
          ? "undecided"
          : medicine.reporterRole,
      name: medicine.name.value ?? "",
      dose: initialField(medicine.dose),
      route: initialField(medicine.route),
      frequency: initialField(medicine.frequency),
      startDate: initialField(medicine.startDate),
    })),
    symptoms: extraction.symptoms.map(initialField),
    onsetDate: initialField(extraction.onsetDate),
    onsetTime: initialField(extraction.onsetTime),
    outcome: initialField(extraction.outcome),
    medicalAttention: initialField(extraction.medicalAttention),
  };
}

/** Medicines that still need a decision before suggestions can be applied. */
export function undecidedMedicines(decisions: ExtractionDecisions): string[] {
  return decisions.medicines
    .filter((medicine) => medicine.role === "undecided")
    .map((medicine) => medicine.name || "Unnamed medicine");
}

export type ApplySummary = {
  draft: ReportDraft;
  applied: string[];
  /** Suggestions not applied because the reporter had already entered something. */
  kept: string[];
  /** Suggestions not applied because of a limit. */
  skipped: string[];
};

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const accepted = (decision: FieldDecision) =>
  decision.accept && decision.value.trim() !== ""
    ? decision.value.trim()
    : null;

export function applyExtraction(
  draft: ReportDraft,
  decisions: ExtractionDecisions,
): ApplySummary {
  const applied: string[] = [];
  const kept: string[] = [];
  const skipped: string[] = [];
  const next: ReportDraft = {
    ...draft,
    patient: { ...draft.patient },
    reaction: { ...draft.reaction, symptoms: [...draft.reaction.symptoms] },
    suspectedMedicines: draft.suspectedMedicines.map((medicine) => ({
      ...medicine,
    })),
  };

  for (const decision of decisions.medicines) {
    const name = decision.name.trim();
    if (!name || decision.role === "skip" || decision.role === "undecided")
      continue;

    const values: Partial<MedicineDraft> = {
      dose: accepted(decision.dose) ?? undefined,
      route: accepted(decision.route) ?? undefined,
      frequency: accepted(decision.frequency) ?? undefined,
      startDate: accepted(decision.startDate) ?? undefined,
    };

    if (decision.role === "other") {
      if (key(next.otherMedicines).includes(key(name))) {
        kept.push(`${name} (already under other medicines)`);
        continue;
      }
      const line = [
        [name, values.dose].filter(Boolean).join(" "),
        values.frequency,
        values.startDate ? `started ${values.startDate}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      next.otherMedicines = next.otherMedicines.trim()
        ? `${next.otherMedicines.trim()}\n${line}`
        : line;
      applied.push(`Other medicine: ${name}`);
      continue;
    }

    let row = next.suspectedMedicines.find(
      (medicine) => key(medicine.name) === key(name),
    );
    if (!row) {
      row = next.suspectedMedicines.find((medicine) =>
        Object.values(medicine).every((value) => value.trim() === ""),
      );
      if (!row) {
        if (next.suspectedMedicines.length >= MAX_SUSPECTED_MEDICINES) {
          skipped.push(
            `${name} (the form already lists ${MAX_SUSPECTED_MEDICINES} suspected medicines)`,
          );
          continue;
        }
        row = emptyMedicineDraft();
        next.suspectedMedicines.push(row);
      }
      row.name = name;
      applied.push(`Suspected medicine: ${name}`);
    }
    for (const [field, value] of Object.entries(values) as [
      keyof MedicineDraft,
      string | undefined,
    ][]) {
      if (value === undefined) continue;
      if (row[field].trim() === "") {
        row[field] = value;
        applied.push(
          `${name}: ${field === "startDate" ? "start date" : field}`,
        );
      } else if (key(row[field]) !== key(value)) {
        kept.push(`${name}: ${field === "startDate" ? "start date" : field}`);
      }
    }
  }

  const reactionFields = [
    ["onsetDate", "Reaction start date"],
    ["onsetTime", "Reaction start time"],
    ["outcome", "Outcome"],
    ["medicalAttention", "Medical attention"],
  ] as const;
  for (const [field, label] of reactionFields) {
    const value = accepted(decisions[field]);
    if (value === null) continue;
    if (next.reaction[field].trim() === "") {
      next.reaction[field] = value;
      applied.push(label);
    } else if (key(next.reaction[field]) !== key(value)) {
      kept.push(label);
    }
  }

  for (const decision of decisions.symptoms) {
    const value = accepted(decision);
    if (value === null) continue;
    if (next.reaction.symptoms.some((symptom) => key(symptom) === key(value)))
      continue;
    if (next.reaction.symptoms.length >= MAX_SYMPTOMS) {
      skipped.push(`Symptom “${value}” (limit of ${MAX_SYMPTOMS})`);
      continue;
    }
    next.reaction.symptoms.push(value);
    applied.push(`Symptom: ${value}`);
  }

  if (applied.length > 0) next.aiAssisted = true;
  return { draft: next, applied, kept, skipped };
}
