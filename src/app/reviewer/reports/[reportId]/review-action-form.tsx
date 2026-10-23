"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/field";
import type { ReportStatus } from "@/lib/reports/constants";
import {
  MAX_REVIEW_NOTE_LENGTH,
  noteRequired,
  reviewerStatusLabels,
  type WorkflowStatus,
} from "@/lib/review/status";
import type { ReviewActionState } from "@/server/review/handlers";
import { updateReportStatusAction } from "../../actions";
import { StatusBadge } from "../../_components/status-badge";

const NETWORK_ERROR: ReviewActionState = {
  status: "error",
  message:
    "Could not reach the server, so the status may not have changed. Reload the report and check.",
};

export function ReviewActionForm({
  reportId,
  status,
  allowed,
}: {
  reportId: string;
  status: ReportStatus;
  allowed: WorkflowStatus[];
}) {
  const [state, formAction, pending] = useActionState<
    ReviewActionState,
    FormData
  >(
    async (previous, formData) => {
      try {
        return await updateReportStatusAction(previous, formData);
      } catch {
        return NETWORK_ERROR;
      }
    },
    { status: "idle" },
  );
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const mustExplain = allowed.some((next) => noteRequired(status, next));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review status</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm">
          Current: <StatusBadge status={status} />
        </p>

        {state.status === "success" ? (
          <Alert tone="success" title="Saved">
            {state.message}
          </Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert tone="danger" title="Not saved">
            {state.message}
          </Alert>
        ) : null}

        {allowed.length === 0 ? (
          <p className="text-sm text-muted">
            No status changes are available for this report in this version.
          </p>
        ) : (
          <form
            action={formAction}
            className="flex flex-col gap-4"
            aria-busy={pending}
          >
            <input type="hidden" name="reportId" value={reportId} />
            <input type="hidden" name="expectedStatus" value={status} />
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={
                errors.nextStatus ? "next-status-error" : undefined
              }
            >
              <legend className="mb-1 text-sm font-medium">
                Change status to
              </legend>
              {allowed.map((next, index) => (
                // Keyed by the current status so the default choice resets after a change.
                <label
                  key={`${status}-${next}`}
                  className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="radio"
                    name="nextStatus"
                    value={next}
                    defaultChecked={index === 0}
                    className="size-4 accent-primary"
                  />
                  {reviewerStatusLabels[next]}
                </label>
              ))}
              {errors.nextStatus ? (
                <p
                  id="next-status-error"
                  className="text-xs font-medium text-danger"
                >
                  {errors.nextStatus}
                </p>
              ) : null}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-note">
                Note{" "}
                {mustExplain ? (
                  <span className="text-danger">(required to reopen)</span>
                ) : (
                  <span className="text-muted">(optional)</span>
                )}
              </Label>
              <Textarea
                key={status}
                id="review-note"
                name="note"
                rows={3}
                maxLength={MAX_REVIEW_NOTE_LENGTH}
                required={mustExplain}
                aria-invalid={errors.note ? true : undefined}
                aria-describedby="review-note-hint"
              />
              <p id="review-note-hint" className="text-xs text-muted">
                Recorded in the status history. Describe the review step; do not
                record a causality conclusion or patient identifiers.
              </p>
              {errors.note ? (
                <p className="text-xs font-medium text-danger">{errors.note}</p>
              ) : null}
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              {pending ? "Saving…" : "Save status"}
            </Button>
          </form>
        )}
        <p className="sr-only" aria-live="polite">
          {pending ? "Saving status" : ""}
        </p>
      </CardContent>
    </Card>
  );
}
