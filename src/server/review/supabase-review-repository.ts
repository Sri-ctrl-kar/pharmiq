import { z } from "zod";
import {
  medicalAttentionOptions,
  medicineCourseStatuses,
  medicineRoutes,
  patientSexes,
  productDetailSources,
  reactionOutcomes,
  reporterTypes,
  reportStatuses,
  suspectedSelections,
} from "@/lib/reports/constants";
import type { StatusChange } from "@/lib/review/status";
import type { ReviewReport, ReviewerIdentity } from "@/lib/review/types";
import { StorageUnavailableError } from "@/server/reports/repository";
import type { ReviewRepository, StatusUpdateResult } from "./repository";

/** Hackathon-scale limit: reviewers load at most this many reports per request. */
export const SUPABASE_LIST_LIMIT = 1000;

type DbError = { code?: string; message: string };
type DbResult = PromiseLike<{ data: unknown; error: DbError | null }>;

/**
 * The subset of a Supabase client used here. Construct it with the signed-in user's
 * session (anon key + user JWT), never the service-role key, so RLS applies.
 */
export type ReviewDbClient = {
  from(table: "reports"): {
    select(columns: string): {
      order(
        column: string,
        options: { ascending: boolean },
      ): { limit(count: number): DbResult };
      eq(column: string, value: string): { maybeSingle(): DbResult };
    };
  };
  rpc(
    fn: "review_report",
    args: {
      p_public_id: string;
      p_expected: string;
      p_next: string;
      p_note: string | null;
    },
  ): DbResult;
};

export const REVIEW_SELECT = [
  "public_id",
  "submitted_at",
  "updated_at",
  "status",
  "is_synthetic",
  "reporter_type",
  "patient_initials",
  "patient_age_years",
  "patient_sex",
  "patient_state",
  "reaction_description",
  "reaction_onset_date",
  "reaction_onset_time",
  "reaction_symptoms",
  "reaction_outcome",
  "medical_attention",
  "other_medicines",
  "medical_history",
  "ai_assisted",
  "missing_fields",
  "suspected_selection",
  "report_medicines(position,name,brand,strength,dose,route,frequency,start_date,end_date,course_status,previous_dose,previous_frequency,change_date,manufacturer,batch_number,expiry_month,details_source,is_suspected)",
  "report_status_events(from_status,to_status,note,reviewer_id,created_at)",
].join(",");

const status = z.enum(reportStatuses.values);
const rowSchema = z.object({
  public_id: z.string(),
  submitted_at: z.string(),
  updated_at: z.string(),
  status,
  is_synthetic: z.boolean(),
  reporter_type: z.enum(reporterTypes.values),
  patient_initials: z.string().nullable(),
  patient_age_years: z.number().nullable(),
  patient_sex: z.enum(patientSexes.values).nullable(),
  patient_state: z.string().nullable(),
  reaction_description: z.string(),
  reaction_onset_date: z.string().nullable(),
  reaction_onset_time: z.string().nullable(),
  reaction_symptoms: z.array(z.string()).nullable(),
  reaction_outcome: z.enum(reactionOutcomes.values),
  medical_attention: z.enum(medicalAttentionOptions.values),
  other_medicines: z.string().nullable(),
  medical_history: z.string().nullable(),
  ai_assisted: z.boolean().nullable(),
  missing_fields: z.array(z.string()).nullable(),
  suspected_selection: z.enum(suspectedSelections.values),
  report_medicines: z.array(
    z.object({
      position: z.number(),
      name: z.string(),
      brand: z.string().nullable(),
      strength: z.string().nullable(),
      dose: z.string().nullable(),
      route: z.enum(medicineRoutes.values).nullable(),
      frequency: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      course_status: z.enum(medicineCourseStatuses.values).nullable(),
      previous_dose: z.string().nullable(),
      previous_frequency: z.string().nullable(),
      change_date: z.string().nullable(),
      manufacturer: z.string().nullable(),
      batch_number: z.string().nullable(),
      expiry_month: z.string().nullable(),
      details_source: z.enum(productDetailSources.values).nullable(),
      is_suspected: z.boolean(),
    }),
  ),
  report_status_events: z
    .array(
      z.object({
        from_status: status,
        to_status: status,
        note: z.string().nullable(),
        reviewer_id: z.string().nullable(),
        created_at: z.string(),
      }),
    )
    .nullable()
    .default([]),
});

const iso = (timestamp: string) => new Date(timestamp).toISOString();

export function toReviewReport(
  raw: unknown,
  viewer: ReviewerIdentity,
): ReviewReport {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success)
    throw new StorageUnavailableError("Unexpected report row shape");
  const row = parsed.data;
  return {
    reportId: row.public_id,
    submittedAt: iso(row.submitted_at),
    updatedAt: iso(row.updated_at),
    status: row.status,
    isSynthetic: row.is_synthetic,
    content: {
      reporterType: row.reporter_type,
      patient: {
        initials: row.patient_initials,
        ageYears: row.patient_age_years,
        sex: row.patient_sex,
        state: row.patient_state as ReviewReport["content"]["patient"]["state"],
      },
      medicines: [...row.report_medicines]
        .sort((a, b) => a.position - b.position)
        .map((m) => ({
          name: m.name,
          brand: m.brand,
          strength: m.strength,
          dose: m.dose,
          route: m.route,
          frequency: m.frequency,
          startDate: m.start_date,
          endDate: m.end_date,
          courseStatus: m.course_status,
          previousDose: m.previous_dose,
          previousFrequency: m.previous_frequency,
          changeDate: m.change_date,
          manufacturer: m.manufacturer,
          batchNumber: m.batch_number,
          expiryDate: m.expiry_month,
          detailsSource: m.details_source,
          suspected: m.is_suspected,
        })),
      suspectedSelection: row.suspected_selection,
      reaction: {
        description: row.reaction_description,
        onsetDate: row.reaction_onset_date,
        onsetTime: row.reaction_onset_time?.slice(0, 5) ?? null,
        symptoms: row.reaction_symptoms ?? [],
        outcome: row.reaction_outcome,
        medicalAttention: row.medical_attention,
      },
      otherMedicines: row.other_medicines,
      medicalHistory: row.medical_history,
      aiAssisted: row.ai_assisted ?? false,
    },
    missingFields: row.missing_fields ?? [],
    events: [...(row.report_status_events ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((event) => ({
        at: iso(event.created_at),
        from: event.from_status,
        to: event.to_status,
        note: event.note,
        reviewer:
          event.reviewer_id === null
            ? "Former reviewer"
            : event.reviewer_id === viewer.id
              ? `${viewer.label} (you)`
              : `Reviewer ${event.reviewer_id.slice(0, 8)}`,
      })),
  };
}

const failureByCode: Record<
  string,
  Exclude<StatusUpdateResult, { ok: true }>["reason"]
> = {
  "42501": "forbidden",
  P0002: "not_found",
  "40001": "conflict",
  "22023": "invalid_transition",
  "22001": "invalid_transition",
};

export class SupabaseReviewRepository implements ReviewRepository {
  readonly mode = "supabase" as const;

  constructor(
    private readonly client: ReviewDbClient,
    private readonly viewer: ReviewerIdentity,
  ) {}

  async listReports(): Promise<ReviewReport[]> {
    const { data, error } = await this.client
      .from("reports")
      .select(REVIEW_SELECT)
      .order("submitted_at", { ascending: false })
      .limit(SUPABASE_LIST_LIMIT);
    if (error)
      throw withCode(new StorageUnavailableError("Report list failed"), error);
    return (Array.isArray(data) ? data : []).map((row) =>
      toReviewReport(row, this.viewer),
    );
  }

  async getReport(reportId: string): Promise<ReviewReport | null> {
    const { data, error } = await this.client
      .from("reports")
      .select(REVIEW_SELECT)
      .eq("public_id", reportId)
      .maybeSingle();
    if (error)
      throw withCode(new StorageUnavailableError("Report read failed"), error);
    return data ? toReviewReport(data, this.viewer) : null;
  }

  async updateStatus(
    change: StatusChange,
    _reviewer: ReviewerIdentity,
  ): Promise<StatusUpdateResult> {
    // The database records auth.uid() from the session; the identity is not trusted from here.
    const { error } = await this.client.rpc("review_report", {
      p_public_id: change.reportId,
      p_expected: change.expectedStatus,
      p_next: change.nextStatus,
      p_note: change.note,
    });
    if (error) {
      const reason = error.code ? failureByCode[error.code] : undefined;
      if (reason) return { ok: false, reason };
      throw withCode(
        new StorageUnavailableError("Status update failed"),
        error,
      );
    }
    const report = await this.getReport(change.reportId);
    return report ? { ok: true, report } : { ok: false, reason: "not_found" };
  }
}

function withCode(error: StorageUnavailableError, cause: DbError) {
  return Object.assign(error, { code: cause.code ?? "unknown" });
}
