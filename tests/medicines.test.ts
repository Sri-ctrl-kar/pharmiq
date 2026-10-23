import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MEDICINES } from "@/lib/reports/constants";
import {
  addMedicine,
  normaliseReportContent,
  removeMedicine,
  setMedicineSuspected,
  setNotSure,
  suspectedOrAllNames,
  toMedicineEntry,
  updateMedicine,
  type StoredContent,
} from "@/lib/reports/medicines";
import { findMissingInformation } from "@/lib/reports/missing-information";
import {
  emptyReportDraft,
  reportSubmissionSchema,
  toFieldErrors,
  toReportContent,
  type ReportDraft,
} from "@/lib/reports/schema";
import { medicineDraft, validDraft } from "./fixtures";

/** All data below is synthetic. */

const KEY = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const errorsOf = (draft: ReportDraft) => {
  const result = reportSubmissionSchema.safeParse(draft);
  return result.success ? {} : toFieldErrors(result.error.issues);
};
const parse = (draft: ReportDraft) => reportSubmissionSchema.parse(draft);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T06:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("adding and removing medicine entries", () => {
  it("starts with one empty entry and nothing marked as suspected", () => {
    const draft = emptyReportDraft(KEY);
    expect(draft.medicines).toEqual([medicineDraft()]);
    expect(draft.suspectedSelection).toBe("");
  });

  it("adds entries up to the limit", () => {
    let draft = emptyReportDraft(KEY);
    for (let i = 0; i < MAX_MEDICINES + 3; i++) draft = addMedicine(draft);
    expect(draft.medicines).toHaveLength(MAX_MEDICINES);
  });

  it("removes any entry, including the first, but always keeps one", () => {
    let draft = emptyReportDraft(KEY);
    draft = addMedicine(addMedicine(draft));
    draft = updateMedicine(draft, 0, "name", "Amoxicillin");
    draft = updateMedicine(draft, 1, "name", "Paracetamol");
    draft = updateMedicine(draft, 2, "name", "Cetirizine");

    draft = removeMedicine(draft, 0);
    expect(draft.medicines.map((m) => m.name)).toEqual([
      "Paracetamol",
      "Cetirizine",
    ]);
    draft = removeMedicine(draft, 1);
    draft = removeMedicine(draft, 0);
    expect(draft.medicines.map((m) => m.name)).toEqual(["Paracetamol"]);
    expect(removeMedicine(draft, 5)).toBe(draft);
  });

  it("keeps each entry's fields independent", () => {
    let draft = addMedicine(emptyReportDraft(KEY));
    draft = updateMedicine(draft, 1, "dose", "20 mg");
    expect(draft.medicines[0].dose).toBe("");
    expect(draft.medicines[1].dose).toBe("20 mg");
  });

  it("clears the suspected choice when the only marked medicine is removed", () => {
    let draft = addMedicine(emptyReportDraft(KEY));
    draft = setMedicineSuspected(draft, 1, true);
    expect(draft.suspectedSelection).toBe("marked");
    draft = removeMedicine(draft, 1);
    expect(draft.suspectedSelection).toBe("");
  });
});

describe("the reporter's suspected choice", () => {
  it("marks one or more medicines only when the reporter ticks them", () => {
    let draft = addMedicine(addMedicine(emptyReportDraft(KEY)));
    draft = setMedicineSuspected(draft, 0, true);
    draft = setMedicineSuspected(draft, 2, true);
    expect(draft.medicines.map((m) => m.suspected)).toEqual([
      true,
      false,
      true,
    ]);
    expect(draft.suspectedSelection).toBe("marked");
    draft = setMedicineSuspected(draft, 0, false);
    draft = setMedicineSuspected(draft, 2, false);
    expect(draft.suspectedSelection).toBe("");
  });

  it("“Not sure” clears every tick; ticking a medicine replaces “Not sure”", () => {
    let draft = setMedicineSuspected(
      addMedicine(emptyReportDraft(KEY)),
      0,
      true,
    );
    draft = setNotSure(draft, true);
    expect(draft.suspectedSelection).toBe("not_sure");
    expect(draft.medicines.every((m) => !m.suspected)).toBe(true);
    draft = setMedicineSuspected(draft, 1, true);
    expect(draft.suspectedSelection).toBe("marked");
    expect(setNotSure(setNotSure(draft, true), false).suspectedSelection).toBe(
      "",
    );
  });

  it("requires a choice: a marked medicine or “Not sure”", () => {
    const none = validDraft({
      medicines: [medicineDraft({ name: "Amoxicillin" })],
      suspectedSelection: "",
    });
    expect(errorsOf(none).suspectedSelection).toMatch(/Not sure/);
    const markedButNone = { ...none, suspectedSelection: "marked" };
    expect(errorsOf(markedButNone).suspectedSelection).toMatch(/at least one/);
    const notSure = { ...none, suspectedSelection: "not_sure" };
    expect(errorsOf(notSure)).toEqual({});
  });

  it("stores no suspected mark when the reporter is not sure, even if one was sent", () => {
    const parsed = parse(
      validDraft({
        medicines: [
          medicineDraft({ name: "Amoxicillin", suspected: true }),
          medicineDraft({ name: "Paracetamol" }),
        ],
        suspectedSelection: "not_sure",
      }),
    );
    expect(parsed.medicines.every((m) => !m.suspected)).toBe(true);
  });

  it("never marks a medicine suspected by default", () => {
    const parsed = parse(
      validDraft({
        medicines: [
          medicineDraft({ name: "Amoxicillin", suspected: true }),
          // `suspected` missing entirely (e.g. a hand-built request).
          { ...medicineDraft({ name: "Paracetamol" }), suspected: undefined },
        ] as ReportDraft["medicines"],
      }),
    );
    expect(parsed.medicines.map((m) => m.suspected)).toEqual([true, false]);
  });
});

describe("independent validation of each medicine", () => {
  it("reports errors against the entry they belong to", () => {
    const draft = validDraft({
      medicines: [
        medicineDraft({ name: "Amoxicillin", suspected: true }),
        medicineDraft({ name: "", batchNumber: "<b>" }),
        medicineDraft({ name: "Paracetamol", expiryDate: "2027-13" }),
      ],
    });
    expect(Object.keys(errorsOf(draft)).sort()).toEqual([
      "medicines.1.batchNumber",
      "medicines.1.name",
      "medicines.2.expiryDate",
    ]);
  });

  it("checks each medicine's own dates", () => {
    const errors = errorsOf(
      validDraft({
        medicines: [
          medicineDraft({
            name: "Amoxicillin",
            startDate: "2026-08-10",
            endDate: "2026-08-01",
            suspected: true,
          }),
          medicineDraft({
            name: "Paracetamol",
            courseStatus: "currently_taking",
            endDate: "2026-08-01",
          }),
          medicineDraft({ name: "Cetirizine", endDate: "2099-01-01" }),
        ],
      }),
    );
    expect(errors["medicines.0.endDate"]).toMatch(/before the start/);
    expect(errors["medicines.1.endDate"]).toMatch(/Remove the end date/);
    expect(errors["medicines.2.endDate"]).toMatch(/future/);
  });

  it("supports unknown dates and optional details without guessing", () => {
    const parsed = parse(
      validDraft({
        medicines: [medicineDraft({ name: "Amoxicillin", suspected: true })],
      }),
    );
    expect(parsed.medicines[0]).toEqual(
      toMedicineEntry({ name: "Amoxicillin", suspected: true }),
    );
  });
});

describe("course changes", () => {
  const changed = (fields: Parameters<typeof medicineDraft>[0]) =>
    validDraft({
      medicines: [
        medicineDraft({
          name: "Atorvastatin",
          dose: "20 mg",
          frequency: "Once at night",
          startDate: "2026-06-01",
          suspected: true,
          ...fields,
        }),
      ],
    });

  it("keeps the previous and current dose/frequency and the approximate change date", () => {
    const [medicine] = parse(
      changed({
        courseStatus: "dose_changed",
        previousDose: "10 mg",
        previousFrequency: "Once at night",
        changeDate: "2026-07-15",
      }),
    ).medicines;
    expect(medicine).toMatchObject({
      dose: "20 mg",
      previousDose: "10 mg",
      previousFrequency: "Once at night",
      changeDate: "2026-07-15",
    });
  });

  it("allows the previous dose to be unknown, and lists it as missing information", () => {
    const content = toReportContent(
      parse(changed({ courseStatus: "dose_changed" })),
    );
    expect(findMissingInformation(content).map((m) => m.field)).toContain(
      "medicines.0.previousDose",
    );
  });

  it("checks the change date against the course", () => {
    const errors = errorsOf(
      changed({ courseStatus: "dose_changed", changeDate: "2026-05-01" }),
    );
    expect(errors["medicines.0.changeDate"]).toMatch(/before the start/);
  });

  it("drops course-change details unless the status says the dose changed", () => {
    const [medicine] = parse(
      changed({
        courseStatus: "stopped",
        previousDose: "10 mg",
        changeDate: "2026-07-15",
      }),
    ).medicines;
    expect(medicine).toMatchObject({
      courseStatus: "stopped",
      previousDose: null,
      previousFrequency: null,
      changeDate: null,
    });
  });
});

describe("product details", () => {
  it("accepts manufacturer, batch, expiry month and how they were checked", () => {
    const [medicine] = parse(
      validDraft({
        medicines: [
          medicineDraft({
            name: "Amoxicillin",
            brand: "Synthetic Brand",
            strength: "500 mg",
            manufacturer: "Synthetic Example Pharma",
            batchNumber: " B.No. AB-12/34 ",
            expiryDate: "2027-06",
            detailsSource: "pack_or_label",
            suspected: true,
          }),
        ],
      }),
    ).medicines;
    expect(medicine).toMatchObject({
      brand: "Synthetic Brand",
      strength: "500 mg",
      manufacturer: "Synthetic Example Pharma",
      batchNumber: "B.No. AB-12/34",
      expiryDate: "2027-06",
      detailsSource: "pack_or_label",
    });
  });

  it("rejects malformed batch numbers, expiry dates and sources", () => {
    const errors = errorsOf(
      validDraft({
        medicines: [
          medicineDraft({
            name: "Amoxicillin",
            batchNumber: "x".repeat(41),
            expiryDate: "06/2027",
            detailsSource: "guessed",
            suspected: true,
          }),
        ],
      }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "medicines.0.batchNumber",
      "medicines.0.detailsSource",
      "medicines.0.expiryDate",
    ]);
  });
});

describe("reports saved before Milestone 6", () => {
  const legacy = {
    reporterType: "patient",
    patient: { initials: null, ageYears: 40, sex: "female", state: null },
    suspectedMedicines: [
      {
        name: "Amoxicillin",
        dose: "500 mg",
        route: "oral",
        frequency: null,
        startDate: "2026-08-01",
      },
      {
        name: "Cetirizine",
        dose: null,
        route: null,
        frequency: null,
        startDate: null,
      },
    ],
    reaction: {
      description: "[Synthetic] Rash after starting two medicines.",
      onsetDate: null,
      onsetTime: null,
      symptoms: [],
      outcome: "recovering",
      medicalAttention: "none",
    },
    otherMedicines: null,
    medicalHistory: null,
    aiAssisted: false,
  } as StoredContent;

  it("reads them as entries the reporter marked suspected, with new details not provided", () => {
    const content = normaliseReportContent(legacy);
    expect(content.suspectedSelection).toBe("marked");
    expect(content.medicines).toEqual([
      toMedicineEntry({
        name: "Amoxicillin",
        dose: "500 mg",
        route: "oral",
        startDate: "2026-08-01",
        suspected: true,
      }),
      toMedicineEntry({ name: "Cetirizine", suspected: true }),
    ]);
    expect("suspectedMedicines" in content).toBe(false);
  });

  it("leaves current reports unchanged", () => {
    const current = toReportContent(parse(validDraft()));
    expect(normaliseReportContent(current)).toEqual(current);
  });

  it("names suspected medicines for summaries, or all when not sure", () => {
    const content = toReportContent(
      parse(
        validDraft({
          medicines: [
            medicineDraft({ name: "Amoxicillin" }),
            medicineDraft({ name: "Paracetamol", suspected: true }),
          ],
        }),
      ),
    );
    expect(suspectedOrAllNames(content)).toEqual(["Paracetamol"]);
    expect(
      suspectedOrAllNames({
        ...content,
        suspectedSelection: "not_sure",
        medicines: content.medicines.map((m) => ({ ...m, suspected: false })),
      }),
    ).toEqual(["Amoxicillin", "Paracetamol"]);
  });
});
