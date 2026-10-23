/**
 * Controlled vocabularies for ADR reports. Values are stored in the database;
 * labels are display text. Keep in sync with the enums in
 * supabase/migrations/*_reports.sql.
 */

function options<const T extends Record<string, string>>(labels: T) {
  return {
    values: Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]],
    labels,
  };
}

export const reporterTypes = options({
  patient: "Patient (reporting about myself)",
  caregiver: "Caregiver or family member",
  healthcare_professional: "Healthcare professional",
});

export const patientSexes = options({
  female: "Female",
  male: "Male",
  other: "Other",
  unknown: "Prefer not to say / not known",
});

export const medicineRoutes = options({
  oral: "By mouth (tablet, capsule, syrup)",
  topical: "On the skin (cream, ointment, patch)",
  injection_iv: "Injection into a vein (IV)",
  injection_im: "Injection into a muscle (IM)",
  injection_sc: "Injection under the skin",
  inhaled: "Inhaled",
  eye_ear_nose: "Eye, ear or nose drops / spray",
  other: "Other",
  unknown: "Not known",
});

export const reactionOutcomes = options({
  recovered: "Recovered",
  recovering: "Recovering",
  not_recovered: "Not yet recovered",
  recovered_with_sequelae: "Recovered with lasting effects",
  fatal: "Died",
  unknown: "Not known",
});

export const medicalAttentionOptions = options({
  none: "No medical attention sought",
  clinic_or_doctor: "Saw a doctor or visited a clinic",
  emergency_department: "Went to an emergency department",
  hospitalised: "Admitted to hospital",
  unknown: "Not known",
});

export const reportStatuses = options({
  submitted: "Submitted",
  under_review: "Under review",
  needs_info: "Needs information",
  reviewed: "Reviewed",
  closed: "Closed",
});

export const indianStatesAndUts = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const MAX_SUSPECTED_MEDICINES = 5;

export type ReporterType = (typeof reporterTypes.values)[number];
export type PatientSex = (typeof patientSexes.values)[number];
export type MedicineRoute = (typeof medicineRoutes.values)[number];
export type ReactionOutcome = (typeof reactionOutcomes.values)[number];
export type MedicalAttention = (typeof medicalAttentionOptions.values)[number];
export type ReportStatus = (typeof reportStatuses.values)[number];
