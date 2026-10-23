import { z } from "zod";
import {
  medicalAttentionOptions,
  medicineRoutes,
  reactionOutcomes,
} from "@/lib/reports/constants";

/**
 * Contract for AI-assisted extraction.
 *
 * Every field the model returns has an explicit status:
 * - `reported`  — stated in the description; `value` is set and `evidence` is a verbatim quote.
 * - `ambiguous` — mentioned but unclear, partial, relative ("3 days ago") or conflicting;
 *                 `value` may be null; `note` says why.
 * - `missing`   — not mentioned; `value` and `evidence` are null.
 *
 * The wire schema (what the model must return) is strict: no extra keys anywhere, and
 * deliberately no fields for diagnosis, causality, severity or advice.
 */

export const fieldStatuses = ["reported", "ambiguous", "missing"] as const;
export type FieldStatus = (typeof fieldStatuses)[number];

const wireField = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    status: z.enum(fieldStatuses),
    value: value.nullable(),
    evidence: z.string().nullable(),
    note: z.string().nullable(),
  });

export const reporterRoles = ["suspected", "other", "unclear"] as const;
export type ReporterRole = (typeof reporterRoles)[number];

const wireMedicine = z.strictObject({
  name: wireField(z.string()),
  dose: wireField(z.string()),
  route: wireField(z.enum(medicineRoutes.values)),
  frequency: wireField(z.string()),
  start_date: wireField(z.string()),
  reporter_role: z.enum(reporterRoles),
  reporter_role_evidence: z.string().nullable(),
});

export const wireExtractionSchema = z.strictObject({
  medicines: z.array(wireMedicine),
  symptoms: z.array(wireField(z.string())),
  reaction_onset_date: wireField(z.string()),
  reaction_onset_time: wireField(z.string()),
  outcome: wireField(z.enum(reactionOutcomes.values)),
  medical_attention: wireField(z.enum(medicalAttentionOptions.values)),
});

export type WireExtraction = z.infer<typeof wireExtractionSchema>;
export type WireField = WireExtraction["reaction_onset_date"];

/** JSON Schema sent to the API as the structured-output format. */
export function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(
    wireExtractionSchema,
    {
      target: "draft-2020-12",
    },
  ) as Record<string, unknown>;
  return schema;
}

// ---------------------------------------------------------------------------
// Verified result returned to the browser (after deterministic checks).
// ---------------------------------------------------------------------------

export type ReviewFlagCode =
  | "evidence_not_found"
  | "value_not_in_evidence"
  | "inconsistent_status"
  | "invalid_date"
  | "future_date"
  | "year_not_stated"
  | "day_month_unclear"
  | "conflicting_dates"
  | "time_without_date"
  | "not_specific_medicine"
  | "duplicate_medicine"
  | "unsupported_severity"
  | "invalid_time";

export type ReviewFlag = { code: ReviewFlagCode; message: string };

export type VerifiedField = {
  status: FieldStatus;
  value: string | null;
  /** Verbatim quote from the text the model saw (identifiers already removed). */
  evidence: string | null;
  /** Model's reason for ambiguity, after safety filtering. */
  note: string | null;
  flags: ReviewFlag[];
  /** True when a person must look before this value is used. Never pre-selected. */
  needsReview: boolean;
};

export type VerifiedMedicine = {
  name: VerifiedField;
  dose: VerifiedField;
  route: VerifiedField;
  frequency: VerifiedField;
  startDate: VerifiedField;
  /** Only what the reporter said; never the model's own causality judgement. */
  reporterRole: ReporterRole;
  reporterRoleEvidence: string | null;
};

export type VerifiedExtraction = {
  medicines: VerifiedMedicine[];
  symptoms: VerifiedField[];
  onsetDate: VerifiedField;
  onsetTime: VerifiedField;
  outcome: VerifiedField;
  medicalAttention: VerifiedField;
  /** Issues that apply to the whole extraction, e.g. items dropped over the limit. */
  warnings: string[];
};

export type ExtractionErrorCode =
  | "not_configured"
  | "invalid_input"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "refused"
  | "invalid_response";

export type ExtractionResponse =
  | {
      ok: true;
      extraction: VerifiedExtraction;
      /** What was removed before the text left the server. */
      redactions: { kind: string; count: number }[];
      model: string;
    }
  | {
      ok: false;
      error: { code: ExtractionErrorCode; message: string; retryable: boolean };
    };
