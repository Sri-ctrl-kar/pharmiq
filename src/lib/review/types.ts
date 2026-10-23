import type { ReportStatus } from "@/lib/reports/constants";
import type { ReportContent } from "@/lib/reports/schema";

/** One recorded status change. */
export type StatusEvent = {
  at: string;
  from: ReportStatus;
  to: ReportStatus;
  note: string | null;
  /** Display label for who made the change (never an email address). */
  reviewer: string;
};

/** A report as seen by an authorised reviewer. */
export type ReviewReport = {
  reportId: string;
  submittedAt: string;
  updatedAt: string;
  status: ReportStatus;
  isSynthetic: boolean;
  content: ReportContent;
  missingFields: string[];
  events: StatusEvent[];
};

export type ReviewerIdentity = {
  /** Stable identifier recorded with status changes. */
  id: string;
  /** Shown in the UI and in the status history. */
  label: string;
};
