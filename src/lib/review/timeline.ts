import { reviewerStatusLabels } from "./status";
import type { ReviewReport } from "./types";

export type TimelineEntry = {
  /** ISO date (YYYY-MM-DD) for reported dates, full ISO timestamp for system events. */
  when: string;
  precision: "date" | "datetime";
  kind: "medicine_started" | "reaction_onset" | "submitted" | "status_change";
  title: string;
  detail: string | null;
  /** Who supplied it: the reporter's own account, or the system/reviewer record. */
  source: "reporter" | "system" | "reviewer";
};

export type Timeline = { entries: TimelineEntry[]; notProvided: string[] };

/**
 * Chronology of a report. Reporter-provided dates are shown as dates only; entries are
 * ordered, never interpreted (a reaction after a medicine start is not evidence of cause).
 * Dates the reporter did not give are listed separately, never estimated.
 */
export function buildTimeline(report: ReviewReport): Timeline {
  const entries: TimelineEntry[] = [];
  const notProvided: string[] = [];

  for (const medicine of report.content.suspectedMedicines) {
    if (medicine.startDate) {
      entries.push({
        when: medicine.startDate,
        precision: "date",
        kind: "medicine_started",
        title: `Started ${medicine.name}`,
        detail:
          [medicine.dose, medicine.frequency].filter(Boolean).join(", ") ||
          null,
        source: "reporter",
      });
    } else {
      notProvided.push(`Start date for ${medicine.name}`);
    }
  }

  const { onsetDate, onsetTime } = report.content.reaction;
  if (onsetDate) {
    entries.push({
      when: onsetDate,
      precision: "date",
      kind: "reaction_onset",
      title: "Reaction started",
      detail: onsetTime ? `At ${onsetTime} (as reported)` : null,
      source: "reporter",
    });
  } else {
    notProvided.push("Reaction start date");
  }

  entries.push({
    when: report.submittedAt,
    precision: "datetime",
    kind: "submitted",
    title: "Report submitted",
    detail: report.content.aiAssisted
      ? "AI suggestions were used and confirmed by the reporter"
      : null,
    source: "system",
  });

  for (const event of report.events) {
    entries.push({
      when: event.at,
      precision: "datetime",
      kind: "status_change",
      title: `${reviewerStatusLabels[event.from]} → ${reviewerStatusLabels[event.to]}`,
      detail: [event.reviewer, event.note].filter(Boolean).join(" — "),
      source: "reviewer",
    });
  }

  // Date-only entries sort at the start of their day; ties keep insertion order.
  const key = (entry: TimelineEntry) =>
    entry.precision === "date"
      ? `${entry.when}T00:00:00.000Z`
      : new Date(entry.when).toISOString();
  return {
    entries: entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) => key(a.entry).localeCompare(key(b.entry)) || a.index - b.index,
      )
      .map(({ entry }) => entry),
    notProvided,
  };
}
