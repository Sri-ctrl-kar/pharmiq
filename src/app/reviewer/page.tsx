import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Info, TriangleAlert } from "lucide-react";
import { SyntheticDataBanner } from "@/components/safety/synthetic-data-badge";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  analyticsRecords,
  computeReviewMetrics,
  computeWorkload,
  type SourceCount,
} from "@/lib/review/analytics";
import { reviewerStatusLabels, workflowStatuses } from "@/lib/review/status";
import { safetyCopy } from "@/lib/site";
import { getReviewerAccess } from "@/server/auth/reviewer-session";
import { AccessGate } from "./_components/access-gate";
import { ColumnChart, CountBars } from "@/components/charts/count-charts";
import { ReviewerShell } from "./_components/reviewer-shell";
import { ReviewerSkeleton } from "./_components/skeleton";

export const metadata: Metadata = { title: "Reviewer overview" };

export default function ReviewerOverviewPage() {
  return (
    <Suspense fallback={<ReviewerSkeleton label="Loading reviewer overview" />}>
      <Overview />
    </Suspense>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </>
  );
  return (
    <Card className="flex">
      {href ? (
        <Link
          href={href}
          className="flex flex-1 flex-col gap-1 rounded-lg p-4 transition-colors hover:bg-surface-muted"
        >
          {body}
        </Link>
      ) : (
        <div className="flex flex-1 flex-col gap-1 p-4">{body}</div>
      )}
    </Card>
  );
}

async function Overview() {
  const access = await getReviewerAccess();
  if (access.status !== "authorised") return <AccessGate access={access} />;

  let reports;
  try {
    reports = await access.repository.listReports();
  } catch {
    return (
      <ReviewerShell access={access} active="overview">
        <Alert tone="danger" title="Reports could not be loaded">
          There was a problem reading report storage. Try again shortly.
        </Alert>
      </ReviewerShell>
    );
  }

  const workload = computeWorkload(reports);
  // Charts and aggregate figures: synthetic demonstration records only (AGENTS.md).
  const metrics = computeReviewMetrics(analyticsRecords(reports));
  const sourceHint = (count: SourceCount) =>
    `${count.submittedThroughForm} submitted · ${count.synthetic} synthetic`;
  return (
    <ReviewerShell access={access} active="overview">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reviewer overview
          </h1>
          <p className="text-sm text-muted">
            {workload.all.total} reports · {workload.all.submittedThroughForm}{" "}
            submitted through the form · {workload.all.synthetic} synthetic
            demonstration
          </p>
        </div>
        <Link
          href="/reviewer/reports?sort=status"
          className={buttonVariants({ variant: "secondary" })}
        >
          Open review queue
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>

      {workload.all.total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2">
            <p className="font-medium">No reports yet</p>
            <p className="text-sm text-muted">
              Reports appear here once they are submitted through the reporting
              form.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section
          aria-labelledby="workload-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2 id="workload-heading" className="text-lg font-semibold">
              Review workload
            </h2>
            <p className="text-sm text-muted">
              Counts of every report you can review, including reports submitted
              through the form.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Total reports"
              value={workload.all.total}
              hint={sourceHint(workload.all)}
              href="/reviewer/reports"
            />
            {workflowStatuses.map((status) => (
              <Stat
                key={status}
                label={reviewerStatusLabels[status]}
                value={workload.byStatus[status].total}
                hint={sourceHint(workload.byStatus[status])}
                href={`/reviewer/reports?status=${status}`}
              />
            ))}
          </div>
          <Link
            href="/reviewer/reports?serious=1"
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary hover:underline"
          >
            <TriangleAlert className="size-4" aria-hidden="true" />
            Show reports with a reported serious event
          </Link>
        </section>
      )}

      <section
        aria-labelledby="analytics-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="analytics-heading" className="text-lg font-semibold">
            Demonstration analytics
          </h2>
          <p className="text-sm text-muted">
            Computed from synthetic demonstration records only.
            {workload.all.submittedThroughForm > 0
              ? ` The ${workload.all.submittedThroughForm} report${workload.all.submittedThroughForm === 1 ? "" : "s"} submitted through the form ${workload.all.submittedThroughForm === 1 ? "is" : "are"} not included.`
              : ""}
          </p>
        </div>
        <SyntheticDataBanner />
        <Alert tone="info" title="How to read these numbers">
          {safetyCopy.suspectedNotCausal}
        </Alert>

        {metrics.total === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-2">
              <p className="font-medium">No synthetic demonstration records</p>
              <p className="text-sm text-muted">
                Analytics are shown for synthetic data only. Reports submitted
                through the form are counted in the workload above and listed in
                the review queue.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Synthetic records" value={metrics.total} />
              <Stat
                label="Reported serious events"
                value={metrics.reportedSerious}
                hint="Death, admission or emergency visit, as reported"
              />
              <Stat
                label="At least one detail not provided"
                value={metrics.withMissingInformation}
              />
              <Stat
                label="Used AI suggestions"
                value={metrics.aiAssisted}
                hint="Every value confirmed by the reporter"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Reports submitted per month
                  </CardTitle>
                  <CardDescription>
                    Last six months, by submission date (IST)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ColumnChart
                    items={metrics.perMonth}
                    caption="Reports submitted per month, last six months"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Outcome, as reported
                  </CardTitle>
                  <CardDescription>
                    The reporter&apos;s description of the patient&apos;s state
                    at the time of reporting
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CountBars
                    items={metrics.byOutcome}
                    caption="Reports by reported outcome"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Most frequently named suspected medicines
                  </CardTitle>
                  <CardDescription>
                    Number of reports naming each medicine as suspected — not
                    evidence of cause
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CountBars
                    items={metrics.topSuspectedMedicines}
                    caption="Reports naming each suspected medicine"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Most frequently reported symptoms
                  </CardTitle>
                  <CardDescription>
                    In the reporter&apos;s own words; similar wording is not
                    merged
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CountBars
                    items={metrics.topSymptoms}
                    caption="Reports listing each symptom"
                    emptyText="No structured symptoms have been recorded yet."
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Medical attention, as reported
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CountBars
                    items={metrics.byMedicalAttention}
                    caption="Reports by medical attention sought"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Review timing</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p>
                    Median time from submission to first marked reviewed:{" "}
                    <span className="font-semibold">
                      {metrics.medianDaysToReviewed === null
                        ? "no reviews recorded yet"
                        : `${metrics.medianDaysToReviewed} days`}
                    </span>
                  </p>
                  <p className="flex items-start gap-1.5 text-xs text-muted">
                    <Info
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    There is no coded reaction category in the current data
                    model; outcome, medical attention and the reporter&apos;s
                    symptom words are shown instead.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </section>
    </ReviewerShell>
  );
}
