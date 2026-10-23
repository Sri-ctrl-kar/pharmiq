"use client";

import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RadioCardGroup } from "@/components/ui/choice";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  MAX_SUSPECTED_MEDICINES,
  indianStatesAndUts,
  medicalAttentionOptions,
  medicineRoutes,
  patientSexes,
  reactionOutcomes,
  reporterTypes,
  type ReporterType,
} from "@/lib/reports/constants";
import type {
  FieldErrors,
  MedicineDraft,
  ReportDraft,
} from "@/lib/reports/schema";

export const fieldId = (path: string) => `f-${path.replace(/\./g, "-")}`;

const NOT_PROVIDED = "Leave blank if not known";

function OptionList({ labels }: { labels: Record<string, string> }) {
  return Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

function todayLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function StepIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

const reporterDescriptions: Record<ReporterType, string> = {
  patient: "You experienced the reaction.",
  caregiver: "You are reporting for someone you care for.",
  healthcare_professional: "Doctor, pharmacist, nurse or other professional.",
};

type ReporterStepProps = {
  draft: ReportDraft;
  errors: FieldErrors;
  onReporterType: (value: ReporterType) => void;
  onPatient: (key: keyof ReportDraft["patient"], value: string) => void;
};

export function ReporterStep({
  draft,
  errors,
  onReporterType,
  onPatient,
}: ReporterStepProps) {
  const isPatient = draft.reporterType === "patient";
  return (
    <div className="flex flex-col gap-6">
      <RadioCardGroup
        name="reporterType"
        legend="I am reporting as a"
        required
        value={draft.reporterType}
        onChange={onReporterType}
        error={errors.reporterType}
        options={reporterTypes.values.map((value) => ({
          value,
          label: reporterTypes.labels[value],
          description: reporterDescriptions[value],
        }))}
      />

      <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:p-5">
        <legend className="px-1 text-sm font-semibold">
          {isPatient ? "About you" : "About the patient"}
        </legend>
        <StepIntro>
          All optional. We do not ask for names, phone numbers or addresses.
        </StepIntro>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={fieldId("patient.initials")}
            label="Initials"
            hint="Up to 4 letters, e.g. RK."
            error={errors["patient.initials"]}
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                maxLength={4}
                value={draft.patient.initials}
                onChange={(event) => onPatient("initials", event.target.value)}
              />
            )}
          </Field>
          <Field
            id={fieldId("patient.ageYears")}
            label="Age (years)"
            hint={NOT_PROVIDED}
            error={errors["patient.ageYears"]}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={draft.patient.ageYears}
                onChange={(event) => onPatient("ageYears", event.target.value)}
              />
            )}
          </Field>
          <Field
            id={fieldId("patient.sex")}
            label="Sex"
            error={errors["patient.sex"]}
          >
            {(props) => (
              <Select
                {...props}
                value={draft.patient.sex}
                onChange={(event) => onPatient("sex", event.target.value)}
              >
                <option value="">Not provided</option>
                <OptionList labels={patientSexes.labels} />
              </Select>
            )}
          </Field>
          <Field
            id={fieldId("patient.state")}
            label="State or union territory"
            error={errors["patient.state"]}
          >
            {(props) => (
              <Select
                {...props}
                value={draft.patient.state}
                onChange={(event) => onPatient("state", event.target.value)}
              >
                <option value="">Not provided</option>
                {indianStatesAndUts.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </fieldset>
    </div>
  );
}

type MedicinesStepProps = {
  draft: ReportDraft;
  errors: FieldErrors;
  onMedicine: (index: number, key: keyof MedicineDraft, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
};

export function MedicinesStep({
  draft,
  errors,
  onMedicine,
  onAdd,
  onRemove,
}: MedicinesStepProps) {
  const max = todayLocal();
  const canAdd = draft.suspectedMedicines.length < MAX_SUSPECTED_MEDICINES;
  return (
    <div className="flex flex-col gap-5">
      <StepIntro>
        List the medicine(s) you suspect may be linked to the reaction. Other
        medicines taken at the same time can be added in a later step. Only the
        name is required — leave anything you don&apos;t know blank.
      </StepIntro>
      {errors.suspectedMedicines ? (
        <Alert tone="danger">{errors.suspectedMedicines}</Alert>
      ) : null}

      {draft.suspectedMedicines.map((medicine, index) => {
        const path = (key: string) => `suspectedMedicines.${index}.${key}`;
        return (
          <fieldset
            key={index}
            className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <legend className="text-sm font-semibold">
                Suspected medicine {index + 1}
              </legend>
              {index > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                  aria-label={`Remove suspected medicine ${index + 1}`}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id={fieldId(path("name"))}
                label="Medicine name"
                required
                hint="Brand or generic name, as on the pack or prescription."
                error={errors[path("name")]}
                className="sm:col-span-2"
              >
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={medicine.name}
                    onChange={(event) =>
                      onMedicine(index, "name", event.target.value)
                    }
                  />
                )}
              </Field>
              <Field
                id={fieldId(path("dose"))}
                label="Dose"
                hint={`e.g. 500 mg. ${NOT_PROVIDED}.`}
                error={errors[path("dose")]}
              >
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={medicine.dose}
                    onChange={(event) =>
                      onMedicine(index, "dose", event.target.value)
                    }
                  />
                )}
              </Field>
              <Field
                id={fieldId(path("frequency"))}
                label="How often"
                hint={`e.g. twice a day. ${NOT_PROVIDED}.`}
                error={errors[path("frequency")]}
              >
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={medicine.frequency}
                    onChange={(event) =>
                      onMedicine(index, "frequency", event.target.value)
                    }
                  />
                )}
              </Field>
              <Field
                id={fieldId(path("route"))}
                label="How it was taken"
                error={errors[path("route")]}
              >
                {(props) => (
                  <Select
                    {...props}
                    value={medicine.route}
                    onChange={(event) =>
                      onMedicine(index, "route", event.target.value)
                    }
                  >
                    <option value="">Not provided</option>
                    <OptionList labels={medicineRoutes.labels} />
                  </Select>
                )}
              </Field>
              <Field
                id={fieldId(path("startDate"))}
                label="Date started"
                hint={NOT_PROVIDED}
                error={errors[path("startDate")]}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    max={max}
                    value={medicine.startDate}
                    onChange={(event) =>
                      onMedicine(index, "startDate", event.target.value)
                    }
                  />
                )}
              </Field>
            </div>
          </fieldset>
        );
      })}

      {canAdd ? (
        <Button variant="secondary" onClick={onAdd} className="self-start">
          <Plus aria-hidden="true" />
          Add another suspected medicine
        </Button>
      ) : (
        <p className="text-sm text-muted">
          Up to {MAX_SUSPECTED_MEDICINES} suspected medicines. Add others under
          “Other information”.
        </p>
      )}
    </div>
  );
}

type ReactionStepProps = {
  draft: ReportDraft;
  errors: FieldErrors;
  onReaction: (key: keyof ReportDraft["reaction"], value: string) => void;
};

export function ReactionStep({ draft, errors, onReaction }: ReactionStepProps) {
  const { reaction } = draft;
  return (
    <div className="flex flex-col gap-5">
      <Field
        id={fieldId("reaction.description")}
        label="What happened?"
        required
        hint={
          <>
            Describe the symptoms in your own words: what you noticed, when, and
            how it changed. Do not include names, phone numbers or addresses.{" "}
            <span aria-live="polite">{reaction.description.length}/4000</span>
          </>
        }
        error={errors["reaction.description"]}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={6}
            maxLength={4000}
            value={reaction.description}
            onChange={(event) => onReaction("description", event.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={fieldId("reaction.onsetDate")}
          label="Date the reaction started"
          hint={NOT_PROVIDED}
          error={errors["reaction.onsetDate"]}
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={todayLocal()}
              value={reaction.onsetDate}
              onChange={(event) => onReaction("onsetDate", event.target.value)}
            />
          )}
        </Field>
        <Field
          id={fieldId("reaction.onsetTime")}
          label="Time it started"
          hint="Optional, if you know it."
          error={errors["reaction.onsetTime"]}
        >
          {(props) => (
            <Input
              {...props}
              type="time"
              value={reaction.onsetTime}
              onChange={(event) => onReaction("onsetTime", event.target.value)}
            />
          )}
        </Field>
        <Field
          id={fieldId("reaction.outcome")}
          label="How is the patient now?"
          required
          error={errors["reaction.outcome"]}
        >
          {(props) => (
            <Select
              {...props}
              value={reaction.outcome}
              onChange={(event) => onReaction("outcome", event.target.value)}
            >
              <option value="" disabled>
                Select…
              </option>
              <OptionList labels={reactionOutcomes.labels} />
            </Select>
          )}
        </Field>
        <Field
          id={fieldId("reaction.medicalAttention")}
          label="Was medical attention sought?"
          required
          error={errors["reaction.medicalAttention"]}
        >
          {(props) => (
            <Select
              {...props}
              value={reaction.medicalAttention}
              onChange={(event) =>
                onReaction("medicalAttention", event.target.value)
              }
            >
              <option value="" disabled>
                Select…
              </option>
              <OptionList labels={medicalAttentionOptions.labels} />
            </Select>
          )}
        </Field>
      </div>
    </div>
  );
}

type HistoryStepProps = {
  draft: ReportDraft;
  errors: FieldErrors;
  onChange: (key: "otherMedicines" | "medicalHistory", value: string) => void;
};

export function HistoryStep({ draft, errors, onChange }: HistoryStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <StepIntro>
        Both optional. This context helps reviewers, but leave it blank if you
        are unsure.
      </StepIntro>
      <Field
        id={fieldId("otherMedicines")}
        label="Other medicines taken around the same time"
        hint="Including supplements and herbal or Ayurvedic products, with doses if known."
        error={errors.otherMedicines}
      >
        {(props) => (
          <Textarea
            {...props}
            maxLength={2000}
            value={draft.otherMedicines}
            onChange={(event) => onChange("otherMedicines", event.target.value)}
          />
        )}
      </Field>
      <Field
        id={fieldId("medicalHistory")}
        label="Relevant medical history"
        hint="e.g. known allergies, long-term conditions, pregnancy. Do not include names or contact details."
        error={errors.medicalHistory}
      >
        {(props) => (
          <Textarea
            {...props}
            maxLength={2000}
            value={draft.medicalHistory}
            onChange={(event) => onChange("medicalHistory", event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
