import { MAX_MEDICINES } from "./constants";
import {
  emptyMedicineDraft,
  type MedicineDraft,
  type MedicineEntry,
  type MedicineTextField,
  type ReportContent,
  type ReportDraft,
} from "./schema";

/**
 * Medicine entries in a report: pure helpers shared by the form, storage and review.
 *
 * Suspicion is only ever what the reporter marked. Nothing here marks a medicine as
 * suspected on its own, and "Not sure" clears every mark.
 */

// --- Form draft operations ------------------------------------------------------

/** Adds an empty entry, up to the limit. */
export function addMedicine(draft: ReportDraft): ReportDraft {
  if (draft.medicines.length >= MAX_MEDICINES) return draft;
  return { ...draft, medicines: [...draft.medicines, emptyMedicineDraft()] };
}

/** Removes an entry, always keeping at least one. */
export function removeMedicine(draft: ReportDraft, index: number): ReportDraft {
  if (draft.medicines.length <= 1) return draft;
  if (index < 0 || index >= draft.medicines.length) return draft;
  const medicines = draft.medicines.filter((_, i) => i !== index);
  return {
    ...draft,
    medicines,
    suspectedSelection: selectionAfter(draft.suspectedSelection, medicines),
  };
}

export function updateMedicine(
  draft: ReportDraft,
  index: number,
  field: MedicineTextField,
  value: string,
): ReportDraft {
  return {
    ...draft,
    medicines: draft.medicines.map((medicine, i) =>
      i === index ? { ...medicine, [field]: value } : medicine,
    ),
  };
}

/** The reporter ticks or unticks one medicine as suspected. */
export function setMedicineSuspected(
  draft: ReportDraft,
  index: number,
  suspected: boolean,
): ReportDraft {
  const medicines = draft.medicines.map((medicine, i) =>
    i === index ? { ...medicine, suspected } : medicine,
  );
  return {
    ...draft,
    medicines,
    // Ticking a medicine is an explicit choice, so it replaces "Not sure".
    suspectedSelection: medicines.some((medicine) => medicine.suspected)
      ? "marked"
      : draft.suspectedSelection === "not_sure"
        ? "not_sure"
        : "",
  };
}

/** The reporter chooses (or withdraws) "Not sure which medicine". */
export function setNotSure(draft: ReportDraft, notSure: boolean): ReportDraft {
  if (!notSure) {
    return draft.suspectedSelection === "not_sure"
      ? { ...draft, suspectedSelection: "" }
      : draft;
  }
  return {
    ...draft,
    suspectedSelection: "not_sure",
    medicines: draft.medicines.map((medicine) => ({
      ...medicine,
      suspected: false,
    })),
  };
}

function selectionAfter(selection: string, medicines: MedicineDraft[]): string {
  if (selection !== "marked") return selection;
  return medicines.some((medicine) => medicine.suspected) ? "marked" : "";
}

// --- Reading stored reports -----------------------------------------------------

export const suspectedMedicinesOf = (content: ReportContent) =>
  content.medicines.filter((medicine) => medicine.suspected);

/** Medicine names for summaries: the suspected ones, or all when "Not sure". */
export function suspectedOrAllNames(content: ReportContent): string[] {
  const suspected = suspectedMedicinesOf(content);
  return (suspected.length ? suspected : content.medicines).map(
    (medicine) => medicine.name,
  );
}

const emptyEntry: Omit<MedicineEntry, "name"> = {
  brand: null,
  strength: null,
  dose: null,
  frequency: null,
  route: null,
  startDate: null,
  endDate: null,
  courseStatus: null,
  previousDose: null,
  previousFrequency: null,
  changeDate: null,
  manufacturer: null,
  batchNumber: null,
  expiryDate: null,
  detailsSource: null,
  suspected: false,
};

/** A full entry from a partial one; absent fields are "not provided" (null). */
export function toMedicineEntry(
  partial: Partial<MedicineEntry> & { name: string },
): MedicineEntry {
  return { ...emptyEntry, ...partial };
}

/** Medicine shape stored before Milestone 6: every entry was a suspected medicine. */
export type LegacyMedicine = Pick<
  MedicineEntry,
  "name" | "dose" | "route" | "frequency" | "startDate"
>;

export type StoredContent =
  | ReportContent
  | (Omit<ReportContent, "medicines" | "suspectedSelection"> & {
      suspectedMedicines: LegacyMedicine[];
    });

/**
 * Reads report content saved by any version. Reports from before Milestone 6 listed only
 * suspected medicines, so each becomes an entry marked suspected, with the new details
 * "not provided". Nothing is inferred beyond what that earlier form recorded.
 */
export function normaliseReportContent(content: StoredContent): ReportContent {
  if ("medicines" in content && Array.isArray(content.medicines)) {
    return {
      ...content,
      medicines: content.medicines.map((medicine) => toMedicineEntry(medicine)),
      suspectedSelection: content.suspectedSelection ?? "marked",
    };
  }
  const { suspectedMedicines, ...rest } = content as Extract<
    StoredContent,
    { suspectedMedicines: LegacyMedicine[] }
  >;
  return {
    ...rest,
    medicines: suspectedMedicines.map((medicine) =>
      toMedicineEntry({ ...medicine, suspected: true }),
    ),
    suspectedSelection: "marked",
  };
}
