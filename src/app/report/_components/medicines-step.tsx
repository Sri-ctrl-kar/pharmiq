"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field, Input, Select } from "@/components/ui/field";
import {
  MAX_MEDICINES,
  medicineCourseStatuses,
  medicineRoutes,
  productDetailSources,
} from "@/lib/reports/constants";
import type {
  FieldErrors,
  MedicineDraft,
  MedicineTextField,
  ReportDraft,
} from "@/lib/reports/schema";
import {
  NOT_PROVIDED,
  OptionList,
  StepIntro,
  fieldId,
  todayLocal,
} from "./form-steps";

type MedicinesStepProps = {
  draft: ReportDraft;
  errors: FieldErrors;
  onMedicine: (index: number, field: MedicineTextField, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSuspected: (index: number, suspected: boolean) => void;
  onNotSure: (notSure: boolean) => void;
};

const productFields: MedicineTextField[] = [
  "manufacturer",
  "batchNumber",
  "expiryDate",
  "detailsSource",
];

const medicineLabel = (medicine: MedicineDraft, index: number) =>
  medicine.name.trim() || `Medicine ${index + 1}`;

export function MedicinesStep({
  draft,
  errors,
  onMedicine,
  onAdd,
  onRemove,
  onSuspected,
  onNotSure,
}: MedicinesStepProps) {
  const { medicines } = draft;
  const canAdd = medicines.length < MAX_MEDICINES;
  const addButton = useRef<HTMLButtonElement>(null);
  const previousCount = useRef(medicines.length);
  const [announcement, setAnnouncement] = useState("");

  // Keyboard and screen-reader users land on the new entry, or back on "Add" after removing.
  useEffect(() => {
    const before = previousCount.current;
    previousCount.current = medicines.length;
    if (medicines.length > before) {
      document
        .getElementById(fieldId(`medicines.${medicines.length - 1}.name`))
        ?.focus();
    } else if (medicines.length < before) {
      addButton.current?.focus();
    }
  }, [medicines.length]);

  return (
    <div className="flex flex-col gap-5">
      <StepIntro>
        List each medicine taken around the time of the reaction — including
        ones you do not suspect — then mark the one(s) you suspect, or choose
        “Not sure”. Only the name is required; leave anything you don&apos;t
        know blank.
      </StepIntro>
      {errors.medicines ? (
        <Alert tone="danger">{errors.medicines}</Alert>
      ) : null}

      {medicines.map((medicine, index) => (
        <MedicineCard
          key={index}
          index={index}
          medicine={medicine}
          errors={errors}
          removable={medicines.length > 1}
          onChange={(field, value) => onMedicine(index, field, value)}
          onRemove={() => {
            setAnnouncement(`${medicineLabel(medicine, index)} removed.`);
            onRemove(index);
          }}
        />
      ))}

      <div className="flex flex-col gap-1.5">
        <Button
          ref={addButton}
          variant="secondary"
          onClick={() => {
            setAnnouncement(`Medicine ${medicines.length + 1} added.`);
            onAdd();
          }}
          disabled={!canAdd}
          className="self-start"
        >
          <Plus aria-hidden="true" />
          Add another medicine
        </Button>
        <p className="text-xs text-muted">
          {canAdd
            ? `Up to ${MAX_MEDICINES} medicines. Each one has its own details.`
            : `You have listed ${MAX_MEDICINES} medicines, the most one report can hold. Add anything else under “Other information”.`}
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <fieldset
        className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:p-5"
        aria-describedby={
          errors.suspectedSelection ? "suspected-error" : "suspected-hint"
        }
      >
        <legend className="px-1 text-sm font-semibold">
          Which medicine do you suspect?
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </legend>
        <p id="suspected-hint" className="text-xs text-muted">
          Tick each medicine you think may be linked to the reaction. This
          records your suspicion only — it does not confirm what caused it. If
          you cannot tell, choose “Not sure”.
        </p>
        <div id={fieldId("suspectedSelection")} tabIndex={-1}>
          <div className="flex flex-col gap-2">
            {medicines.map((medicine, index) => (
              <Checkbox
                key={index}
                id={`suspected-${index}`}
                checked={medicine.suspected}
                onChange={(event) => onSuspected(index, event.target.checked)}
                label={
                  medicine.name.trim() || (
                    <span className="text-muted">
                      Medicine {index + 1} (no name yet)
                    </span>
                  )
                }
              />
            ))}
          </div>
          <p className="my-2 text-xs font-medium text-muted">or</p>
          <Checkbox
            id="suspected-not-sure"
            checked={draft.suspectedSelection === "not_sure"}
            onChange={(event) => onNotSure(event.target.checked)}
            label="Not sure which medicine"
            description="Reviewers will see that you were not sure. Any ticks above are cleared."
          />
        </div>
        {errors.suspectedSelection ? (
          <p id="suspected-error" className="text-xs font-medium text-danger">
            {errors.suspectedSelection}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

function MedicineCard({
  index,
  medicine,
  errors,
  removable,
  onChange,
  onRemove,
}: {
  index: number;
  medicine: MedicineDraft;
  errors: FieldErrors;
  removable: boolean;
  onChange: (field: MedicineTextField, value: string) => void;
  onRemove: () => void;
}) {
  const path = (field: string) => `medicines.${index}.${field}`;
  const today = todayLocal();
  const text = (
    field: MedicineTextField,
    label: string,
    hint?: string,
    extra: Partial<React.ComponentProps<typeof Input>> = {},
    className?: string,
  ) => (
    <Field
      id={fieldId(path(field))}
      label={label}
      hint={hint}
      error={errors[path(field)]}
      required={field === "name"}
      className={className}
    >
      {(props) => (
        <Input
          {...props}
          autoComplete="off"
          {...extra}
          value={medicine[field]}
          onChange={(event) => onChange(field, event.target.value)}
        />
      )}
    </Field>
  );
  const select = (
    field: MedicineTextField,
    label: string,
    labels: Record<string, string>,
    hint?: string,
  ) => (
    <Field
      id={fieldId(path(field))}
      label={label}
      hint={hint}
      error={errors[path(field)]}
    >
      {(props) => (
        <Select
          {...props}
          value={medicine[field]}
          onChange={(event) => onChange(field, event.target.value)}
        >
          <option value="">Not provided</option>
          <OptionList labels={labels} />
        </Select>
      )}
    </Field>
  );
  const date = (field: MedicineTextField, label: string, hint: string) =>
    text(field, label, hint, { type: "date", max: today });

  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4 sm:p-5">
      <legend className="sr-only">
        Medicine {index + 1}
        {medicine.name.trim() ? `: ${medicine.name.trim()}` : ""}
      </legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          Medicine {index + 1}
          {medicine.suspected ? <Badge tone="warning">Suspected</Badge> : null}
        </p>
        {removable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${medicineLabel(medicine, index)}`}
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {text(
          "name",
          "Medicine name",
          "Generic name or brand, as on the pack or prescription.",
          {},
          "sm:col-span-2",
        )}
        {text(
          "brand",
          "Brand name",
          `If different from the name. ${NOT_PROVIDED}.`,
        )}
        {text("strength", "Strength", `e.g. 500 mg, 5 mg/ml. ${NOT_PROVIDED}.`)}
        {text("dose", "Dose taken", `e.g. 1 tablet, 10 ml. ${NOT_PROVIDED}.`)}
        {text("frequency", "How often", `e.g. twice a day. ${NOT_PROVIDED}.`)}
        {select("route", "How it was taken", medicineRoutes.labels)}
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Course</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {select(
            "courseStatus",
            "Status",
            medicineCourseStatuses.labels,
            "Where the course stood when the reaction happened, if you know.",
          )}
          {date("startDate", "Date started", NOT_PROVIDED)}
          {date(
            "endDate",
            "Date stopped or finished",
            "Leave blank if still taking it or not known.",
          )}
        </div>
        {medicine.courseStatus === "dose_changed" ? (
          <div className="flex flex-col gap-3 rounded-md bg-surface-muted p-3 sm:p-4">
            <p className="text-xs text-muted">
              Before the change. Enter the current dose and frequency above.
              Leave anything you don&apos;t know blank.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("previousDose", "Dose before the change", "e.g. 10 mg.")}
              {text(
                "previousFrequency",
                "How often, before the change",
                "e.g. once a day.",
              )}
              {date(
                "changeDate",
                "Approximate date of the change",
                "An approximate date is fine.",
              )}
            </div>
          </div>
        ) : null}
      </div>

      <ProductDetails
        index={index}
        hasErrors={productFields.some((field) => errors[path(field)])}
        filled={productFields.filter((field) => medicine[field].trim()).length}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {text("manufacturer", "Manufacturer", NOT_PROVIDED)}
          {text(
            "batchNumber",
            "Batch or lot number",
            "As printed on the strip or box, e.g. B.No. AB1234.",
            { maxLength: 40 },
          )}
          {text(
            "expiryDate",
            "Expiry (month and year)",
            "As printed on the pack, e.g. 2027-03.",
            { type: "month", placeholder: "YYYY-MM" },
          )}
          {select(
            "detailsSource",
            "How you checked these details",
            productDetailSources.labels,
          )}
        </div>
      </ProductDetails>
    </fieldset>
  );
}

function ProductDetails({
  index,
  hasErrors,
  filled,
  children,
}: {
  index: number;
  hasErrors: boolean;
  filled: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(filled > 0);
  const expanded = open || hasErrors;
  const panelId = `medicine-${index}-product-details`;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <button
        type="button"
        className="flex items-center gap-2 self-start rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setOpen(!expanded)}
      >
        <ChevronDown
          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        Product details (optional)
        {filled > 0 ? (
          <span className="font-normal text-muted">· {filled} added</span>
        ) : null}
      </button>
      <div id={panelId} hidden={!expanded}>
        <p className="mb-3 text-xs text-muted">
          Manufacturer, batch and expiry help reviewers trace a product. Copy
          them from the pack if you have it; do not guess.
        </p>
        {children}
      </div>
    </div>
  );
}
