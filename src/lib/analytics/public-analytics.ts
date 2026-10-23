import { z } from "zod";
import {
  medicalAttentionOptions,
  patientSexes,
  reactionOutcomes,
  reporterTypes,
  type MedicalAttention,
  type PatientSex,
  type ReactionOutcome,
  type ReporterType,
  type ReportStatus,
} from "@/lib/reports/constants";
import type { ReportContent } from "@/lib/reports/schema";
import { topValues, type CountItem } from "@/lib/review/analytics";
import { isReportedSeriousEvent, istDate } from "@/lib/review/query";
import { reviewerStatusLabels, workflowStatuses } from "@/lib/review/status";

/**
 * Public analytics for /dashboard. Everything here works on `PublicRecord`, a
 * de-identified projection of a SYNTHETIC record: no report ID, description, initials,
 * exact age, state, medical history, other medicines, review notes, or any date other
 * than the submission day. Every output is an aggregate count.
 *
 * Counts are of reports. They are not incidence or prevalence and do not show that a
 * medicine caused a reaction.
 */

export const ageBands = {
  "0-17": "0–17 years",
  "18-44": "18–44 years",
  "45-64": "45–64 years",
  "65+": "65 years and over",
} as const;
export type AgeBand = keyof typeof ageBands;
const ageBandKeys = Object.keys(ageBands) as [AgeBand, ...AgeBand[]];

export type PublicRecord = {
  /** Submission day in India Standard Time, YYYY-MM-DD. */
  submittedOn: string;
  status: ReportStatus;
  reporterType: ReporterType;
  sex: PatientSex | null;
  ageBand: AgeBand | null;
  outcome: ReactionOutcome;
  medicalAttention: MedicalAttention;
  /** Suspected medicine names as entered (blank entries kept, to count them honestly). */
  medicines: string[];
  /** Reaction terms in the reporter's own words. Not a coded category. */
  reactionTerms: string[];
};

export function ageBandOf(age: number | null | undefined): AgeBand | null {
  if (age === null || age === undefined || !Number.isFinite(age) || age < 0)
    return null;
  if (age < 18) return "0-17";
  if (age < 45) return "18-44";
  if (age < 65) return "45-64";
  return "65+";
}

/** The only way into public analytics. Refuses anything not flagged synthetic. */
export function toPublicRecord(report: {
  submittedAt: string;
  status: ReportStatus;
  isSynthetic: boolean;
  content: ReportContent;
}): PublicRecord {
  if (report.isSynthetic !== true) {
    throw new Error("Public analytics accept synthetic records only.");
  }
  const { content } = report;
  return {
    submittedOn: istDate(report.submittedAt),
    status: report.status,
    reporterType: content.reporterType,
    sex: content.patient.sex ?? null,
    ageBand: ageBandOf(content.patient.ageYears),
    outcome: content.reaction.outcome,
    medicalAttention: content.reaction.medicalAttention,
    // Only medicines the reporter marked as suspected (none when "Not sure").
    medicines: content.medicines
      .filter((medicine) => medicine.suspected)
      .map((medicine) => medicine.name ?? ""),
    reactionTerms: content.reaction.symptoms ?? [],
  };
}

// --- Filters ---------------------------------------------------------------------

const DAY = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** A real calendar day as YYYY-MM-DD (rejects 2026-02-30 and anything else). */
const isRealDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = dayMs(day);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
};
const isoDay = z.string().refine(isRealDay);

export const publicQuerySchema = z.object({
  from: isoDay.optional().catch(undefined),
  to: isoDay.optional().catch(undefined),
  medicine: z.string().trim().min(1).max(100).optional().catch(undefined),
  reporter: z.enum(reporterTypes.values).optional().catch(undefined),
  outcome: z.enum(reactionOutcomes.values).optional().catch(undefined),
  attention: z.enum(medicalAttentionOptions.values).optional().catch(undefined),
  sex: z.enum(patientSexes.values).optional().catch(undefined),
  age: z.enum(ageBandKeys).optional().catch(undefined),
  serious: z.literal("1").optional().catch(undefined),
});
export type PublicQuery = z.output<typeof publicQuerySchema>;

export type ParsedPublicQuery = { query: PublicQuery; notices: string[] };

/**
 * Parse URL parameters. Unknown values fall back to "any"; a medicine must be one of the
 * dataset's medicines, and an inverted date range is ignored, each with a notice.
 */
export function parsePublicQuery(
  params: Record<string, string | string[] | undefined>,
  medicineOptions: string[],
): ParsedPublicQuery {
  const first = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const query = publicQuerySchema.parse(first);
  const notices: string[] = [];
  if (query.medicine) {
    const match = medicineOptions.find(
      (option) => option.toLowerCase() === query.medicine?.toLowerCase(),
    );
    if (match) query.medicine = match;
    else {
      query.medicine = undefined;
      notices.push(
        "That medicine is not in this dataset, so the medicine filter was ignored.",
      );
    }
  }
  if (query.from && query.to && query.from > query.to) {
    query.from = undefined;
    query.to = undefined;
    notices.push(
      "The start date was after the end date, so the date range was ignored.",
    );
  }
  return { query, notices };
}

export function hasPublicFilters(query: PublicQuery): boolean {
  return Object.values(query).some((value) => value !== undefined);
}

export type DateRange = { from: string; to: string };

/** The selected range clipped to the dataset's coverage; null when they do not overlap. */
export function effectiveRange(
  query: Pick<PublicQuery, "from" | "to">,
  coverage: DateRange,
): DateRange | null {
  const from =
    query.from && query.from > coverage.from ? query.from : coverage.from;
  const to = query.to && query.to < coverage.to ? query.to : coverage.to;
  return from <= to ? { from, to } : null;
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export function filterPublicRecords(
  records: PublicRecord[],
  query: PublicQuery,
  range: DateRange | null,
): PublicRecord[] {
  if (!range) return [];
  return records.filter(
    (record) =>
      record.submittedOn >= range.from &&
      record.submittedOn <= range.to &&
      (!query.medicine ||
        record.medicines.some((name) => sameName(name, query.medicine!))) &&
      (!query.reporter || record.reporterType === query.reporter) &&
      (!query.outcome || record.outcome === query.outcome) &&
      (!query.attention || record.medicalAttention === query.attention) &&
      (!query.sex || record.sex === query.sex) &&
      (!query.age || record.ageBand === query.age) &&
      (!query.serious ||
        isReportedSeriousEvent(record.outcome, record.medicalAttention)),
  );
}

// --- Date buckets ------------------------------------------------------------------

export type Granularity = "week" | "month";
type Bucket = { key: string; label: string; shortLabel: string };

/** Ranges up to this many days are shown by week; longer ranges by month. */
export const WEEKLY_MAX_DAYS = 92;

const dayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const fullDayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabel = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthShort = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  timeZone: "UTC",
});

export const formatDay = (day: string) => fullDayLabel.format(dayMs(day));

/** Monday of the week containing `day` (weeks run Monday–Sunday). */
export function weekStart(day: string): string {
  const ms = dayMs(day);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - weekday * DAY).toISOString().slice(0, 10);
}

export function granularityFor(range: DateRange): Granularity {
  return (dayMs(range.to) - dayMs(range.from)) / DAY + 1 <= WEEKLY_MAX_DAYS
    ? "week"
    : "month";
}

export function bucketKey(day: string, granularity: Granularity): string {
  return granularity === "week" ? weekStart(day) : day.slice(0, 7);
}

/** Every bucket from the start to the end of the range, so empty periods show as 0. */
export function dateBuckets(
  range: DateRange,
  granularity: Granularity,
): Bucket[] {
  const buckets: Bucket[] = [];
  if (granularity === "week") {
    for (
      let ms = dayMs(weekStart(range.from));
      ms <= dayMs(range.to);
      ms += 7 * DAY
    ) {
      const key = new Date(ms).toISOString().slice(0, 10);
      buckets.push({
        key,
        label: `Week of ${fullDayLabel.format(ms)}`,
        shortLabel: dayLabel.format(ms),
      });
    }
    return buckets;
  }
  const [startYear, startMonth] = range.from.split("-").map(Number);
  const end = range.to.slice(0, 7);
  for (let index = 0; ; index++) {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + index, 1));
    const key = date.toISOString().slice(0, 7);
    if (key > end) break;
    buckets.push({
      key,
      label: monthLabel.format(date),
      shortLabel: `${monthShort.format(date)} ’${String(date.getUTCFullYear()).slice(2)}`,
    });
  }
  return buckets;
}

/** True when the first or last bucket covers only part of its week or month. */
export function hasPartialEdges(
  range: DateRange,
  granularity: Granularity,
): boolean {
  if (granularity === "week") {
    return (
      weekStart(range.from) !== range.from ||
      weekStart(range.to) !==
        new Date(dayMs(range.to) - 6 * DAY).toISOString().slice(0, 10)
    );
  }
  const [year, month] = range.to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return !range.from.endsWith("-01") || range.to !== lastDay;
}

// --- Aggregation -------------------------------------------------------------------

export type PublicAnalytics = {
  /** Records in the whole public dataset. */
  datasetTotal: number;
  /** Reports matching the filters. Every count below is out of these. */
  reports: number;
  range: DateRange | null;
  trend: {
    granularity: Granularity;
    partialEdges: boolean;
    items: CountItem[];
  };
  /** Suspected-medicine entries with a name (a report can name up to five). */
  medicineEntries: number;
  /** Entries whose name was blank. Not counted under any medicine. */
  medicineEntriesWithoutName: number;
  distinctMedicines: number;
  reportsWithoutReactionTerms: number;
  reportedSerious: number;
  /** Reports naming each medicine, counted once per report. */
  topMedicines: CountItem[];
  /** Reports listing each reaction term, counted once per report. */
  topReactionTerms: CountItem[];
  byStatus: CountItem[];
  byOutcome: CountItem[];
  byMedicalAttention: CountItem[];
  byReporterType: CountItem[];
  bySex: CountItem[];
  byAgeBand: CountItem[];
};

function countBy<K extends string>(
  records: PublicRecord[],
  keyOf: (record: PublicRecord) => K | null,
  categories: readonly { key: K; label: string }[],
  notProvidedLabel?: string,
): CountItem[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = keyOf(record) ?? "not_provided";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const items = categories.map(({ key, label }) => ({
    key,
    label,
    count: counts.get(key) ?? 0,
  }));
  return notProvidedLabel
    ? [
        ...items,
        {
          key: "not_provided",
          label: notProvidedLabel,
          count: counts.get("not_provided") ?? 0,
        },
      ]
    : items;
}

const entriesOf = <K extends string>(options: {
  values: readonly K[];
  labels: Record<K, string>;
}) => options.values.map((key) => ({ key, label: options.labels[key] }));

export function computePublicAnalytics(
  dataset: PublicRecord[],
  query: PublicQuery,
  coverage: DateRange,
  limits = { medicines: 10, reactionTerms: 10 },
): PublicAnalytics {
  const range = effectiveRange(query, coverage);
  const records = filterPublicRecords(dataset, query, range);
  const granularity = range ? granularityFor(range) : "month";

  const trendCounts = new Map<string, number>();
  for (const record of records) {
    const key = bucketKey(record.submittedOn, granularity);
    trendCounts.set(key, (trendCounts.get(key) ?? 0) + 1);
  }

  const named = (record: PublicRecord) =>
    record.medicines.filter((name) => name.trim() !== "");
  const allNames = records.flatMap(named);

  const statuses = [
    ...workflowStatuses,
    ...(["needs_info", "closed"] as const).filter((status) =>
      records.some((record) => record.status === status),
    ),
  ];

  return {
    datasetTotal: dataset.length,
    reports: records.length,
    range,
    trend: {
      granularity,
      partialEdges: range ? hasPartialEdges(range, granularity) : false,
      items: range
        ? dateBuckets(range, granularity).map((bucket) => ({
            ...bucket,
            count: trendCounts.get(bucket.key) ?? 0,
          }))
        : [],
    },
    medicineEntries: allNames.length,
    medicineEntriesWithoutName: records.reduce(
      (sum, record) => sum + record.medicines.length - named(record).length,
      0,
    ),
    distinctMedicines: new Set(
      allNames.map((name) => name.trim().toLowerCase()),
    ).size,
    reportsWithoutReactionTerms: records.filter(
      (record) => !record.reactionTerms.some((term) => term.trim() !== ""),
    ).length,
    reportedSerious: records.filter((record) =>
      isReportedSeriousEvent(record.outcome, record.medicalAttention),
    ).length,
    topMedicines: topValues(records, named, limits.medicines),
    topReactionTerms: topValues(
      records,
      (record) => record.reactionTerms,
      limits.reactionTerms,
    ),
    byStatus: countBy(
      records,
      (record) => record.status,
      statuses.map((key) => ({ key, label: reviewerStatusLabels[key] })),
    ),
    byOutcome: countBy(
      records,
      (record) => record.outcome,
      entriesOf(reactionOutcomes),
    ),
    byMedicalAttention: countBy(
      records,
      (record) => record.medicalAttention,
      entriesOf(medicalAttentionOptions),
    ),
    byReporterType: countBy(
      records,
      (record) => record.reporterType,
      entriesOf(reporterTypes),
    ),
    bySex: countBy(
      records,
      (record) => record.sex,
      entriesOf(patientSexes),
      "Not provided",
    ),
    byAgeBand: countBy(
      records,
      (record) => record.ageBand,
      ageBandKeys.map((key) => ({ key, label: ageBands[key] })),
      "Not provided",
    ),
  };
}

/** Distinct medicine names in a dataset, for the filter list (most common spelling). */
export function medicineOptionsOf(records: PublicRecord[]): string[] {
  return topValues(
    records,
    (record) => record.medicines.filter((name) => name.trim() !== ""),
    Number.MAX_SAFE_INTEGER,
  )
    .map((item) => item.label)
    .sort((a, b) => a.localeCompare(b));
}

export function publicQueryToSearchParams(query: PublicQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
