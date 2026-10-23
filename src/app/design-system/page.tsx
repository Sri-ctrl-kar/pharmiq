import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import {
  EmergencyNotice,
  SafetyNotice,
} from "@/components/safety/safety-notice";
import {
  SyntheticDataBadge,
  SyntheticDataBanner,
} from "@/components/safety/synthetic-data-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export const metadata: Metadata = { title: "Design system" };

const swatches = [
  ["Background", "bg-background"],
  ["Surface", "bg-surface"],
  ["Surface muted", "bg-surface-muted"],
  ["Primary", "bg-primary"],
  ["Primary soft", "bg-primary-soft"],
  ["Info", "bg-info"],
  ["Success", "bg-success"],
  ["Warning", "bg-warning"],
  ["Danger", "bg-danger"],
  ["Synthetic", "bg-synthetic"],
] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <Container className="flex flex-col gap-12 py-10">
      <PageHeader
        eyebrow="Internal"
        title="Design system"
        description="Tokens and components used across ADR Connect India."
      />

      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {swatches.map(([name, className]) => (
            <div key={name} className="flex flex-col gap-2">
              <div
                className={`h-14 rounded-md border border-border ${className}`}
              />
              <span className="text-xs text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-semibold tracking-tight">
            Heading — Report a reaction
          </p>
          <p className="text-lg">
            Body large — Describe what happened in your own words.
          </p>
          <p className="text-sm text-muted">
            Muted — Optional details help reviewers.
          </p>
          <p className="font-mono text-sm">ADR-2026-7K3F9Q</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Submitted</Badge>
          <Badge tone="info">Under review</Badge>
          <Badge tone="warning">Needs information</Badge>
          <Badge tone="success">Reviewed</Badge>
          <Badge tone="danger">Serious</Badge>
          <Badge tone="primary">AI-assisted</Badge>
          <SyntheticDataBadge />
        </div>
      </Section>

      <Section title="Alerts & safety notices">
        <div className="grid gap-4 md:grid-cols-2">
          <Alert title="Information">
            Your report has been saved as a draft.
          </Alert>
          <Alert tone="success" title="Report submitted">
            Your report ID is <span className="font-mono">ADR-2026-7K3F9Q</span>
            .
          </Alert>
          <Alert tone="warning" title="Missing information">
            The date the reaction started has not been provided.
          </Alert>
          <Alert tone="danger" title="Could not submit">
            Please check the highlighted fields.
          </Alert>
          <SafetyNotice />
          <EmergencyNotice />
        </div>
        <SyntheticDataBanner />
      </Section>

      <Section title="Form fields">
        <Card>
          <CardHeader>
            <CardTitle>Medicine details</CardTitle>
            <CardDescription>
              Example form layout. Not connected to any data.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field
              id="ds-medicine"
              label="Medicine name"
              required
              hint="Brand or generic name."
            >
              {(props) => (
                <Input placeholder="e.g. Paracetamol 500 mg" {...props} />
              )}
            </Field>
            <Field id="ds-reporter" label="I am reporting as">
              {(props) => (
                <Select defaultValue="" {...props}>
                  <option value="" disabled>
                    Select…
                  </option>
                  <option>Patient</option>
                  <option>Caregiver</option>
                  <option>Healthcare professional</option>
                </Select>
              )}
            </Field>
            <Field
              id="ds-onset"
              label="Date the reaction started"
              error="Enter a date that is not in the future."
            >
              {(props) => <Input type="date" {...props} />}
            </Field>
            <Field id="ds-disabled" label="Disabled field">
              {(props) => (
                <Input disabled value="Not editable" readOnly {...props} />
              )}
            </Field>
            <Field
              id="ds-narrative"
              label="What happened?"
              hint="Use your own words. Do not include names, phone numbers or addresses."
              className="md:col-span-2"
            >
              {(props) => <Textarea {...props} />}
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="secondary">Back</Button>
            <Button>Continue</Button>
          </CardFooter>
        </Card>
      </Section>
    </Container>
  );
}
