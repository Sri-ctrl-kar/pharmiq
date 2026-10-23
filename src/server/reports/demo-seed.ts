import type { StoredReport } from "./repository";

/**
 * SYNTHETIC demonstration records. Invented for the hackathon demo; they do not
 * describe real people or real safety signals. Always stored with `isSynthetic: true`.
 */
export const syntheticSeedReports: StoredReport[] = [
  {
    reportId: "ADR-2026-SYN001",
    submittedAt: "2026-09-02T05:30:00.000Z",
    status: "submitted",
    isSynthetic: true,
    content: {
      reporterType: "patient",
      patient: {
        initials: "AK",
        ageYears: 34,
        sex: "female",
        state: "Karnataka",
      },
      suspectedMedicines: [
        {
          name: "Amoxicillin",
          dose: "500 mg",
          route: "oral",
          frequency: "Three times a day",
          startDate: "2026-08-28",
        },
      ],
      reaction: {
        description:
          "[Synthetic demo record] Itchy red rash on both arms noticed on the third day of the course.",
        onsetDate: "2026-08-30",
        onsetTime: null,
        symptoms: ["itchy red rash"],
        outcome: "recovering",
        medicalAttention: "clinic_or_doctor",
      },
      otherMedicines: null,
      medicalHistory: null,
      aiAssisted: false,
    },
    missingFields: [],
  },
  {
    reportId: "ADR-2026-SYN002",
    submittedAt: "2026-09-10T11:15:00.000Z",
    status: "under_review",
    isSynthetic: true,
    content: {
      reporterType: "caregiver",
      patient: {
        initials: "RS",
        ageYears: 71,
        sex: "male",
        state: "Maharashtra",
      },
      suspectedMedicines: [
        {
          name: "Metformin",
          dose: "500 mg",
          route: "oral",
          frequency: "Twice a day",
          startDate: null,
        },
        {
          name: "Atorvastatin",
          dose: null,
          route: "oral",
          frequency: "Once at night",
          startDate: "2026-07-15",
        },
      ],
      reaction: {
        description:
          "[Synthetic demo record] Reported muscle aches in both legs and tiredness for about a week.",
        onsetDate: null,
        onsetTime: null,
        symptoms: ["muscle aches", "tiredness"],
        outcome: "not_recovered",
        medicalAttention: "unknown",
      },
      otherMedicines: "Amlodipine 5 mg daily",
      medicalHistory: "Type 2 diabetes, high blood pressure",
      aiAssisted: false,
    },
    missingFields: [
      "suspectedMedicines.0.startDate",
      "suspectedMedicines.1.dose",
      "reaction.onsetDate",
      "reaction.medicalAttention",
    ],
  },
  {
    reportId: "ADR-2026-SYN003",
    submittedAt: "2026-09-21T08:45:00.000Z",
    status: "reviewed",
    isSynthetic: true,
    content: {
      reporterType: "healthcare_professional",
      patient: {
        initials: null,
        ageYears: 8,
        sex: "female",
        state: "Tamil Nadu",
      },
      suspectedMedicines: [
        {
          name: "Ibuprofen suspension",
          dose: "100 mg",
          route: "oral",
          frequency: "Every 8 hours",
          startDate: "2026-09-18",
        },
      ],
      reaction: {
        description:
          "[Synthetic demo record] Swelling around the eyes and hives about two hours after a dose.",
        onsetDate: "2026-09-19",
        onsetTime: "16:00",
        symptoms: ["swelling around the eyes", "hives"],
        outcome: "recovered",
        medicalAttention: "emergency_department",
      },
      otherMedicines: null,
      medicalHistory: "No known allergies reported",
      aiAssisted: false,
    },
    missingFields: [],
  },
];
