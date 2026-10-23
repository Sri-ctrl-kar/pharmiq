import type { SubmitReportState } from "@/lib/reports/submission-state";
import type { ReportRepository } from "./repository";
import { submitReport } from "./submit-report";

/** Generous for a text-only report (limits in the schema are far smaller). */
export const MAX_PAYLOAD_CHARS = 64 * 1024;

const STORAGE_ERROR =
  "Your report could not be saved because of a problem on our side. Nothing was recorded. Your answers are still here — please try again in a moment.";

/**
 * Turns an untrusted form post into a stored report. Never echoes submitted values back
 * and never includes them in logs.
 */
export async function handleReportSubmission(
  formData: FormData,
  repository: ReportRepository | null,
): Promise<SubmitReportState> {
  const raw = formData.get("payload");
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_PAYLOAD_CHARS
  ) {
    return {
      status: "invalid",
      message:
        "The report could not be read. Please reload the page and try again.",
      fieldErrors: {},
    };
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return {
      status: "invalid",
      message:
        "The report could not be read. Please reload the page and try again.",
      fieldErrors: {},
    };
  }

  if (!repository) {
    console.error("[reports] storage is misconfigured; refusing to write");
    return { status: "error", message: STORAGE_ERROR };
  }

  const result = await submitReport(input, { repository });
  if (result.ok) {
    return {
      status: "success",
      reportId: result.reportId,
      submittedAt: result.submittedAt,
      duplicate: result.duplicate,
      missingInformation: result.missingInformation,
      storageMode: repository.mode,
    };
  }
  if (result.reason === "validation") {
    return {
      status: "invalid",
      message: "Some answers need attention before the report can be saved.",
      fieldErrors: result.fieldErrors,
    };
  }
  return { status: "error", message: STORAGE_ERROR };
}
