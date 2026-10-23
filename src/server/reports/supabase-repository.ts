import { z } from "zod";
import {
  ReportIdConflictError,
  StorageUnavailableError,
  type CreateReportResult,
  type NewReportRecord,
  type ReportRepository,
} from "./repository";

/** Minimal surface of a Supabase client used here, so tests can supply a fake. */
export type RpcClient = {
  rpc(
    fn: "submit_report",
    args: { p_report: SubmitReportPayload },
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export type SubmitReportPayload = ReturnType<typeof toSubmitReportPayload>;

const rpcResultSchema = z.object({
  report_id: z.string(),
  submitted_at: z.string(),
  duplicate: z.boolean(),
});

/** Maps a validated record to the snake_case JSON expected by public.submit_report. */
export function toSubmitReportPayload(record: NewReportRecord) {
  const { content } = record;
  return {
    public_id: record.reportId,
    idempotency_key: record.idempotencyKey,
    reporter_type: content.reporterType,
    patient_initials: content.patient.initials,
    patient_age_years: content.patient.ageYears,
    patient_sex: content.patient.sex,
    patient_state: content.patient.state,
    reaction_description: content.reaction.description,
    reaction_onset_date: content.reaction.onsetDate,
    reaction_onset_time: content.reaction.onsetTime,
    reaction_outcome: content.reaction.outcome,
    medical_attention: content.reaction.medicalAttention,
    other_medicines: content.otherMedicines,
    medical_history: content.medicalHistory,
    missing_fields: record.missingFields,
    suspected_medicines: content.suspectedMedicines.map((medicine) => ({
      name: medicine.name,
      dose: medicine.dose,
      route: medicine.route,
      frequency: medicine.frequency,
      start_date: medicine.startDate,
    })),
  };
}

/**
 * Persists reports through the `submit_report` database function. Must be constructed
 * with a service-role client on the server only; anon/authenticated roles cannot call it.
 */
export class SupabaseReportRepository implements ReportRepository {
  readonly mode = "supabase" as const;

  constructor(private readonly client: RpcClient) {}

  async create(record: NewReportRecord): Promise<CreateReportResult> {
    const { data, error } = await this.client.rpc("submit_report", {
      p_report: toSubmitReportPayload(record),
    });

    if (error) {
      if (
        error.code === "23505" &&
        error.message.includes("reports_public_id_key")
      ) {
        throw new ReportIdConflictError();
      }
      throw Object.assign(
        new StorageUnavailableError("Supabase submit_report failed"),
        {
          code: error.code ?? "unknown",
        },
      );
    }

    const parsed = rpcResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new StorageUnavailableError("Unexpected submit_report response");
    }
    return {
      reportId: parsed.data.report_id,
      submittedAt: new Date(parsed.data.submitted_at).toISOString(),
      duplicate: parsed.data.duplicate,
    };
  }
}
