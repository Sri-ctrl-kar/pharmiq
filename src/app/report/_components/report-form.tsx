"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/choice";
import type { ReporterType } from "@/lib/reports/constants";
import { newIdempotencyKey } from "@/lib/reports/idempotency";
import { findMissingInformation } from "@/lib/reports/missing-information";
import { findPossibleIdentifiers } from "@/lib/reports/privacy";
import {
  emptyMedicineDraft,
  emptyReportDraft,
  errorsForStep,
  reportSubmissionSchema,
  toFieldErrors,
  toReportContent,
  type FieldErrors,
  type FormStep,
  type MedicineDraft,
  type ReportDraft,
} from "@/lib/reports/schema";
import {
  initialSubmitReportState,
  type StorageModeLabel,
  type SubmitReportState,
} from "@/lib/reports/submission-state";
import { safetyCopy } from "@/lib/site";
import { cn } from "@/lib/utils";
import { submitReportAction } from "../actions";
import {
  HistoryStep,
  MedicinesStep,
  ReactionStep,
  ReporterStep,
  fieldId,
} from "./form-steps";
import {
  IdentifierWarning,
  MissingInformationNotice,
  ReportSummary,
} from "./review-step";
import { SubmissionSuccess } from "./submission-success";

const steps: { id: FormStep; title: string }[] = [
  { id: "reporter", title: "About the report" },
  { id: "medicines", title: "Suspected medicines" },
  { id: "reaction", title: "The reaction" },
  { id: "history", title: "Other information" },
  { id: "review", title: "Review and submit" },
];

const NETWORK_ERROR =
  "We could not reach the server, so the report may not have been saved. Check your connection and submit again — you will not create a duplicate.";

/** Remounts the form with a fresh draft (and idempotency key) after a submission. */
export function ReportFormShell({
  storageMode,
}: {
  storageMode: StorageModeLabel;
}) {
  const [generation, setGeneration] = useState(0);
  return (
    <ReportForm
      key={generation}
      storageMode={storageMode}
      onReset={() => setGeneration((value) => value + 1)}
    />
  );
}

function ReportForm({
  storageMode,
  onReset,
}: {
  storageMode: StorageModeLabel;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<ReportDraft>(() =>
    emptyReportDraft(newIdempotencyKey()),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [attempted, setAttempted] = useState<Set<FormStep>>(() => new Set());
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusOnStepChange = useRef(false);

  const step = steps[stepIndex];

  const clientErrors = useMemo(() => {
    const result = reportSubmissionSchema.safeParse(draft);
    return result.success ? {} : toFieldErrors(result.error.issues);
  }, [draft]);

  // Preview of exactly what will be stored, used on the review step.
  const preview = useMemo(() => {
    const result = reportSubmissionSchema.safeParse({
      ...draft,
      declaration: true,
    });
    return result.success ? toReportContent(result.data) : null;
  }, [draft]);

  const [state, formAction, pending] = useActionState<
    SubmitReportState,
    FormData
  >(async (previous, formData) => {
    let result: SubmitReportState;
    try {
      result = await submitReportAction(previous, formData);
    } catch {
      result = { status: "error", message: NETWORK_ERROR };
    }
    if (
      result.status === "invalid" &&
      Object.keys(result.fieldErrors).length > 0
    ) {
      setServerErrors(result.fieldErrors);
      setAttempted(new Set(steps.map((s) => s.id)));
      const firstInvalid = steps.findIndex(
        (s) => Object.keys(errorsForStep(result.fieldErrors, s.id)).length > 0,
      );
      if (firstInvalid >= 0) goTo(firstInvalid);
    }
    return result;
  }, initialSubmitReportState);

  const submitted = state.status === "success";

  // Warn before leaving with unsaved answers.
  useEffect(() => {
    if (!dirty || submitted) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, submitted]);

  // Move focus to the new step's heading so keyboard and screen reader users follow along.
  useEffect(() => {
    if (!focusOnStepChange.current) return;
    focusOnStepChange.current = false;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: "nearest" });
  }, [stepIndex]);

  if (state.status === "success") {
    return (
      <SubmissionSuccess
        reportId={state.reportId}
        submittedAt={state.submittedAt}
        missingInformation={state.missingInformation}
        storageMode={state.storageMode}
        onReportAnother={onReset}
      />
    );
  }

  function update(change: (current: ReportDraft) => ReportDraft) {
    setDraft(change);
    setServerErrors({});
    setDirty(true);
  }

  function goTo(index: number) {
    focusOnStepChange.current = true;
    setStepIndex(index);
    setFurthestStep((furthest) => Math.max(furthest, index));
  }

  function errorsFor(target: FormStep): FieldErrors {
    if (!attempted.has(target)) return errorsForStep(serverErrors, target);
    return {
      ...errorsForStep(serverErrors, target),
      ...errorsForStep(clientErrors, target),
    };
  }

  function next() {
    setAttempted((current) => new Set(current).add(step.id));
    const stepErrors = errorsForStep(clientErrors, step.id);
    const firstKey = Object.keys(stepErrors)[0];
    if (firstKey) {
      const target =
        document.getElementById(fieldId(firstKey)) ??
        document.querySelector<HTMLElement>(`[name="${firstKey}"]`);
      target?.focus();
      return;
    }
    goTo(stepIndex + 1);
  }

  const errors = errorsFor(step.id);
  const blockingSteps = steps.filter(
    (s) =>
      s.id !== "review" &&
      Object.keys(errorsForStep(clientErrors, s.id)).length > 0,
  );
  const identifierKinds = [
    ...new Set(
      [
        draft.reaction.description,
        draft.otherMedicines,
        draft.medicalHistory,
      ].flatMap(findPossibleIdentifiers),
    ),
  ];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Report steps">
        <p className="mb-2 text-sm text-muted sm:hidden">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted sm:hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
        <ol className="hidden gap-2 sm:grid sm:grid-cols-5">
          {steps.map((s, index) => {
            const reachable = index <= furthestStep;
            const current = index === stepIndex;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!reachable || pending}
                  onClick={() => goTo(index)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 border-t-4 pt-2 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed",
                    current
                      ? "border-primary text-primary"
                      : reachable
                        ? "border-primary/40 text-foreground hover:border-primary"
                        : "border-border text-muted",
                  )}
                >
                  <span className="text-muted">Step {index + 1}</span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card>
        <CardContent className="flex flex-col gap-6">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight focus:outline-none"
          >
            {step.title}
          </h2>

          {step.id === "reporter" ? (
            <ReporterStep
              draft={draft}
              errors={errors}
              onReporterType={(value: ReporterType) =>
                update((d) => ({ ...d, reporterType: value }))
              }
              onPatient={(key, value) =>
                update((d) => ({
                  ...d,
                  patient: { ...d.patient, [key]: value },
                }))
              }
            />
          ) : null}

          {step.id === "medicines" ? (
            <MedicinesStep
              draft={draft}
              errors={errors}
              onMedicine={(index, key: keyof MedicineDraft, value) =>
                update((d) => ({
                  ...d,
                  suspectedMedicines: d.suspectedMedicines.map((medicine, i) =>
                    i === index ? { ...medicine, [key]: value } : medicine,
                  ),
                }))
              }
              onAdd={() =>
                update((d) => ({
                  ...d,
                  suspectedMedicines: [
                    ...d.suspectedMedicines,
                    emptyMedicineDraft(),
                  ],
                }))
              }
              onRemove={(index) =>
                update((d) => ({
                  ...d,
                  suspectedMedicines: d.suspectedMedicines.filter(
                    (_, i) => i !== index,
                  ),
                }))
              }
            />
          ) : null}

          {step.id === "reaction" ? (
            <ReactionStep
              draft={draft}
              errors={errors}
              onReaction={(key, value) =>
                update((d) => ({
                  ...d,
                  reaction: { ...d.reaction, [key]: value },
                }))
              }
            />
          ) : null}

          {step.id === "history" ? (
            <HistoryStep
              draft={draft}
              errors={errors}
              onChange={(key, value) => update((d) => ({ ...d, [key]: value }))}
            />
          ) : null}

          {step.id === "review" ? (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-muted">
                Check your answers. Nothing is saved until you submit.
              </p>
              {blockingSteps.length > 0 || !preview ? (
                <Alert tone="danger" title="Some answers need attention">
                  <ul className="list-disc pl-4">
                    {blockingSteps.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="underline underline-offset-2"
                          onClick={() => {
                            setAttempted((current) =>
                              new Set(current).add(s.id),
                            );
                            goTo(steps.indexOf(s));
                          }}
                        >
                          {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <>
                  <ReportSummary
                    report={preview}
                    onEdit={(target) =>
                      goTo(steps.findIndex((s) => s.id === target))
                    }
                  />
                  <MissingInformationNotice
                    items={findMissingInformation(preview)}
                  />
                  <IdentifierWarning kinds={identifierKinds} />
                </>
              )}

              <Checkbox
                id={fieldId("declaration")}
                checked={draft.declaration}
                onChange={(event) =>
                  update((d) => ({ ...d, declaration: event.target.checked }))
                }
                aria-invalid={errors.declaration ? true : undefined}
                label="The information in this report is accurate to the best of my knowledge."
                description="I understand this report records a suspected reaction. It does not confirm that a medicine caused it."
              />
              {errors.declaration ? (
                <p className="-mt-3 text-xs font-medium text-danger">
                  {errors.declaration}
                </p>
              ) : null}

              {state.status === "error" ? (
                <Alert tone="danger" title="Report not saved">
                  {state.message}
                </Alert>
              ) : null}
              {state.status === "invalid" ? (
                <Alert tone="danger" title="Report not saved">
                  {state.message}
                </Alert>
              ) : null}
              {storageMode === "local-demo" ? (
                <p className="text-xs text-muted">
                  {safetyCopy.localDemoStorage}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>

        <div className="flex flex-col-reverse gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {stepIndex > 0 ? (
            <Button
              variant="secondary"
              onClick={() => goTo(stepIndex - 1)}
              disabled={pending}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          ) : (
            <span />
          )}

          {step.id === "review" ? (
            <form
              action={formAction}
              onSubmit={(event) => {
                setAttempted((current) => new Set(current).add("review"));
                if (!draft.declaration || blockingSteps.length > 0 || pending) {
                  event.preventDefault();
                  if (!draft.declaration)
                    document.getElementById(fieldId("declaration"))?.focus();
                }
              }}
            >
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify(draft)}
              />
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={pending || blockingSteps.length > 0}
                aria-disabled={pending}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send aria-hidden="true" />
                )}
                {pending ? "Submitting…" : "Submit report"}
              </Button>
            </form>
          ) : (
            <Button onClick={next} className="w-full sm:w-auto">
              Continue
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </Card>
      <p aria-live="polite" className="sr-only">
        {pending ? "Submitting your report" : ""}
      </p>
    </div>
  );
}
