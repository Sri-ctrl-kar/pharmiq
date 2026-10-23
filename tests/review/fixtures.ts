import { toMedicineEntry } from "@/lib/reports/medicines";
import type { ReviewReport } from "@/lib/review/types";

/** SYNTHETIC reviewer-side report for tests. Not real patient data. */
export function reviewReport(
  overrides: Partial<ReviewReport> & {
    reaction?: Partial<ReviewReport["content"]["reaction"]>;
    medicines?: string[];
    aiAssisted?: boolean;
    reporterType?: ReviewReport["content"]["reporterType"];
  } = {},
): ReviewReport {
  const { reaction, medicines, aiAssisted, reporterType, ...rest } = overrides;
  return {
    reportId: "ADR-2026-TEST01",
    submittedAt: "2026-09-10T06:00:00.000Z",
    updatedAt: "2026-09-10T06:00:00.000Z",
    status: "submitted",
    isSynthetic: true,
    missingFields: [],
    events: [],
    ...rest,
    content: {
      reporterType: reporterType ?? "patient",
      patient: { initials: null, ageYears: 40, sex: "female", state: "Kerala" },
      medicines: (medicines ?? ["Amoxicillin"]).map((name) =>
        toMedicineEntry({
          name,
          dose: "500 mg",
          route: "oral",
          suspected: true,
        }),
      ),
      suspectedSelection: "marked",
      reaction: {
        description:
          "[Synthetic test record] Itchy rash while taking the medicine.",
        onsetDate: null,
        onsetTime: null,
        symptoms: ["itchy rash"],
        outcome: "recovering",
        medicalAttention: "none",
        ...reaction,
      },
      otherMedicines: null,
      medicalHistory: null,
      aiAssisted: aiAssisted ?? false,
      ...rest.content,
    },
  };
}
