import { indianStatesAndUts } from "@/lib/reports/constants";
import { findMissingInformation } from "@/lib/reports/missing-information";
import { toMedicineEntry } from "@/lib/reports/medicines";
import type { ReportContent } from "@/lib/reports/schema";
import type { StatusEvent } from "@/lib/review/types";
import type { StoredReport } from "./repository";

/** A seeded record, optionally with a (synthetic) status history. */
export type SeedReport = StoredReport & { events?: StatusEvent[] };

/**
 * SYNTHETIC demonstration records. Invented for the hackathon demo; they do not
 * describe real people or real safety signals. Always stored with `isSynthetic: true`.
 */
const handWrittenSeedReports: SeedReport[] = [
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
      medicines: [
        toMedicineEntry({
          name: "Amoxicillin",
          strength: "500 mg",
          dose: "1 capsule",
          route: "oral",
          frequency: "Three times a day",
          startDate: "2026-08-28",
          endDate: "2026-08-31",
          courseStatus: "stopped",
          manufacturer: "Synthetic Example Pharma",
          batchNumber: "SYN-B1234",
          expiryDate: "2027-06",
          detailsSource: "pack_or_label",
          suspected: true,
        }),
      ],
      suspectedSelection: "marked",
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
      medicines: [
        toMedicineEntry({
          name: "Metformin",
          dose: "500 mg",
          route: "oral",
          frequency: "Twice a day",
          courseStatus: "currently_taking",
          suspected: false,
        }),
        toMedicineEntry({
          name: "Atorvastatin",
          route: "oral",
          frequency: "Once at night",
          startDate: "2026-07-15",
          courseStatus: "dose_changed",
          previousDose: "10 mg",
          changeDate: "2026-08-20",
          suspected: true,
        }),
      ],
      suspectedSelection: "marked",
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
      "medicines.0.startDate",
      "medicines.1.dose",
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
      medicines: [
        toMedicineEntry({
          name: "Ibuprofen suspension",
          strength: "100 mg/5 ml",
          dose: "100 mg",
          route: "oral",
          frequency: "Every 8 hours",
          startDate: "2026-09-18",
          endDate: "2026-09-19",
          courseStatus: "stopped",
          suspected: true,
        }),
      ],
      suspectedSelection: "marked",
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

// ---------------------------------------------------------------------------
// Deterministic generator for a larger SYNTHETIC demo dataset (reviewer dashboard).
// Random combinations of common medicines and symptoms: they carry no safety signal
// and must never be read as one. Every record is flagged isSynthetic.
// ---------------------------------------------------------------------------

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MEDICINES = [
  { name: "Amoxicillin", dose: "500 mg", frequency: "Three times a day" },
  { name: "Azithromycin", dose: "500 mg", frequency: "Once a day" },
  { name: "Paracetamol", dose: "650 mg", frequency: "Every 6 hours if needed" },
  { name: "Ibuprofen", dose: "400 mg", frequency: "Twice a day" },
  { name: "Metformin", dose: "500 mg", frequency: "Twice a day" },
  { name: "Atorvastatin", dose: "10 mg", frequency: "Once at night" },
  { name: "Amlodipine", dose: "5 mg", frequency: "Once a day" },
  { name: "Cetirizine", dose: "10 mg", frequency: "Once at night" },
  { name: "Ciprofloxacin", dose: "500 mg", frequency: "Twice a day" },
  { name: "Losartan", dose: "50 mg", frequency: "Once a day" },
] as const;
const SYMPTOMS = [
  "itchy rash",
  "nausea",
  "headache",
  "dizziness",
  "stomach upset",
  "swelling of lips",
  "muscle aches",
  "dry cough",
  "drowsiness",
  "loose stools",
  "tiredness",
  "hives",
];
const STATES = [
  "Karnataka",
  "Maharashtra",
  "Tamil Nadu",
  "Kerala",
  "Delhi",
  "Gujarat",
  "West Bengal",
  "Telangana",
] as const satisfies readonly (typeof indianStatesAndUts)[number][];
const OUTCOMES = [
  "recovered",
  "recovered",
  "recovering",
  "recovering",
  "not_recovered",
  "unknown",
] as const;
const ATTENTION = [
  "none",
  "none",
  "clinic_or_doctor",
  "clinic_or_doctor",
  "clinic_or_doctor",
  "emergency_department",
  "hospitalised",
  "unknown",
] as const;
const REPORTERS = [
  "patient",
  "patient",
  "caregiver",
  "healthcare_professional",
] as const;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function generateSyntheticReports(
  count: number,
  {
    seed = 2026,
    firstIndex = 4,
    start = "2026-05-01",
    end = "2026-10-20",
  } = {},
): SeedReport[] {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const span = Date.parse(`${end}T00:00:00Z`) - startMs;

  return Array.from({ length: count }, (_, i) => {
    const index = firstIndex + i;
    const submittedMs =
      startMs + Math.floor(random() * span) + Math.floor(random() * 86_400_000);
    const submittedAt = new Date(submittedMs).toISOString();
    const medicineCount = random() < 0.25 ? 2 : 1;
    const chosen = new Set<(typeof MEDICINES)[number]>();
    while (chosen.size < medicineCount) chosen.add(pick(MEDICINES));
    const startDaysBefore = 3 + Math.floor(random() * 20);
    // Same random draws as before Milestone 6, so the generated data is unchanged.
    const medicines = [...chosen].map((medicine) => ({
      ...toMedicineEntry({ name: medicine.name, suspected: true }),
      name: medicine.name,
      dose: random() < 0.85 ? medicine.dose : null,
      route: "oral" as const,
      frequency: random() < 0.8 ? medicine.frequency : null,
      startDate:
        random() < 0.75
          ? isoDay(submittedMs - startDaysBefore * 86_400_000)
          : null,
    }));
    const symptoms = [
      ...new Set([pick(SYMPTOMS), ...(random() < 0.5 ? [pick(SYMPTOMS)] : [])]),
    ];
    const onsetDate =
      random() < 0.8
        ? isoDay(
            submittedMs - Math.floor(random() * startDaysBefore) * 86_400_000,
          )
        : null;
    const content: ReportContent = {
      reporterType: pick(REPORTERS),
      patient: {
        initials: null,
        ageYears: random() < 0.85 ? 18 + Math.floor(random() * 65) : null,
        sex: random() < 0.85 ? (random() < 0.5 ? "female" : "male") : null,
        state: random() < 0.8 ? pick(STATES) : null,
      },
      medicines,
      suspectedSelection: "marked",
      reaction: {
        description: `[Synthetic demo record] Reported ${symptoms.join(" and ")} while taking ${medicines.map((m) => m.name.toLowerCase()).join(" and ")}.`,
        onsetDate,
        onsetTime: null,
        symptoms,
        outcome: pick(OUTCOMES),
        medicalAttention: pick(ATTENTION),
      },
      otherMedicines: null,
      medicalHistory: null,
      aiAssisted: random() < 0.4,
    };

    // Older records are more likely to have been reviewed.
    const age = 1 - (submittedMs - startMs) / span;
    const roll = random();
    const status =
      roll < 0.25 + age * 0.5
        ? "reviewed"
        : roll < 0.45 + age * 0.4
          ? "under_review"
          : "submitted";
    const events: StatusEvent[] = [];
    const reviewer = "Synthetic demo reviewer";
    if (status !== "submitted") {
      const startedAt = new Date(
        submittedMs + (1 + Math.floor(random() * 4)) * 86_400_000,
      ).toISOString();
      events.push({
        at: startedAt,
        from: "submitted",
        to: "under_review",
        note: null,
        reviewer,
      });
      if (status === "reviewed") {
        const doneAt = new Date(
          Date.parse(startedAt) + (1 + Math.floor(random() * 6)) * 86_400_000,
        ).toISOString();
        events.push({
          at: doneAt,
          from: "under_review",
          to: "reviewed",
          note: "[Synthetic] Review completed.",
          reviewer,
        });
      }
    }

    return {
      reportId: `ADR-${submittedAt.slice(0, 4)}-SYN${[Math.floor(index / 1024) % 32, Math.floor(index / 32) % 32, index % 32].map((d) => CROCKFORD[d]).join("")}`,
      submittedAt,
      status,
      isSynthetic: true,
      content,
      missingFields: findMissingInformation(content).map((item) => item.field),
      events,
    };
  });
}

/**
 * SYNTHETIC records seeded into a new local demo store: three hand-written records plus a
 * deterministic generated set for the reviewer dashboard.
 */
export const syntheticSeedReports: SeedReport[] = [
  ...handWrittenSeedReports,
  ...generateSyntheticReports(33),
];
