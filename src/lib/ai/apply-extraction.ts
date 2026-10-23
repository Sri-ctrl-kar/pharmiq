import { MAX_MEDICINES, MAX_SYMPTOMS } from "@/lib/reports/constants";
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
 * - Values the reporter already entered are never overwritten, including whether they
 *   marked a medicine as suspected.
 * - Whether a medicine is suspected is never pre-selected: the reporter chooses
 *   "suspected", "not suspected" or "don't add" for every medicine the AI found.
 * - Course-change details (previous dose/frequency, change date) are only applied to an
 *   entry whose status is "dose or frequency changed".
 */

export type FieldDecision = { accept: boolean; value: string };

export type MedicineRoleChoice = "suspected" | "other" | "skip" | "undecided";

export const medicineDecisionFields = [
  "dose",
  "route",
  "frequency",
  "startDate",
  "endDate",
  "courseStatus",
  "previousDose",
  "previousFrequency",
  "changeDate",
] as const;
export type MedicineDecisionField = (typeof medicineDecisionFields)[number];

export type MedicineDecision = {
  role: MedicineRoleChoice;
  name: string;
} & Record<MedicineDecisionField, FieldDecision>;

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
      // Never pre-selected, even when the reporter's words suggest it.
      role: "undecided",
      name: medicine.name.value ?? "",
      ...(Object.fromEntries(
        medicineDecisionFields.map((field) => [
          field,
          initialField(medicine[field]),
        ]),
      ) as Record<MedicineDecisionField, FieldDecision>),
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
  /** Suggestions not applied because of a limit or a rule. */
  skipped: string[];
};

const fieldLabels: Record<MedicineDecisionField, string> = {
  dose: "dose",
  route: "how taken",
  frequency: "how often",
  startDate: "start date",
  endDate: "end date",
  courseStatus: "status",
  previousDose: "previous dose",
  previousFrequency: "previous frequency",
  changeDate: "change date",
};
const courseChangeFields: MedicineDecisionField[] = [
  "previousDose",
  "previousFrequency",
  "changeDate",
];

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const accepted = (decision: FieldDecision) =>
  decision.accept && decision.value.trim() !== ""
    ? decision.value.trim()
    : null;
const isBlank = (medicine: MedicineDraft) =>
  !medicine.suspected &&
  Object.entries(medicine).every(
    ([field, value]) => field === "suspected" || String(value).trim() === "",
  );

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
    medicines: draft.medicines.map((medicine) => ({ ...medicine })),
  };
  const notSure = next.suspectedSelection === "not_sure";

  for (const decision of decisions.medicines) {
    const name = decision.name.trim();
    if (!name || decision.role === "skip" || decision.role === "undecided")
      continue;
    const wantsSuspected = decision.role === "suspected";

    let row = next.medicines.find(
      (medicine) => key(medicine.name) === key(name),
    );
    if (row) {
      if (wantsSuspected !== row.suspected) {
        kept.push(
          `${name}: ${row.suspected ? "marked" : "not marked"} as suspected, as you set it`,
        );
      }
    } else {
      row = next.medicines.find(isBlank);
      if (!row) {
        if (next.medicines.length >= MAX_MEDICINES) {
          skipped.push(
            `${name} (the form already lists ${MAX_MEDICINES} medicines)`,
          );
          continue;
        }
        row = emptyMedicineDraft();
        next.medicines.push(row);
      }
      row.name = name;
      row.suspected = wantsSuspected && !notSure;
      applied.push(
        row.suspected
          ? `Suspected medicine: ${name}`
          : `Medicine (not marked as suspected): ${name}`,
      );
      if (wantsSuspected && notSure) {
        kept.push(
          `${name}: not marked as suspected, because you chose “Not sure”`,
        );
      }
    }

    const target = row;
    const fill = (field: MedicineDecisionField, value: string) => {
      if (target[field].trim() === "") {
        target[field] = value;
        applied.push(`${name}: ${fieldLabels[field]}`);
      } else if (key(target[field]) !== key(value)) {
        kept.push(`${name}: ${fieldLabels[field]}`);
      }
    };
    for (const field of medicineDecisionFields) {
      if (courseChangeFields.includes(field)) continue;
      const value = accepted(decision[field]);
      if (value !== null) fill(field, value);
    }
    for (const field of courseChangeFields) {
      const value = accepted(decision[field]);
      if (value === null) continue;
      if (target.courseStatus !== "dose_changed") {
        skipped.push(
          `${name}: ${fieldLabels[field]} (set the status to “Dose or frequency changed” to record it)`,
        );
        continue;
      }
      fill(field, value);
    }
  }

  if (
    next.suspectedSelection === "" &&
    next.medicines.some((medicine) => medicine.suspected)
  ) {
    next.suspectedSelection = "marked";
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
