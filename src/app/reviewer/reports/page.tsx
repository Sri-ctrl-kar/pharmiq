import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { SyntheticDataBadge } from "@/components/safety/synthetic-data-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import {
  medicalAttentionOptions,
  reactionOutcomes,
  reporterTypes,
} from "@/lib/reports/constants";
import {
  applyReportQuery,
  dataOptions,
  hasActiveFilters,
  hasReportedSeriousEvent,
  parseReportQuery,
  queryToSearchParams,
  sortOptions,
  type ReportQuery,
} from "@/lib/review/query";
import { suspectedMedicinesOf } from "@/lib/reports/medicines";
import { reviewerStatusLabels } from "@/lib/review/status";
import type { ReviewReport } from "@/lib/review/types";
import { safetyCopy } from "@/lib/site";
import { getReviewerAccess } from "@/server/auth/reviewer-session";
import { AccessGate } from "../_components/access-gate";
import { formatDate, formatDateTime } from "../_components/format";
import { ReviewerShell } from "../_components/reviewer-shell";
import { ReviewerSkeleton } from "../_components/skeleton";
import { StatusBadge } from "../_components/status-badge";

export const metadata: Metadata = { title: "Review queue" };

export default function ReportsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<ReviewerSkeleton label="Loading reports" />}>
      <Reports searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getReviewerAccess();
  if (access.status !== "authorised") return <AccessGate access={access} />;

  const query = parseReportQuery(await searchParams);
  let reports: ReviewReport[];
  try {
    reports = await access.repository.listReports();
  } catch {
    return (
      <ReviewerShell access={access} active="reports">
        <Alert tone="danger" title="Reports could not be loaded">
          There was a problem reading report storage. Try again shortly.
        </Alert>
      </ReviewerShell>
    );
  }
  const page = applyReportQuery(reports, query);
  const filtered = hasActiveFilters(query);

  return (
    <ReviewerShell access={access} active="reports">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-muted">{safetyCopy.suspectedNotCausal}</p>
      </div>

      <Filters query={query} />

      <p className="text-sm" role="status" aria-live="polite">
        {page.total === 0
          ? "No reports"
          : `Showing ${(page.page - 1) * 20 + 1}–${(page.page - 1) * 20 + page.items.length} of ${page.total} report${page.total === 1 ? "" : "s"}`}
        {filtered ? " matching these filters" : ""}
      </p>

      {page.total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="font-medium">
              {filtered
                ? "No reports match these filters"
                : "No reports have been submitted yet"}
            </p>
            {filtered ? (
              <Link
                href="/reviewer/reports"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Clear all filters
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Reports">
          {page.items.map((report) => (
            <ReportRow key={report.reportId} report={report} />
          ))}
        </ul>
      )}

      {page.pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3"
        >
          {page.page > 1 ? (
            <Link
              href={`/reviewer/reports${queryToSearchParams(query, { page: page.page - 1 })}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            Page {page.page} of {page.pageCount}
          </span>
          {page.page < page.pageCount ? (
            <Link
              href={`/reviewer/reports${queryToSearchParams(query, { page: page.page + 1 })}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </ReviewerShell>
  );
}

function ReportRow({ report }: { report: ReviewReport }) {
  const { content } = report;
  return (
    <li>
      <Link
        href={`/reviewer/reports/${report.reportId}`}
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">
            {report.reportId}
          </span>
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
          {content.aiAssisted ? (
            <Badge tone="primary">
              <Sparkles aria-hidden="true" />
              AI-assisted
            </Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted">
            Submitted {formatDateTime(report.submittedAt)}
          </span>
        </div>
        <div className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-4">
          <p>
            {content.suspectedSelection === "not_sure" ? (
              <>
                <span className="text-muted">Not sure which of: </span>
                {content.medicines.map((m) => m.name).join(", ")}
              </>
            ) : (
              <>
                <span className="text-muted">Suspected: </span>
                {suspectedMedicinesOf(content)
                  .map((m) => m.name)
                  .join(", ")}
              </>
            )}
            {content.suspectedSelection !== "not_sure" &&
            content.medicines.some((m) => !m.suspected) ? (
              <span className="text-muted">
                {" "}
                · also listed:{" "}
                {content.medicines
                  .filter((m) => !m.suspected)
                  .map((m) => m.name)
                  .join(", ")}
              </span>
            ) : null}
          </p>
          <p className="truncate">
            <span className="text-muted">Symptoms: </span>
            {content.reaction.symptoms.length ? (
              content.reaction.symptoms.join(", ")
            ) : (
              <em className="text-muted">not structured</em>
            )}
          </p>
          <p className="text-muted">
            {reactionOutcomes.labels[content.reaction.outcome]}
            {content.reaction.onsetDate
              ? ` · onset ${formatDate(content.reaction.onsetDate)}`
              : ""}
          </p>
        </div>
      </Link>
    </li>
  );
}

function Filters({ query }: { query: ReportQuery }) {
  const select = (
    name: keyof ReportQuery,
    label: string,
    options: Record<string, string>,
    anyLabel = "Any",
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`filter-${name}`}>{label}</Label>
      <Select
        id={`filter-${name}`}
        name={name}
        defaultValue={(query[name] as string | undefined) ?? ""}
      >
        {anyLabel ? <option value="">{anyLabel}</option> : null}
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );
  const statusOptions = Object.fromEntries(
    (
      ["submitted", "under_review", "reviewed", "needs_info", "closed"] as const
    ).map((s) => [s, reviewerStatusLabels[s]]),
  );

  return (
    <Card>
      <CardContent>
        <form
          method="get"
          action="/reviewer/reports"
          className="flex flex-col gap-4"
          role="search"
          aria-label="Filter reports"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="filter-q">Search</Label>
              <Input
                id="filter-q"
                name="q"
                type="search"
                defaultValue={query.q}
                placeholder="Report ID, medicine, symptom or description"
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-medicine">Medicine (any listed)</Label>
              <Input
                id="filter-medicine"
                name="medicine"
                defaultValue={query.medicine}
                placeholder="e.g. amoxicillin"
                maxLength={100}
              />
            </div>
            {select("status", "Status", statusOptions)}
            {select(
              "outcome",
              "Outcome (as reported)",
              reactionOutcomes.labels,
            )}
            {select(
              "attention",
              "Medical attention",
              medicalAttentionOptions.labels,
            )}
            {select("reporter", "Reporter type", reporterTypes.labels)}
            {select("ai", "AI assistance", { yes: "Used", no: "Not used" })}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-from">Submitted from</Label>
              <Input
                id="filter-from"
                name="from"
                type="date"
                defaultValue={query.from}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-to">Submitted to</Label>
              <Input
                id="filter-to"
                name="to"
                type="date"
                defaultValue={query.to}
              />
            </div>
            {select("data", "Data source", dataOptions, "")}
            {select("sort", "Sort by", sortOptions, "")}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="serious"
                value="1"
                defaultChecked={query.serious === "1"}
                className="size-4 accent-primary"
              />
              Only reports with a reported serious event (death, admission or
              emergency visit)
            </label>
            <div className="ml-auto flex gap-2">
              <Link
                href="/reviewer/reports"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Clear
              </Link>
              <Button type="submit" size="sm">
                Apply filters
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
