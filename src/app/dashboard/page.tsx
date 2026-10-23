import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Database, Globe, Info, LockKeyhole } from "lucide-react";
import { ColumnChart, CountBars } from "@/components/charts/count-charts";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { SyntheticDataBanner } from "@/components/safety/synthetic-data-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  computePublicAnalytics,
  formatDay,
  hasPublicFilters,
  parsePublicQuery,
  type PublicAnalytics,
} from "@/lib/analytics/public-analytics";
import { safetyCopy } from "@/lib/site";
import {
  getPublicDataset,
  type PublicDataset,
} from "@/server/analytics/public-dataset";
import { DashboardFilters } from "./_components/filters";
import { DashboardSkeleton } from "./_components/skeleton";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Public analytics built from a synthetic demonstration dataset of suspected adverse drug reaction reports.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DashboardPage(props: { searchParams: SearchParams }) {
  return (
    <Container className="flex flex-col gap-6 py-10">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Globe className="size-4" aria-hidden="true" />
            Public analytics
          </span>
        }
        title="Suspected ADR reports: demonstration analytics"
        description="Aggregate counts from a synthetic demonstration dataset. Open to everyone; no individual report can be viewed here."
      />
      <SyntheticDataBanner />
      <Alert tone="info" title="Public dashboard, not the reviewer workspace">
        This page shows aggregated synthetic data only. Reports submitted
        through this site are never included here; they are visible only to
        signed-in reviewers in the{" "}
        <Link
          href="/reviewer"
          className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
        >
          <LockKeyhole className="size-3.5" aria-hidden="true" />
          restricted reviewer workspace
        </Link>
        .
      </Alert>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  let dataset: PublicDataset;
  let analytics: PublicAnalytics;
  let parsed: ReturnType<typeof parsePublicQuery>;
  try {
    dataset = getPublicDataset();
    parsed = parsePublicQuery(params, dataset.medicineOptions);
    analytics = computePublicAnalytics(
      dataset.records,
      parsed.query,
      dataset.coverage,
    );
  } catch {
    return (
      <Alert tone="danger" title="The analytics could not be loaded">
        Something went wrong while preparing the demonstration dataset. Try
        again shortly.
      </Alert>
    );
  }
  const { query, notices } = parsed;
  const filtered = hasPublicFilters(query);
  const unit = analytics.trend.granularity === "week" ? "week" : "month";

  return (
    <>
      <DatasetSource dataset={dataset} />
      <DashboardFilters
        query={query}
        coverage={dataset.coverage}
        medicineOptions={dataset.medicineOptions}
      />
      {notices.map((notice) => (
        <Alert key={notice} tone="warning" title="Filter adjusted">
          {notice}
        </Alert>
      ))}

      <p className="text-sm" role="status" aria-live="polite">
        <strong className="font-semibold">
          {analytics.reports} of {analytics.datasetTotal}
        </strong>{" "}
        synthetic records
        {filtered ? " match these filters" : ""}
        {analytics.range
          ? ` · submitted ${formatDay(analytics.range.from)} – ${formatDay(analytics.range.to)}`
          : ""}
      </p>

      {analytics.reports === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="font-medium">No records match these filters</p>
            <p className="text-sm text-muted">
              {analytics.range
                ? "Try removing a filter or widening the date range."
                : `The dataset covers ${formatDay(dataset.coverage.from)} to ${formatDay(dataset.coverage.to)}; the selected dates fall outside it.`}
            </p>
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Clear all filters
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <section
            aria-label="Summary"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <Stat
              label="Reports"
              value={analytics.reports}
              hint="Synthetic reports in this selection"
            />
            <Stat
              label="Suspected-medicine entries"
              value={analytics.medicineEntries}
              hint="A report can name up to five medicines"
            />
            <Stat
              label="Distinct medicines named"
              value={analytics.distinctMedicines}
            />
            <Stat
              label="Reports with a reported serious event"
              value={analytics.reportedSerious}
              hint={`${Math.round((analytics.reportedSerious / analytics.reports) * 100)}% of reports · death, admission or emergency visit, as reported`}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reports per {unit}</CardTitle>
              <CardDescription>
                By submission date (India Standard Time),{" "}
                {analytics.range
                  ? `${formatDay(analytics.range.from)} – ${formatDay(analytics.range.to)}`
                  : ""}
                .{" "}
                {analytics.trend.granularity === "week"
                  ? "Weeks run Monday to Sunday."
                  : "Ranges longer than three months are grouped by month."}
                {analytics.trend.partialEdges
                  ? ` The first or last ${unit} covers only part of the ${unit}.`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ColumnChart
                items={analytics.trend.items}
                caption={`Synthetic reports per ${unit}`}
                legend={`Number of reports submitted per ${unit}`}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Most frequently named suspected medicines"
              description="Number of reports naming each medicine as suspected, as entered by the reporter. A report naming two medicines counts once for each, so percentages add up to more than 100%."
            >
              <CountBars
                items={analytics.topMedicines}
                caption="Reports naming each suspected medicine"
                legend="Number of reports naming the medicine (% of reports)"
                percentOf={analytics.reports}
              />
              {analytics.medicineEntriesWithoutName > 0 ? (
                <p className="mt-2 text-xs text-muted">
                  {analytics.medicineEntriesWithoutName} medicine entr
                  {analytics.medicineEntriesWithoutName === 1 ? "y" : "ies"} had
                  no name and are not shown.
                </p>
              ) : null}
            </ChartCard>
            <ChartCard
              title="Commonly reported reaction terms"
              description="In the reporter's own words, counted once per report. Terms are not coded, so similar wording is not merged."
            >
              <CountBars
                items={analytics.topReactionTerms}
                caption="Reports listing each reaction term"
                legend="Number of reports listing the term (% of reports)"
                percentOf={analytics.reports}
                emptyText="No reaction terms were recorded for this selection."
              />
              {analytics.reportsWithoutReactionTerms > 0 ? (
                <p className="mt-2 text-xs text-muted">
                  {analytics.reportsWithoutReactionTerms} report
                  {analytics.reportsWithoutReactionTerms === 1 ? "" : "s"}{" "}
                  listed no reaction terms.
                </p>
              ) : null}
            </ChartCard>
            <ChartCard
              title="Outcome, as reported"
              description="The reporter's description of the patient's state when reporting."
            >
              <CountBars
                items={analytics.byOutcome}
                caption="Reports by reported outcome"
                legend="Number of reports (% of reports)"
                percentOf={analytics.reports}
              />
            </ChartCard>
            <ChartCard
              title="Medical attention, as reported"
              description="The highest level of care the reporter said was sought."
            >
              <CountBars
                items={analytics.byMedicalAttention}
                caption="Reports by medical attention sought"
                legend="Number of reports (% of reports)"
                percentOf={analytics.reports}
              />
            </ChartCard>
            <ChartCard title="Who reported" description="Reporter type.">
              <CountBars
                items={analytics.byReporterType}
                caption="Reports by reporter type"
                legend="Number of reports (% of reports)"
                percentOf={analytics.reports}
              />
            </ChartCard>
            <ChartCard
              title="Review status"
              description="Where the demonstration records are in the review workflow. Review does not establish whether a medicine caused a reaction."
            >
              <CountBars
                items={analytics.byStatus}
                caption="Reports by review status"
                legend="Number of reports (% of reports)"
                percentOf={analytics.reports}
              />
            </ChartCard>
            <ChartCard
              title="Patient age group"
              description="Age bands only; exact ages are never shown."
            >
              <CountBars
                items={analytics.byAgeBand}
                caption="Reports by patient age group"
                legend="Number of reports (% of reports)"
                percentOf={analytics.reports}
              />
            </ChartCard>
            <ChartCard title="Patient sex" description="As reported.">
              <CountBars
                items={analytics.bySex}
                caption="Reports by patient sex"
                legend="Number of reports (% of reports)"
                percentOf={analytics.reports}
              />
            </ChartCard>
          </div>
        </>
      )}

      <AboutThisData />
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DatasetSource({ dataset }: { dataset: PublicDataset }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start sm:gap-3">
        <Database className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Dataset: {dataset.name}
            <Badge tone="synthetic">version {dataset.version}</Badge>
          </p>
          <p className="text-muted">
            {dataset.records.length} synthetic records, submitted between{" "}
            {formatDay(dataset.coverage.from)} and{" "}
            {formatDay(dataset.coverage.to)}. Generated deterministically for
            this prototype; it contains no real reports and no real patients.
            Every chart and figure below uses the same filtered selection of
            this dataset.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AboutThisData() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="size-4 text-primary" aria-hidden="true" />
          About this data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground/90">
          <li>{safetyCopy.suspectedNotCausal}</li>
          <li>
            The data is synthetic. It does not describe adverse drug reactions
            in India and must not be read as how common any reaction or medicine
            problem is.
          </li>
          <li>
            Medicines and reaction terms in the synthetic records were picked
            independently, so any pattern between them is random.
          </li>
          <li>
            Medicine names and reaction terms are shown as entered, without
            coding to a standard dictionary. There is no reaction category in
            the data model.
          </li>
          <li>
            Report counts and medicine counts differ: a report can name more
            than one suspected medicine.
          </li>
          <li>
            Only aggregate counts are published. Report IDs, descriptions,
            initials, exact ages, locations and medical histories are never
            shown here.
          </li>
          <li>{safetyCopy.notOfficial}</li>
        </ul>
      </CardContent>
    </Card>
  );
}
