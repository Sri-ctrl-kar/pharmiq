import {
  emptyMedicineDraft,
  type MedicineDraft,
  type ReportDraft,
} from "@/lib/reports/schema";

/** A medicine draft with only the given fields filled in. */
export const medicineDraft = (
  fields: Partial<MedicineDraft> = {},
): MedicineDraft => ({ ...emptyMedicineDraft(), ...fields });

export const FIXED_KEY = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

/** A complete, valid draft as the form would hold it (all strings). */
export function validDraft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    idempotencyKey: FIXED_KEY,
    reporterType: "patient",
    patient: {
      initials: "ak",
      ageYears: "34",
      sex: "female",
      state: "Karnataka",
    },
    medicines: [
      medicineDraft({
        name: " Amoxicillin ",
        dose: "500 mg",
        route: "oral",
        frequency: "Three times a day",
        startDate: "2026-08-28",
        suspected: true,
      }),
    ],
    suspectedSelection: "marked",
    reaction: {
      description: "Itchy red rash on both arms on the third day.",
      onsetDate: "2026-08-30",
      onsetTime: "09:15",
      symptoms: ["itchy red rash"],
      outcome: "recovering",
      medicalAttention: "clinic_or_doctor",
    },
    otherMedicines: "",
    medicalHistory: "",
    aiAssisted: false,
    declaration: true,
    ...overrides,
  };
}

/** Only the required answers; everything optional left blank. */
export function minimalDraft(): ReportDraft {
  return validDraft({
    patient: { initials: "", ageYears: "", sex: "", state: "" },
    medicines: [medicineDraft({ name: "Paracetamol", suspected: true })],
    reaction: {
      description: "Felt dizzy and had a headache.",
      onsetDate: "",
      onsetTime: "",
      symptoms: [],
      outcome: "unknown",
      medicalAttention: "unknown",
    },
  });
}
