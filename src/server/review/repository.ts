import type { StatusChange } from "@/lib/review/status";
import type { ReviewReport, ReviewerIdentity } from "@/lib/review/types";
import type { StorageMode } from "@/server/reports/repository";

export type StatusUpdateResult =
  | { ok: true; report: ReviewReport }
  | {
      ok: false;
      /**
       * not_found: no such report (or not visible to this reviewer).
       * conflict: the status changed since the reviewer loaded the report.
       * invalid_transition: rejected by the workflow rules.
       * forbidden: storage refused the change for this identity.
       */
      reason: "not_found" | "conflict" | "invalid_transition" | "forbidden";
    };

/**
 * Reviewer data access. Implementations must only be constructed after the caller has
 * been authorised (see src/server/auth/reviewer-session.ts); the Supabase implementation
 * additionally runs every query as the signed-in user so row-level security applies.
 */
export interface ReviewRepository {
  readonly mode: StorageMode;
  listReports(): Promise<ReviewReport[]>;
  getReport(reportId: string): Promise<ReviewReport | null>;
  updateStatus(
    change: StatusChange,
    reviewer: ReviewerIdentity,
  ): Promise<StatusUpdateResult>;
}
