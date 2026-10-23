import { z } from "zod";
import type { ReportStatus } from "@/lib/reports/constants";

/**
 * Reviewer workflow over the existing `report_status` enum.
 *
 *   Pending review (submitted) ──▶ Under review ──▶ Reviewed
 *            ▲                         │   ▲            │
 *            └─────────────────────────┘   └── reopen ──┘ (note required)
 *
 * `needs_info` and `closed` exist in the enum for later use; this milestone offers no
 * transitions into or out of them.
 */

export const reviewerStatusLabels: Record<ReportStatus, string> = {
  submitted: "Pending review",
  under_review: "Under review",
  reviewed: "Reviewed",
  needs_info: "Needs information",
  closed: "Closed",
};

export const reviewerStatusTone: Record<
  ReportStatus,
  "neutral" | "info" | "success" | "warning"
> = {
  submitted: "warning",
  under_review: "info",
  reviewed: "success",
  needs_info: "warning",
  closed: "neutral",
};

/** Statuses a reviewer can set in this milestone. */
export const workflowStatuses = [
  "submitted",
  "under_review",
  "reviewed",
] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

const allowedTransitions: Partial<Record<ReportStatus, WorkflowStatus[]>> = {
  submitted: ["under_review"],
  under_review: ["submitted", "reviewed"],
  reviewed: ["under_review"],
};

export function allowedNextStatuses(from: ReportStatus): WorkflowStatus[] {
  return allowedTransitions[from] ?? [];
}

export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return (allowedNextStatuses(from) as ReportStatus[]).includes(to);
}

/** Reopening a reviewed report must say why. */
export function noteRequired(from: ReportStatus, to: ReportStatus): boolean {
  return from === "reviewed" && to === "under_review";
}

export const MAX_REVIEW_NOTE_LENGTH = 1000;

const allStatuses = [
  "submitted",
  "under_review",
  "needs_info",
  "reviewed",
  "closed",
] as const satisfies readonly ReportStatus[];

/** Untrusted reviewer action input (from a form post). */
export const statusChangeSchema = z
  .object({
    reportId: z
      .string()
      .regex(/^ADR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/, "Unknown report."),
    expectedStatus: z.enum(allStatuses, {
      error: "Reload the report and try again.",
    }),
    nextStatus: z.enum(workflowStatuses, { error: "Choose a new status." }),
    note: z
      .string()
      .trim()
      .max(
        MAX_REVIEW_NOTE_LENGTH,
        `Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`,
      )
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .default(null),
  })
  .superRefine((input, ctx) => {
    if (input.expectedStatus === input.nextStatus) {
      ctx.addIssue({
        code: "custom",
        path: ["nextStatus"],
        message: "The report already has this status.",
      });
    } else if (!canTransition(input.expectedStatus, input.nextStatus)) {
      ctx.addIssue({
        code: "custom",
        path: ["nextStatus"],
        message: `A report that is “${reviewerStatusLabels[input.expectedStatus]}” cannot be moved to “${reviewerStatusLabels[input.nextStatus]}”.`,
      });
    }
    if (noteRequired(input.expectedStatus, input.nextStatus) && !input.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Add a note explaining why the review is being reopened.",
      });
    }
  });

export type StatusChange = z.output<typeof statusChangeSchema>;
