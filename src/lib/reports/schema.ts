import { z } from "zod";
import {
  MAX_MEDICINES,
  MAX_SYMPTOMS,
  indianStatesAndUts,
  medicalAttentionOptions,
  medicineCourseStatuses,
  medicineRoutes,
  patientSexes,
  productDetailSources,
  reactionOutcomes,
  reporterTypes,
  suspectedSelections,
} from "./constants";

/**
 * Single source of truth for report validation. The client uses it for step-by-step
 * feedback; the server action re-validates the whole payload with it. Optional values
 * that are left blank become `null` ("not provided") — they are never defaulted.
 */

const blankToNull = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "")
    ? null
    : value;

const optionalText = (max: number) =>
  z.preprocess(
    blankToNull,
    z.string().trim().max(max, `Keep this under ${max} characters.`).nullable(),
  );

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values).nullable());

const requiredEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: "Select an option. Choose “Not known” if unsure." });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Dates are calendar dates in the reporter's time zone; allow for the furthest-ahead
// zone (UTC+14) so a correct "today" is never rejected as being in the future.
const MAX_ZONE_AHEAD_MS = 14 * 60 * 60 * 1000;

export function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function isNotFutureDate(
  value: string,
  now: Date = new Date(),
): boolean {
  const latestToday = new Date(now.getTime() + MAX_ZONE_AHEAD_MS)
    .toISOString()
    .slice(0, 10);
  return value <= latestToday;
}

const optionalPastDate = z.preprocess(
  blankToNull,
  z
    .string()
    .refine(isRealCalendarDate, "Enter a valid date.")
    .refine((value) => value >= "1900-01-01", "Enter a date after 1900.")
    .refine(
      (value) => isNotFutureDate(value),
      "This date cannot be in the future.",
    )
    .nullable(),
);

const optionalAge = z.preprocess(
  (value) => {
    const blank = blankToNull(value);
    return typeof blank === "string" && /^\d+$/.test(blank.trim())
      ? Number(blank)
      : blank;
  },
  z
    .number({ error: "Enter age in whole years, or leave blank if not known." })
    .int("Enter age in whole years.")
    .min(0, "Age cannot be negative.")
    .max(120, "Enter an age of 120 or less.")
    .nullable(),
);

/** Expiry as printed on packs: month and year, stored as YYYY-MM. */
const optionalExpiryMonth = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter the month and year, e.g. 2027-03.")
    .refine(
      (value) => value >= "1990-01" && value <= "2100-12",
      "Enter a year between 1990 and 2100.",
    )
    .nullable(),
);

const optionalBatchNumber = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(40, "Keep the batch number under 40 characters.")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/,
      "Use the letters, numbers and - / . characters printed on the pack.",
    )
    .nullable(),
);

/**
 * One medicine entry. Every entry is validated on its own; only `name` is required.
 * Blank optional fields are stored as null ("not provided"), never guessed.
 */
export const medicineEntrySchema = z
  .object({
    name: z
      .string({ error: "Enter the medicine name." })
      .trim()
      .min(2, "Enter the medicine name (brand or generic).")
      .max(200, "Keep the medicine name under 200 characters."),
    brand: optionalText(200),
    strength: optionalText(100),
    dose: optionalText(100),
    frequency: optionalText(100),
    route: optionalEnum(medicineRoutes.values),
    startDate: optionalPastDate,
    endDate: optionalPastDate,
    courseStatus: optionalEnum(medicineCourseStatuses.values),
    previousDose: optionalText(100),
    previousFrequency: optionalText(100),
    /** Approximate date the dose or frequency changed. */
    changeDate: optionalPastDate,
    manufacturer: optionalText(200),
    batchNumber: optionalBatchNumber,
    expiryDate: optionalExpiryMonth,
    detailsSource: optionalEnum(productDetailSources.values),
    /** Marked by the reporter. Never set automatically. */
    suspected: z.boolean().default(false),
  })
  .superRefine((medicine, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (
      medicine.startDate &&
      medicine.endDate &&
      medicine.endDate < medicine.startDate
    ) {
      issue("endDate", "The end date is before the start date.");
    }
    if (medicine.endDate && medicine.courseStatus === "currently_taking") {
      issue(
        "endDate",
        "Remove the end date, or change the status if the medicine was stopped or finished.",
      );
    }
    if (medicine.courseStatus === "dose_changed" && medicine.changeDate) {
      if (medicine.startDate && medicine.changeDate < medicine.startDate) {
        issue("changeDate", "The change date is before the start date.");
      }
      if (medicine.endDate && medicine.changeDate > medicine.endDate) {
        issue("changeDate", "The change date is after the end date.");
      }
    }
  })
  .transform((medicine) =>
    medicine.courseStatus === "dose_changed"
      ? medicine
      : {
          ...medicine,
          // Hidden unless the dose or frequency changed; never stored otherwise.
          previousDose: null,
          previousFrequency: null,
          changeDate: null,
        },
  );

export const reportSubmissionSchema = z
  .object({
    idempotencyKey: z.uuid(
      "Invalid submission token. Reload the page and try again.",
    ),
    reporterType: requiredEnum(reporterTypes.values),
    patient: z.object({
      initials: z.preprocess(
        blankToNull,
        z
          .string()
          .trim()
          .regex(
            /^[A-Za-z]{1,4}$/,
            "Use up to 4 letters only, e.g. RK. Do not enter a full name.",
          )
          .transform((value) => value.toUpperCase())
          .nullable(),
      ),
      ageYears: optionalAge,
      sex: optionalEnum(patientSexes.values),
      state: optionalEnum(indianStatesAndUts),
    }),
    medicines: z
      .array(medicineEntrySchema)
      .min(1, "Add at least one medicine.")
      .max(MAX_MEDICINES, `Add up to ${MAX_MEDICINES} medicines.`),
    /** "marked": the reporter ticked the suspected medicine(s); "not_sure": none ticked. */
    suspectedSelection: z.enum(suspectedSelections.values, {
      error: "Mark the medicine(s) you suspect, or choose “Not sure”.",
    }),
    reaction: z.object({
      description: z
        .string({ error: "Describe the reaction." })
        .trim()
        .min(10, "Describe what happened in at least a few words.")
        .max(4000, "Keep the description under 4000 characters."),
      onsetDate: optionalPastDate,
      onsetTime: z.preprocess(
        blankToNull,
        z.string().regex(TIME, "Enter a time like 14:30.").nullable(),
      ),
      /** Short symptom phrases in the reporter's words, e.g. "itchy rash". */
      symptoms: z
        .array(
          z
            .string()
            .trim()
            .min(2, "Each symptom needs at least 2 characters.")
            .max(100, "Keep each symptom under 100 characters."),
        )
        .max(MAX_SYMPTOMS, `List up to ${MAX_SYMPTOMS} symptoms.`)
        .default([])
        .transform((items) => [
          ...new Map(items.map((item) => [item.toLowerCase(), item])).values(),
        ]),
      outcome: requiredEnum(reactionOutcomes.values),
      medicalAttention: requiredEnum(medicalAttentionOptions.values),
    }),
    otherMedicines: optionalText(2000),
    medicalHistory: optionalText(2000),
    /** True when the reporter applied AI-extracted suggestions (always user-confirmed). */
    aiAssisted: z.boolean().default(false),
    declaration: z.literal(true, {
      error:
        "Confirm that the information is accurate to the best of your knowledge.",
    }),
  })
  .superRefine((report, ctx) => {
    if (report.reaction.onsetTime && !report.reaction.onsetDate) {
      ctx.addIssue({
        code: "custom",
        path: ["reaction", "onsetTime"],
        message: "Add the date as well, or leave the time blank.",
      });
    }
    const seen = new Set<string>();
    report.medicines.forEach((medicine, index) => {
      const key = medicine.name.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["medicines", index, "name"],
          message:
            "This medicine is already listed. Use one entry and record any dose change in its status.",
        });
      }
      seen.add(key);
    });
    if (
      report.suspectedSelection === "marked" &&
      !report.medicines.some((medicine) => medicine.suspected)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["suspectedSelection"],
        message:
          "Mark at least one medicine as suspected, or choose “Not sure”.",
      });
    }
  })
  .transform((report) =>
    report.suspectedSelection === "not_sure"
      ? {
          ...report,
          medicines: report.medicines.map((medicine) => ({
            ...medicine,
            suspected: false,
          })),
        }
      : report,
  );

export type ReportSubmission = z.output<typeof reportSubmissionSchema>;
export type MedicineEntry = z.output<typeof medicineEntrySchema>;
/** The clinical content persisted for a report (no transport-only fields). */
export type ReportContent = Omit<
  ReportSubmission,
  "idempotencyKey" | "declaration"
>;

/** Strips transport-only fields, leaving what is stored. */
export function toReportContent({
  idempotencyKey: _idempotencyKey,
  declaration: _declaration,
  ...content
}: ReportSubmission): ReportContent {
  return content;
}

/** Form state: every input is held as a string until validation. */
export type MedicineTextField = Exclude<keyof MedicineEntry, "suspected">;
export type MedicineDraft = Record<MedicineTextField, string> & {
  suspected: boolean;
};
export type ReportDraft = {
  idempotencyKey: string;
  reporterType: string;
  patient: Record<keyof ReportSubmission["patient"], string>;
  medicines: MedicineDraft[];
  /** "", "marked" or "not_sure". */
  suspectedSelection: string;
  reaction: Record<
    Exclude<keyof ReportSubmission["reaction"], "symptoms">,
    string
  > & { symptoms: string[] };
  otherMedicines: string;
  medicalHistory: string;
  aiAssisted: boolean;
  declaration: boolean;
};

export const emptyMedicineDraft = (): MedicineDraft => ({
  name: "",
  brand: "",
  strength: "",
  dose: "",
  frequency: "",
  route: "",
  startDate: "",
  endDate: "",
  courseStatus: "",
  previousDose: "",
  previousFrequency: "",
  changeDate: "",
  manufacturer: "",
  batchNumber: "",
  expiryDate: "",
  detailsSource: "",
  suspected: false,
});

export const emptyReportDraft = (idempotencyKey: string): ReportDraft => ({
  idempotencyKey,
  reporterType: "",
  patient: { initials: "", ageYears: "", sex: "", state: "" },
  medicines: [emptyMedicineDraft()],
  suspectedSelection: "",
  reaction: {
    description: "",
    onsetDate: "",
    onsetTime: "",
    symptoms: [],
    outcome: "",
    medicalAttention: "",
  },
  otherMedicines: "",
  medicalHistory: "",
  aiAssisted: false,
  declaration: false,
});

export type FieldErrors = Record<string, string>;

/** Flatten issues to `{ "medicines.0.name": "message" }`, first message per field. */
export function toFieldErrors(
  issues: readonly z.core.$ZodIssue[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_form";
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Field-error keys belonging to each form step, by path prefix. */
export const stepFieldPrefixes = {
  reporter: ["reporterType", "patient."],
  describe: ["reaction.description"],
  medicines: ["medicines", "suspectedSelection"],
  reaction: [
    "reaction.onset",
    "reaction.symptoms",
    "reaction.outcome",
    "reaction.medicalAttention",
  ],
  history: ["otherMedicines", "medicalHistory"],
  review: ["declaration", "idempotencyKey", "_form"],
} as const;

export type FormStep = keyof typeof stepFieldPrefixes;

export function errorsForStep(
  errors: FieldErrors,
  step: FormStep,
): FieldErrors {
  const prefixes = stepFieldPrefixes[step];
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) =>
      prefixes.some((prefix) => key === prefix || key.startsWith(prefix)),
    ),
  );
}
