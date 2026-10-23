import { z } from "zod";
import {
  medicalAttentionOptions,
  reactionOutcomes,
  reporterTypes,
  type MedicalAttention,
  type ReactionOutcome,
  type ReportStatus,
} from "@/lib/reports/constants";
import { suspectedOrAllNames } from "@/lib/reports/medicines";
import type { ReviewReport } from "./types";

/**
 * Search, filter, sort and paginate reports for reviewers. Only fields that exist in
 * the report schema are used (there is no coded "reaction category"; outcome, medical
 * attention and the reporter's symptom words are the closest available fields).
 */

export const PAGE_SIZE = 20;

const statusValues = [
  "submitted",
  "under_review",
  "needs_info",
  "reviewed",
  "closed",
] as const;
export const sortOptions = {
  newest: "Newest submitted first",
  oldest: "Oldest submitted first",
  onset: "Most recent reaction start",
  status: "Status (pending first)",
  medicine: "Suspected medicine (A–Z)",
} as const;
export type SortOption = keyof typeof sortOptions;

export const dataOptions = {
  all: "All records",
  submitted: "Submitted through the form",
  synthetic: "Synthetic demonstration records",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = z.string().trim().max(100).catch("");
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

export const reportQuerySchema = z.object({
  q: text,
  medicine: text,
  status: optionalEnum(statusValues),
  outcome: optionalEnum(reactionOutcomes.values),
  attention: optionalEnum(medicalAttentionOptions.values),
  reporter: optionalEnum(reporterTypes.values),
  serious: z.enum(["1"]).optional().catch(undefined),
  ai: z.enum(["yes", "no"]).optional().catch(undefined),
  data: z.enum(["all", "submitted", "synthetic"]).catch("all"),
  from: z.string().regex(ISO_DATE).optional().catch(undefined),
  to: z.string().regex(ISO_DATE).optional().catch(undefined),
  sort: z
    .enum(Object.keys(sortOptions) as [SortOption, ...SortOption[]])
    .catch("newest"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type ReportQuery = z.output<typeof reportQuerySchema>;

/** Parse Next.js `searchParams` (repeated keys use the first value). */
export function parseReportQuery(
  params: Record<string, string | string[] | undefined>,
): ReportQuery {
  const first = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value === "" ? undefined : value,
    ]),
  );
  return reportQuerySchema.parse(first);
}

/** Calendar date of a timestamp in India Standard Time (UTC+5:30), as YYYY-MM-DD. */
export function istDate(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + 330 * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Reported (not assessed) serious events: death, admission or emergency visit. */
export function isReportedSeriousEvent(
  outcome: ReactionOutcome,
  medicalAttention: MedicalAttention,
): boolean {
  return (
    outcome === "fatal" ||
    medicalAttention === "hospitalised" ||
    medicalAttention === "emergency_department"
  );
}

export function hasReportedSeriousEvent(report: ReviewReport): boolean {
  const { outcome, medicalAttention } = report.content.reaction;
  return isReportedSeriousEvent(outcome, medicalAttention);
}

const statusOrder: Record<ReportStatus, number> = {
  submitted: 0,
  under_review: 1,
  needs_info: 2,
  reviewed: 3,
  closed: 4,
};

const lower = (value: string) => value.toLowerCase();

function matchesText(report: ReviewReport, needle: string): boolean {
  const { content } = report;
  const haystack = [
    report.reportId,
    content.reaction.description,
    ...content.reaction.symptoms,
    ...content.medicines.flatMap((m) => [m.name, m.brand ?? ""]),
    content.otherMedicines ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(lower(needle));
}

export function filterReports(
  reports: ReviewReport[],
  query: ReportQuery,
): ReviewReport[] {
  return reports.filter((report) => {
    const { content } = report;
    if (query.status && report.status !== query.status) return false;
    if (query.outcome && content.reaction.outcome !== query.outcome)
      return false;
    if (
      query.attention &&
      content.reaction.medicalAttention !== query.attention
    )
      return false;
    if (query.reporter && content.reporterType !== query.reporter) return false;
    if (query.serious && !hasReportedSeriousEvent(report)) return false;
    if (query.ai === "yes" && !content.aiAssisted) return false;
    if (query.ai === "no" && content.aiAssisted) return false;
    if (query.data === "synthetic" && !report.isSynthetic) return false;
    if (query.data === "submitted" && report.isSynthetic) return false;
    const day = istDate(report.submittedAt);
    if (query.from && day < query.from) return false;
    if (query.to && day > query.to) return false;
    if (
      query.medicine &&
      !content.medicines.some((m) =>
        [m.name, m.brand ?? ""].some((name) =>
          lower(name).includes(lower(query.medicine)),
        ),
      )
    ) {
      return false;
    }
    if (query.q && !matchesText(report, query.q)) return false;
    return true;
  });
}

export function sortReports(
  reports: ReviewReport[],
  sort: SortOption,
): ReviewReport[] {
  const byNewest = (a: ReviewReport, b: ReviewReport) =>
    b.submittedAt.localeCompare(a.submittedAt);
  const sorted = [...reports];
  switch (sort) {
    case "oldest":
      return sorted.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    case "onset":
      return sorted.sort((a, b) => {
        const left = a.content.reaction.onsetDate;
        const right = b.content.reaction.onsetDate;
        if (left === right) return byNewest(a, b);
        if (left === null) return 1; // reports without an onset date go last
        if (right === null) return -1;
        return right.localeCompare(left);
      });
    case "status":
      return sorted.sort(
        (a, b) =>
          statusOrder[a.status] - statusOrder[b.status] || byNewest(a, b),
      );
    case "medicine":
      return sorted.sort((a, b) => {
        const left = suspectedOrAllNames(a.content)[0] ?? "";
        const right = suspectedOrAllNames(b.content)[0] ?? "";
        return (
          left.localeCompare(right, "en", { sensitivity: "base" }) ||
          byNewest(a, b)
        );
      });
    default:
      return sorted.sort(byNewest);
  }
}

export type ReportPage = {
  items: ReviewReport[];
  total: number;
  page: number;
  pageCount: number;
};

export function applyReportQuery(
  reports: ReviewReport[],
  query: ReportQuery,
): ReportPage {
  const filtered = sortReports(filterReports(reports, query), query.sort);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  return {
    items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: filtered.length,
    page,
    pageCount,
  };
}

/** True when any filter (other than sort/page) is active. */
export function hasActiveFilters(query: ReportQuery): boolean {
  return Boolean(
    query.q ||
    query.medicine ||
    query.status ||
    query.outcome ||
    query.attention ||
    query.reporter ||
    query.serious ||
    query.ai ||
    query.from ||
    query.to ||
    query.data !== "all",
  );
}

/** Serialise a query back to URL search params, omitting defaults. */
export function queryToSearchParams(
  query: ReportQuery,
  overrides: Partial<ReportQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "" || value === null) continue;
    if (key === "sort" && value === "newest") continue;
    if (key === "data" && value === "all") continue;
    if (key === "page" && value === 1) continue;
    params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}
