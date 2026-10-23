"use server";

import type { SubmitReportState } from "@/lib/reports/submission-state";
import { handleReportSubmission } from "@/server/reports/handle-submission";
import { getReportRepository } from "@/server/reports/storage";

/** Public, unauthenticated endpoint: all input is validated in handleReportSubmission. */
export async function submitReportAction(
  _previous: SubmitReportState,
  formData: FormData,
): Promise<SubmitReportState> {
  return handleReportSubmission(formData, getReportRepository());
}
