import {
  medicalAttentionOptions,
  reactionOutcomes,
  type ReportStatus,
} from "@/lib/reports/constants";
import { hasReportedSeriousEvent, istDate } from "./query";
import type { ReviewReport } from "./types";

/**
 * Descriptive counts for the reviewer dashboard. These count reports; they are not
 * incidence rates and say nothing about whether a medicine caused a reaction.
 */

export type CountItem = { key: string; label: string; count: number };

export type ReviewMetrics = {
  total: number;
  byStatus: Record<ReportStatus, number>;
  reportedSerious: number;
  aiAssisted: number;
  withMissingInformation: number;
  synthetic: number;
  submittedThroughForm: number;
  perMonth: CountItem[];
  byOutcome: CountItem[];
  byMedicalAttention: CountItem[];
  topSuspectedMedicines: CountItem[];
  topSymptoms: CountItem[];
  /** Median days from submission to first being marked reviewed; null if none. */
  medianDaysToReviewed: number | null;
};

const monthLabel = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** The `count` most recent calendar months (IST) ending with the month of `now`. */
function recentMonths(now: Date, count: number): string[] {
  const [year, month] = istDate(now.toISOString()).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

/** Count distinct normalised values, one per report, keeping the most common spelling. */
function topValues(
  reports: ReviewReport[],
  valuesOf: (report: ReviewReport) => string[],
  limit: number,
): CountItem[] {
  const counts = new Map<
    string,
    { count: number; spellings: Map<string, number> }
  >();
  for (const report of reports) {
    const seen = new Set<string>();
    for (const raw of valuesOf(report)) {
      const label = raw.trim().replace(/\s+/g, " ");
      const key = label.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { count: 0, spellings: new Map() };
      entry.count++;
      entry.spellings.set(label, (entry.spellings.get(label) ?? 0) + 1);
      counts.set(key, entry);
    }
  }
  return [...counts.entries()]
    .map(([key, { count, spellings }]) => ({
      key,
      count,
      label: [...spellings.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeReviewMetrics(
  reports: ReviewReport[],
  now: Date = new Date(),
  months = 6,
): ReviewMetrics {
  const byStatus: Record<ReportStatus, number> = {
    submitted: 0,
    under_review: 0,
    needs_info: 0,
    reviewed: 0,
    closed: 0,
  };
  const outcomeCounts = new Map<string, number>();
  const attentionCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const daysToReviewed: number[] = [];

  for (const report of reports) {
    byStatus[report.status]++;
    const { outcome, medicalAttention } = report.content.reaction;
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
    attentionCounts.set(
      medicalAttention,
      (attentionCounts.get(medicalAttention) ?? 0) + 1,
    );
    const month = istDate(report.submittedAt).slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    const firstReviewed = report.events.find(
      (event) => event.to === "reviewed",
    );
    if (firstReviewed) {
      daysToReviewed.push(
        (Date.parse(firstReviewed.at) - Date.parse(report.submittedAt)) /
          86_400_000,
      );
    }
  }

  const medianDays = median(daysToReviewed);
  return {
    total: reports.length,
    byStatus,
    reportedSerious: reports.filter(hasReportedSeriousEvent).length,
    aiAssisted: reports.filter((r) => r.content.aiAssisted).length,
    withMissingInformation: reports.filter((r) => r.missingFields.length > 0)
      .length,
    synthetic: reports.filter((r) => r.isSynthetic).length,
    submittedThroughForm: reports.filter((r) => !r.isSynthetic).length,
    perMonth: recentMonths(now, months).map((month) => ({
      key: month,
      label: monthLabel.format(new Date(`${month}-01T00:00:00Z`)),
      count: monthCounts.get(month) ?? 0,
    })),
    byOutcome: reactionOutcomes.values.map((key) => ({
      key,
      label: reactionOutcomes.labels[key],
      count: outcomeCounts.get(key) ?? 0,
    })),
    byMedicalAttention: medicalAttentionOptions.values.map((key) => ({
      key,
      label: medicalAttentionOptions.labels[key],
      count: attentionCounts.get(key) ?? 0,
    })),
    topSuspectedMedicines: topValues(
      reports,
      (r) => r.content.suspectedMedicines.map((m) => m.name),
      8,
    ),
    topSymptoms: topValues(reports, (r) => r.content.reaction.symptoms, 8),
    medianDaysToReviewed:
      medianDays === null ? null : Math.round(medianDays * 10) / 10,
  };
}

/**
 * Project rule (AGENTS.md): "Analytics use synthetic data only". Every chart and
 * aggregate figure on the reviewer overview is computed from this subset. Reports
 * submitted through the form are only counted in the review workload and listed in the
 * review queue.
 */
export function analyticsRecords(reports: ReviewReport[]): ReviewReport[] {
  return reports.filter((report) => report.isSynthetic);
}

export type SourceCount = {
  total: number;
  synthetic: number;
  submittedThroughForm: number;
};

export type ReviewWorkload = {
  all: SourceCount;
  byStatus: Record<ReportStatus, SourceCount>;
};

/** How many reports are in each review status, split by data source. Counts only. */
export function computeWorkload(reports: ReviewReport[]): ReviewWorkload {
  const empty = (): SourceCount => ({
    total: 0,
    synthetic: 0,
    submittedThroughForm: 0,
  });
  const workload: ReviewWorkload = {
    all: empty(),
    byStatus: {
      submitted: empty(),
      under_review: empty(),
      needs_info: empty(),
      reviewed: empty(),
      closed: empty(),
    },
  };
  for (const report of reports) {
    for (const count of [workload.all, workload.byStatus[report.status]]) {
      count.total++;
      if (report.isSynthetic) count.synthetic++;
      else count.submittedThroughForm++;
    }
  }
  return workload;
}
