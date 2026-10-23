import { z } from "zod";
import {
  MAX_SUSPECTED_MEDICINES,
  indianStatesAndUts,
  medicalAttentionOptions,
  medicineRoutes,
  patientSexes,
  reactionOutcomes,
  reporterTypes,
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

export const suspectedMedicineSchema = z.object({
  name: z
    .string({ error: "Enter the medicine name." })
    .trim()
    .min(2, "Enter the medicine name (brand or generic).")
    .max(200, "Keep the medicine name under 200 characters."),
  dose: optionalText(100),
  route: optionalEnum(medicineRoutes.values),
  frequency: optionalText(100),
  startDate: optionalPastDate,
});

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
    suspectedMedicines: z
      .array(suspectedMedicineSchema)
      .min(1, "Add at least one suspected medicine.")
      .max(
        MAX_SUSPECTED_MEDICINES,
        `Add up to ${MAX_SUSPECTED_MEDICINES} suspected medicines.`,
      ),
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
      outcome: requiredEnum(reactionOutcomes.values),
      medicalAttention: requiredEnum(medicalAttentionOptions.values),
    }),
    otherMedicines: optionalText(2000),
    medicalHistory: optionalText(2000),
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
    report.suspectedMedicines.forEach((medicine, index) => {
      const key = medicine.name.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["suspectedMedicines", index, "name"],
          message: "This medicine is already listed.",
        });
      }
      seen.add(key);
    });
  });

export type ReportSubmission = z.output<typeof reportSubmissionSchema>;
export type SuspectedMedicine = z.output<typeof suspectedMedicineSchema>;
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
export type MedicineDraft = Record<keyof SuspectedMedicine, string>;
export type ReportDraft = {
  idempotencyKey: string;
  reporterType: string;
  patient: Record<keyof ReportSubmission["patient"], string>;
  suspectedMedicines: MedicineDraft[];
  reaction: Record<keyof ReportSubmission["reaction"], string>;
  otherMedicines: string;
  medicalHistory: string;
  declaration: boolean;
};

export const emptyMedicineDraft = (): MedicineDraft => ({
  name: "",
  dose: "",
  route: "",
  frequency: "",
  startDate: "",
});

export const emptyReportDraft = (idempotencyKey: string): ReportDraft => ({
  idempotencyKey,
  reporterType: "",
  patient: { initials: "", ageYears: "", sex: "", state: "" },
  suspectedMedicines: [emptyMedicineDraft()],
  reaction: {
    description: "",
    onsetDate: "",
    onsetTime: "",
    outcome: "",
    medicalAttention: "",
  },
  otherMedicines: "",
  medicalHistory: "",
  declaration: false,
});

export type FieldErrors = Record<string, string>;

/** Flatten issues to `{ "suspectedMedicines.0.name": "message" }`, first message per field. */
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
  medicines: ["suspectedMedicines"],
  reaction: ["reaction."],
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
