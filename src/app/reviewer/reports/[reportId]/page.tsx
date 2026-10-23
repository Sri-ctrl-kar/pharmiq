import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Sparkles, TriangleAlert } from "lucide-react";
import { SyntheticDataBadge } from "@/components/safety/synthetic-data-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  medicalAttentionOptions,
  medicineRoutes,
  patientSexes,
  reactionOutcomes,
  reporterTypes,
} from "@/lib/reports/constants";
import { isValidReportId } from "@/lib/reports/report-id";
import { hasReportedSeriousEvent } from "@/lib/review/query";
import { allowedNextStatuses } from "@/lib/review/status";
import { buildTimeline } from "@/lib/review/timeline";
import type { ReviewReport } from "@/lib/review/types";
import { safetyCopy } from "@/lib/site";
import { getReviewerAccess } from "@/server/auth/reviewer-session";
import { AccessGate } from "../../_components/access-gate";
import { formatDate, formatDateTime } from "../../_components/format";
import { ReviewerShell } from "../../_components/reviewer-shell";
import { ReviewerSkeleton } from "../../_components/skeleton";
import { StatusBadge } from "../../_components/status-badge";
import { ReviewActionForm } from "./review-action-form";

export const metadata: Metadata = { title: "Review report" };

export default function ReportDetailPage(props: {
  params: Promise<{ reportId: string }>;
}) {
  return (
    <Suspense fallback={<ReviewerSkeleton label="Loading report" />}>
      <ReportDetail params={props.params} />
    </Suspense>
  );
}

function NotProvided() {
  return <span className="text-muted italic">Not provided</span>;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm break-words">{children ?? <NotProvided />}</dd>
    </div>
  );
}

const value = (text: string | number | null | undefined) =>
  text === null || text === undefined || text === "" ? null : String(text);

async function ReportDetail({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const access = await getReviewerAccess();
  if (access.status !== "authorised") return <AccessGate access={access} />;

  const { reportId } = await params;
  let report: ReviewReport | null = null;
  let failed = false;
  if (isValidReportId(reportId)) {
    try {
      report = await access.repository.getReport(reportId);
    } catch {
      failed = true;
    }
  }

  if (failed || !report) {
    return (
      <ReviewerShell access={access} active="reports">
        <Alert
          tone={failed ? "danger" : "warning"}
          title={
            failed ? "This report could not be loaded" : "Report not found"
          }
        >
          {failed
            ? "There was a problem reading report storage. Try again shortly."
            : "There is no report with this ID, or you do not have access to it."}
        </Alert>
        <Link
          href="/reviewer/reports"
          className={buttonVariants({ variant: "secondary" })}
        >
          <ArrowLeft aria-hidden="true" />
          Back to the review queue
        </Link>
      </ReviewerShell>
    );
  }

  const { content } = report;
  const timeline = buildTimeline(report);

  return (
    <ReviewerShell access={access} active="reports">
      <Link
        href="/reviewer/reports"
        className="inline-flex items-center gap-1 self-start text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Review queue
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {report.reportId}
          </h1>
          <StatusBadge status={report.status} />
          {report.isSynthetic ? (
            <SyntheticDataBadge />
          ) : (
            <Badge>Submitted through the form</Badge>
          )}
          {hasReportedSeriousEvent(report) ? (
            <Badge tone="danger">
              <TriangleAlert aria-hidden="true" />
              Serious event reported
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          Submitted {formatDateTime(report.submittedAt)} by a{" "}
          {reporterTypes.labels[content.reporterType].toLowerCase()} · last
          updated {formatDateTime(report.updatedAt)}
        </p>
      </div>

      {report.isSynthetic ? (
        <Alert tone="info" title="Synthetic demonstration record">
          Generated for testing. It does not describe a real patient or a real
          report.
        </Alert>
      ) : null}
      <Alert tone="info" title="Suspected, not established">
        {safetyCopy.suspectedNotCausal} No causality assessment has been
        recorded for this report.
      </Alert>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Reporter&apos;s description (original, unchanged)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <blockquote className="rounded-md border-l-4 border-border-strong bg-surface-muted p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {content.reaction.description}
              </blockquote>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                AI assistance
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {content.aiAssisted ? (
                <p>
                  <strong>Used.</strong> The reporter asked for AI suggestions
                  and then checked, edited or rejected each one. The details
                  below are the reporter-confirmed values.
                </p>
              ) : (
                <p>
                  <strong>Not used.</strong> All details below were entered by
                  the reporter.
                </p>
              )}
              <p className="text-muted">
                The AI&apos;s raw suggestions are deliberately not stored (data
                minimisation), so they cannot be shown here. Only what the
                reporter confirmed is recorded.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Suspected medicines (named by the reporter)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Suspected medicines</caption>
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Medicine
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Dose
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      How often
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      How taken
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {content.suspectedMedicines.map((medicine, index) => (
                    <tr
                      key={index}
                      className="border-b border-border/60 align-top"
                    >
                      <th scope="row" className="py-2 pr-3 font-medium">
                        {medicine.name}
                      </th>
                      <td className="py-2 pr-3">
                        {value(medicine.dose) ?? <NotProvided />}
                      </td>
                      <td className="py-2 pr-3">
                        {value(medicine.frequency) ?? <NotProvided />}
                      </td>
                      <td className="py-2 pr-3">
                        {medicine.route ? (
                          medicineRoutes.labels[medicine.route]
                        ) : (
                          <NotProvided />
                        )}
                      </td>
                      <td className="py-2">
                        {medicine.startDate ? (
                          formatDate(medicine.startDate)
                        ) : (
                          <NotProvided />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Reporter-confirmed details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Row label="Main symptoms">
                  {content.reaction.symptoms.length
                    ? content.reaction.symptoms.join(", ")
                    : null}
                </Row>
                <Row label="Reaction started">
                  {content.reaction.onsetDate
                    ? `${formatDate(content.reaction.onsetDate)}${content.reaction.onsetTime ? `, ${content.reaction.onsetTime}` : ""}`
                    : null}
                </Row>
                <Row label="Outcome (as reported)">
                  {reactionOutcomes.labels[content.reaction.outcome]}
                </Row>
                <Row label="Medical attention">
                  {
                    medicalAttentionOptions.labels[
                      content.reaction.medicalAttention
                    ]
                  }
                </Row>
                <Row label="Patient age">{value(content.patient.ageYears)}</Row>
                <Row label="Patient sex">
                  {content.patient.sex
                    ? patientSexes.labels[content.patient.sex]
                    : null}
                </Row>
                <Row label="Initials">{value(content.patient.initials)}</Row>
                <Row label="State / UT">{value(content.patient.state)}</Row>
                <Row label="Other medicines">
                  {value(content.otherMedicines)}
                </Row>
                <Row label="Relevant medical history">
                  {value(content.medicalHistory)}
                </Row>
              </dl>
              {report.missingFields.length > 0 ? (
                <p className="mt-3 text-xs text-muted">
                  {report.missingFields.length} detail(s) were recorded as not
                  provided at submission. They were not estimated.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ol className="relative flex flex-col gap-4 border-l border-border pl-5">
                {timeline.entries.map((entry, index) => (
                  <li key={index} className="relative">
                    <span
                      className={`absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full ring-4 ring-surface ${entry.source === "reporter" ? "bg-chart-bar" : entry.source === "reviewer" ? "bg-info" : "bg-border-strong"}`}
                      aria-hidden="true"
                    />
                    <p className="text-xs text-muted">
                      {entry.precision === "date"
                        ? formatDate(entry.when)
                        : formatDateTime(entry.when)}{" "}
                      ·{" "}
                      {entry.source === "reporter"
                        ? "as reported"
                        : entry.source === "reviewer"
                          ? "review"
                          : "system"}
                    </p>
                    <p className="text-sm font-medium">{entry.title}</p>
                    {entry.detail ? (
                      <p className="text-sm text-muted">{entry.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
              {timeline.notProvided.length ? (
                <p className="text-xs text-muted">
                  Dates not provided (not estimated):{" "}
                  {timeline.notProvided.join("; ")}.
                </p>
              ) : null}
              <p className="text-xs text-muted">
                The order of events is not evidence that one caused another.
              </p>
            </CardContent>
          </Card>
        </div>

        <aside
          className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start"
          aria-label="Review actions"
        >
          <ReviewActionForm
            reportId={report.reportId}
            status={report.status}
            allowed={allowedNextStatuses(report.status)}
          />
        </aside>
      </div>
    </ReviewerShell>
  );
}
