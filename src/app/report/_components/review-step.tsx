"use client";

import { Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  indianStatesAndUts,
  medicalAttentionOptions,
  medicineRoutes,
  patientSexes,
  reactionOutcomes,
  reporterTypes,
} from "@/lib/reports/constants";
import type { MissingItem } from "@/lib/reports/missing-information";
import type { FormStep, ReportContent } from "@/lib/reports/schema";

type Labelled = Record<string, string>;

function Value({
  value,
  labels,
}: {
  value: string | number | null;
  labels?: Labelled;
}) {
  if (value === null || value === "") {
    return <span className="text-muted italic">Not provided</span>;
  }
  const text = labels
    ? (labels[String(value)] ?? String(value))
    : String(value);
  return <span className="break-words whitespace-pre-wrap">{text}</span>;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Section({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: FormStep;
  onEdit: (step: FormStep) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button variant="ghost" size="sm" onClick={() => onEdit(step)}>
          <Pencil aria-hidden="true" />
          Edit<span className="sr-only"> {title}</span>
        </Button>
      </div>
      <dl className="divide-y divide-border px-4">{children}</dl>
    </section>
  );
}

const stateLabels = Object.fromEntries(indianStatesAndUts.map((s) => [s, s]));

export function ReportSummary({
  report,
  onEdit,
}: {
  report: ReportContent;
  onEdit: (step: FormStep) => void;
}) {
  const { patient, reaction } = report;
  return (
    <div className="flex flex-col gap-4">
      <Section title="About the report" step="reporter" onEdit={onEdit}>
        <Row label="Reporting as">
          <Value value={report.reporterType} labels={reporterTypes.labels} />
        </Row>
        <Row label="Initials">
          <Value value={patient.initials} />
        </Row>
        <Row label="Age (years)">
          <Value value={patient.ageYears} />
        </Row>
        <Row label="Sex">
          <Value value={patient.sex} labels={patientSexes.labels} />
        </Row>
        <Row label="State / UT">
          <Value value={patient.state} labels={stateLabels} />
        </Row>
      </Section>

      <Section title="Suspected medicines" step="medicines" onEdit={onEdit}>
        {report.suspectedMedicines.map((medicine, index) => (
          <div key={index} className="py-2">
            <p className="pt-1 text-sm font-medium">
              {index + 1}. {medicine.name}
            </p>
            <Row label="Dose">
              <Value value={medicine.dose} />
            </Row>
            <Row label="How often">
              <Value value={medicine.frequency} />
            </Row>
            <Row label="How it was taken">
              <Value value={medicine.route} labels={medicineRoutes.labels} />
            </Row>
            <Row label="Date started">
              <Value value={medicine.startDate} />
            </Row>
          </div>
        ))}
      </Section>

      <Section title="What happened" step="describe" onEdit={onEdit}>
        <Row label="Description (your words)">
          <Value value={reaction.description} />
        </Row>
        <Row label="AI assistance">
          {report.aiAssisted ? (
            <span>Used — you checked and confirmed the suggested details</span>
          ) : (
            <span className="text-muted italic">Not used</span>
          )}
        </Row>
      </Section>

      <Section title="Reaction details" step="reaction" onEdit={onEdit}>
        <Row label="Main symptoms">
          <Value
            value={
              reaction.symptoms.length ? reaction.symptoms.join(", ") : null
            }
          />
        </Row>
        <Row label="Date started">
          <Value value={reaction.onsetDate} />
        </Row>
        <Row label="Time started">
          <Value value={reaction.onsetTime} />
        </Row>
        <Row label="Outcome">
          <Value value={reaction.outcome} labels={reactionOutcomes.labels} />
        </Row>
        <Row label="Medical attention">
          <Value
            value={reaction.medicalAttention}
            labels={medicalAttentionOptions.labels}
          />
        </Row>
      </Section>

      <Section title="Other information" step="history" onEdit={onEdit}>
        <Row label="Other medicines">
          <Value value={report.otherMedicines} />
        </Row>
        <Row label="Medical history">
          <Value value={report.medicalHistory} />
        </Row>
      </Section>
    </div>
  );
}

export function MissingInformationNotice({ items }: { items: MissingItem[] }) {
  if (items.length === 0) return null;
  return (
    <Alert tone="info" title="Some details were not provided">
      <p>
        That&apos;s fine — you can still submit. These will be recorded as “not
        provided” and will not be guessed or filled in for you:
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item.field}>{item.label}</li>
        ))}
      </ul>
    </Alert>
  );
}

export function IdentifierWarning({ kinds }: { kinds: string[] }) {
  if (kinds.length === 0) return null;
  return (
    <Alert tone="warning" title="Check for personal details">
      Your text may include {kinds.join(", ")}. Please remove names and contact
      or ID numbers unless they are essential — reviewers do not need them.
    </Alert>
  );
}
