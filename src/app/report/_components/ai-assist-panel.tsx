"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles, Undo2, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  initialDecisions,
  undecidedMedicines,
  type ApplySummary,
  type ExtractionDecisions,
  type FieldDecision,
  type MedicineRoleChoice,
} from "@/lib/ai/apply-extraction";
import type {
  ExtractionErrorCode,
  ExtractionResponse,
  VerifiedExtraction,
  VerifiedField,
} from "@/lib/ai/extraction-schema";
import {
  medicalAttentionOptions,
  medicineRoutes,
  reactionOutcomes,
} from "@/lib/reports/constants";
import { minimiseForAi } from "@/lib/reports/privacy";
import { cn } from "@/lib/utils";

const CLIENT_TIMEOUT_MS = 65_000;
const MIN_LENGTH = 10;

const redactionLabels: Record<string, string> = {
  email: "email address",
  link: "web link",
  id_number: "ID number",
  phone: "phone number",
  name: "name",
  postcode: "PIN code",
};

function describeRedactions(redactions: { kind: string; count: number }[]) {
  return redactions
    .map(
      ({ kind, count }) =>
        `${count} ${redactionLabels[kind] ?? kind}${count > 1 ? "s" : ""}`,
    )
    .join(", ");
}

type PanelState =
  | { status: "idle" }
  | { status: "loading"; startedAt: number }
  | {
      status: "error";
      code: ExtractionErrorCode | "network";
      message: string;
      retryable: boolean;
    }
  | {
      status: "review";
      extraction: VerifiedExtraction;
      redactions: { kind: string; count: number }[];
      decisions: ExtractionDecisions;
      sourceText: string;
    }
  | { status: "applied"; summary: Omit<ApplySummary, "draft"> };

type Props = {
  description: string;
  available: boolean;
  onApply: (decisions: ExtractionDecisions) => Omit<ApplySummary, "draft">;
  onUndo: () => void;
};

export function AiAssistPanel({
  description,
  available,
  onApply,
  onUndo,
}: Props) {
  const [state, setState] = useState<PanelState>({ status: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - state.startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [state]);

  if (!available) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted">
        <p className="font-medium text-foreground">
          AI assistance is not available
        </p>
        <p>
          It is not configured on this server. Continue and fill in the next
          steps yourself — the form works the same way.
        </p>
      </div>
    );
  }

  const preview = minimiseForAi(description);
  const tooShort = description.trim().length < MIN_LENGTH;

  async function extract() {
    if (state.status === "loading") return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    const timeout = setTimeout(() => abort.abort("timeout"), CLIENT_TIMEOUT_MS);
    const sourceText = description;
    setElapsed(0);
    setState({ status: "loading", startedAt: Date.now() });

    let next: PanelState;
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: sourceText }),
        signal: abort.signal,
      });
      const body = (await response
        .json()
        .catch(() => null)) as ExtractionResponse | null;
      if (!body || typeof body.ok !== "boolean") {
        next = {
          status: "error",
          code: "invalid_response",
          message:
            "The server returned an unexpected answer, so nothing was filled in. Try again, or fill in the form yourself.",
          retryable: true,
        };
      } else if (!body.ok) {
        next = { status: "error", ...body.error };
      } else {
        next = {
          status: "review",
          extraction: body.extraction,
          redactions: body.redactions,
          decisions: initialDecisions(body.extraction),
          sourceText,
        };
      }
    } catch {
      if (abort.signal.aborted && abort.signal.reason !== "timeout") {
        next = { status: "idle" };
      } else {
        next = {
          status: "error",
          code: abort.signal.aborted ? "timeout" : "network",
          message: abort.signal.aborted
            ? "The AI service took too long to respond. Try again, or fill in the form yourself."
            : "Could not reach the server. Check your connection and try again, or fill in the form yourself.",
          retryable: true,
        };
      }
    } finally {
      clearTimeout(timeout);
    }
    // Ignore responses from superseded or cancelled requests.
    if (id === requestId.current) setState(next);
  }

  function cancel() {
    requestId.current++;
    controller.current?.abort("cancelled");
    setState({ status: "idle" });
  }

  return (
    <section
      aria-labelledby="ai-assist-heading"
      className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-primary-soft/40 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="ai-assist-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          Optional: let AI suggest the details
        </h3>
        <Badge tone="primary">AI-assisted · you confirm everything</Badge>
      </div>

      {state.status === "idle" || state.status === "error" ? (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
            <li>
              AI reads only the description above and suggests medicines,
              symptoms, dates and outcome. It does not diagnose or decide
              whether a medicine caused the reaction.
            </li>
            <li>
              Only the description is sent to the AI service (Anthropic&apos;s
              Claude). Your age, initials, sex and state are not sent.
              {preview.redactions.length > 0
                ? ` Before sending we will remove: ${describeRedactions(preview.redactions)}.`
                : " Names, phone numbers, emails and ID numbers are removed before sending."}
            </li>
            <li>
              For this demonstration, use made-up (synthetic) descriptions only.
            </li>
          </ul>
          {state.status === "error" ? (
            <Alert tone="danger" title="No suggestions">
              {state.message}
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={extract} disabled={tooShort}>
              {state.status === "error" && state.retryable ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {state.status === "error" && state.retryable
                ? "Try again"
                : "Suggest details with AI"}
            </Button>
            {tooShort ? (
              <span className="text-xs text-muted">
                Write a few words first.
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      {state.status === "loading" ? (
        <div
          className="flex flex-wrap items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="size-5 animate-spin text-primary"
            aria-hidden="true"
          />
          <p className="text-sm">
            Reading your description… {elapsed}s. This can take up to a minute.
          </p>
          <Button variant="secondary" size="sm" onClick={cancel}>
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
      ) : null}

      {state.status === "review" ? (
        <SuggestionsReview
          state={state}
          stale={state.sourceText !== description}
          onChange={(decisions) => setState({ ...state, decisions })}
          onRerun={extract}
          onDiscard={() => setState({ status: "idle" })}
          onApply={() =>
            setState({ status: "applied", summary: onApply(state.decisions) })
          }
        />
      ) : null}

      {state.status === "applied" ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <Alert
            tone={state.summary.applied.length ? "success" : "info"}
            title="Suggestions applied"
          >
            {state.summary.applied.length ? (
              <p>
                Added {state.summary.applied.length} item(s) to the form. Check
                and edit them in the next steps — nothing is saved until you
                submit.
              </p>
            ) : (
              <p>Nothing was added.</p>
            )}
            {state.summary.kept.length ? (
              <p className="mt-1">
                Kept what you had already entered for:{" "}
                {state.summary.kept.join("; ")}.
              </p>
            ) : null}
            {state.summary.skipped.length ? (
              <p className="mt-1">
                Not added: {state.summary.skipped.join("; ")}.
              </p>
            ) : null}
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onUndo();
                setState({ status: "idle" });
              }}
            >
              <Undo2 aria-hidden="true" />
              Undo
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

const statusBadge: Record<
  VerifiedField["status"],
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  reported: { label: "Found in your text", tone: "success" },
  ambiguous: { label: "Unclear — check", tone: "warning" },
  missing: { label: "Not mentioned", tone: "neutral" },
};

type ReviewState = Extract<PanelState, { status: "review" }>;

function SuggestionsReview({
  state,
  stale,
  onChange,
  onRerun,
  onDiscard,
  onApply,
}: {
  state: ReviewState;
  stale: boolean;
  onChange: (decisions: ExtractionDecisions) => void;
  onRerun: () => void;
  onDiscard: () => void;
  onApply: () => void;
}) {
  const { extraction, decisions } = state;
  const undecided = undecidedMedicines(decisions);
  const update = (change: (draft: ExtractionDecisions) => void) => {
    const next = structuredClone(decisions);
    change(next);
    onChange(next);
  };

  const missingLabels = [
    ["Reaction start date", extraction.onsetDate],
    ["Reaction start time", extraction.onsetTime],
    ["Outcome", extraction.outcome],
    ["Medical attention", extraction.medicalAttention],
  ]
    .filter(([, field]) => (field as VerifiedField).status === "missing")
    .map(([label]) => label as string);

  const reviewCount = [
    ...extraction.medicines.flatMap((m) => [
      m.name,
      m.dose,
      m.route,
      m.frequency,
      m.startDate,
    ]),
    ...extraction.symptoms,
    extraction.onsetDate,
    extraction.onsetTime,
    extraction.outcome,
    extraction.medicalAttention,
  ].filter((field) => field.needsReview).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Check each suggestion against your description. Ticked items will be
        added to the form; you can edit any value first.{" "}
        {reviewCount > 0 ? (
          <strong>
            {reviewCount} item(s) need your attention and are not ticked.
          </strong>
        ) : null}
      </p>
      {state.redactions.length > 0 ? (
        <p className="text-xs text-muted">
          Removed before sending: {describeRedactions(state.redactions)}.
        </p>
      ) : null}
      {stale ? (
        <Alert tone="warning" title="Your description has changed">
          These suggestions were made from an earlier version. Run AI again
          before applying.
        </Alert>
      ) : null}
      {extraction.warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Medicines mentioned</h4>
        {extraction.medicines.length === 0 ? (
          <p className="text-sm text-muted">
            No medicine names were found in the description.
          </p>
        ) : null}
        {extraction.medicines.map((medicine, index) => {
          const decision = decisions.medicines[index];
          return (
            <fieldset
              key={index}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <legend className="sr-only">Medicine {index + 1}</legend>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`ai-med-${index}-name`}
                    className="text-xs font-medium text-muted"
                  >
                    Medicine name (as written)
                  </label>
                  <Input
                    id={`ai-med-${index}-name`}
                    value={decision.name}
                    onChange={(event) =>
                      update(
                        (d) =>
                          void (d.medicines[index].name = event.target.value),
                      )
                    }
                  />
                  <Provenance field={medicine.name} />
                  {medicine.reporterRoleEvidence ? (
                    <p className="text-xs text-muted">
                      You wrote: “{medicine.reporterRoleEvidence}”
                    </p>
                  ) : null}
                </div>
                <RoleChoice
                  name={`ai-med-${index}-role`}
                  value={decision.role}
                  onChange={(role) =>
                    update((d) => void (d.medicines[index].role = role))
                  }
                />
              </div>
              {decision.role === "suspected" || decision.role === "other" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <SuggestionRow
                    id={`ai-med-${index}-dose`}
                    label="Dose"
                    field={medicine.dose}
                    decision={decision.dose}
                    onChange={(value) =>
                      update((d) => void (d.medicines[index].dose = value))
                    }
                  />
                  <SuggestionRow
                    id={`ai-med-${index}-frequency`}
                    label="How often"
                    field={medicine.frequency}
                    decision={decision.frequency}
                    onChange={(value) =>
                      update((d) => void (d.medicines[index].frequency = value))
                    }
                  />
                  <SuggestionRow
                    id={`ai-med-${index}-route`}
                    label="How it was taken"
                    field={medicine.route}
                    decision={decision.route}
                    options={medicineRoutes.labels}
                    onChange={(value) =>
                      update((d) => void (d.medicines[index].route = value))
                    }
                  />
                  <SuggestionRow
                    id={`ai-med-${index}-start`}
                    label="Date started"
                    field={medicine.startDate}
                    decision={decision.startDate}
                    type="date"
                    onChange={(value) =>
                      update((d) => void (d.medicines[index].startDate = value))
                    }
                  />
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      {extraction.symptoms.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Symptoms</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {extraction.symptoms.map((symptom, index) => (
              <SuggestionRow
                key={index}
                id={`ai-symptom-${index}`}
                label={`Symptom ${index + 1}`}
                field={symptom}
                decision={decisions.symptoms[index]}
                onChange={(value) =>
                  update((d) => void (d.symptoms[index] = value))
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Reaction</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {extraction.onsetDate.status !== "missing" ? (
            <SuggestionRow
              id="ai-onset-date"
              label="Reaction start date"
              field={extraction.onsetDate}
              decision={decisions.onsetDate}
              type="date"
              onChange={(value) => update((d) => void (d.onsetDate = value))}
            />
          ) : null}
          {extraction.onsetTime.status !== "missing" ? (
            <SuggestionRow
              id="ai-onset-time"
              label="Reaction start time"
              field={extraction.onsetTime}
              decision={decisions.onsetTime}
              type="time"
              onChange={(value) => update((d) => void (d.onsetTime = value))}
            />
          ) : null}
          {extraction.outcome.status !== "missing" ? (
            <SuggestionRow
              id="ai-outcome"
              label="Outcome"
              field={extraction.outcome}
              decision={decisions.outcome}
              options={reactionOutcomes.labels}
              onChange={(value) => update((d) => void (d.outcome = value))}
            />
          ) : null}
          {extraction.medicalAttention.status !== "missing" ? (
            <SuggestionRow
              id="ai-attention"
              label="Medical attention"
              field={extraction.medicalAttention}
              decision={decisions.medicalAttention}
              options={medicalAttentionOptions.labels}
              onChange={(value) =>
                update((d) => void (d.medicalAttention = value))
              }
            />
          ) : null}
        </div>
        {missingLabels.length > 0 ? (
          <p className="text-xs text-muted">
            Not mentioned in your description (left blank, not guessed):{" "}
            {missingLabels.join(", ")}.
          </p>
        ) : null}
      </div>

      {undecided.length > 0 ? (
        <p className="text-sm font-medium text-warning" role="status">
          Choose how to add: {undecided.join(", ")}.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {stale ? (
          <Button onClick={onRerun}>
            <RotateCcw aria-hidden="true" />
            Run AI again
          </Button>
        ) : (
          <Button onClick={onApply} disabled={undecided.length > 0}>
            Apply ticked suggestions
          </Button>
        )}
        <Button variant="secondary" onClick={onDiscard}>
          Discard suggestions
        </Button>
      </div>
    </div>
  );
}

function Provenance({ field }: { field: VerifiedField }) {
  const badge = statusBadge[field.status];
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={
            field.needsReview && field.status !== "ambiguous"
              ? "warning"
              : badge.tone
          }
        >
          {field.needsReview && field.status === "reported"
            ? "Check this"
            : badge.label}
        </Badge>
        {field.evidence ? (
          <span className="text-muted">“{field.evidence}”</span>
        ) : null}
      </div>
      {field.note ? <p className="text-muted">{field.note}</p> : null}
      {field.flags.map((flag) => (
        <p key={flag.code} className="font-medium text-warning">
          {flag.message}
        </p>
      ))}
    </div>
  );
}

function SuggestionRow({
  id,
  label,
  field,
  decision,
  onChange,
  options,
  type = "text",
}: {
  id: string;
  label: string;
  field: VerifiedField;
  decision: FieldDecision;
  onChange: (decision: FieldDecision) => void;
  options?: Record<string, string>;
  type?: "text" | "date" | "time";
}) {
  if (field.status === "missing") {
    return (
      <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted">
        {label}: not mentioned
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2",
        field.needsReview
          ? "border-warning/40 bg-warning-soft/40"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <input
          id={`${id}-use`}
          type="checkbox"
          className="size-4 accent-primary"
          checked={decision.accept}
          onChange={(event) =>
            onChange({ ...decision, accept: event.target.checked })
          }
        />
        <label htmlFor={`${id}-use`} className="text-xs font-medium">
          Use {label.toLowerCase()}
        </label>
      </div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {options ? (
        <Select
          id={id}
          value={decision.value}
          onChange={(event) =>
            onChange({ accept: true, value: event.target.value })
          }
        >
          <option value="">Select…</option>
          {Object.entries(options).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          type={type}
          value={decision.value}
          onChange={(event) =>
            onChange({ accept: true, value: event.target.value })
          }
        />
      )}
      <Provenance field={field} />
    </div>
  );
}

function RoleChoice({
  name,
  value,
  onChange,
}: {
  name: string;
  value: MedicineRoleChoice;
  onChange: (role: MedicineRoleChoice) => void;
}) {
  const choices: { value: MedicineRoleChoice; label: string }[] = [
    { value: "suspected", label: "Suspected medicine" },
    { value: "other", label: "Other medicine" },
    { value: "skip", label: "Don't add" },
  ];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-muted">Add as</legend>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "cursor-pointer rounded-md border px-2.5 py-1.5 text-xs font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              value === choice.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border-strong bg-surface hover:bg-surface-muted",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
