import { describe, expect, it } from "vitest";
import {
  applyExtraction,
  initialDecisions,
  undecidedMedicines,
  type ExtractionDecisions,
} from "@/lib/ai/apply-extraction";
import type {
  VerifiedExtraction,
  VerifiedField,
  VerifiedMedicine,
} from "@/lib/ai/extraction-schema";
import { emptyReportDraft, reportSubmissionSchema } from "@/lib/reports/schema";
import { medicineDraft } from "../fixtures";

const field = (overrides: Partial<VerifiedField> = {}): VerifiedField => ({
  status: "missing",
  value: null,
  evidence: null,
  note: null,
  flags: [],
  needsReview: false,
  ...overrides,
});
const ok = (value: string) =>
  field({ status: "reported", value, evidence: value });
const review = (value: string) =>
  field({
    status: "reported",
    value,
    evidence: value,
    needsReview: true,
    flags: [{ code: "evidence_not_found", message: "x" }],
  });

function extraction(
  overrides: Partial<VerifiedExtraction> = {},
): VerifiedExtraction {
  return {
    medicines: [],
    symptoms: [],
    onsetDate: field(),
    onsetTime: field(),
    outcome: field(),
    medicalAttention: field(),
    warnings: [],
    ...overrides,
  };
}

const medicine = (
  name: VerifiedField,
  role: "suspected" | "other" | "unclear" = "suspected",
  overrides: Partial<VerifiedMedicine> = {},
): VerifiedMedicine => ({
  name,
  dose: ok("500 mg"),
  route: ok("oral"),
  frequency: field(),
  startDate: ok("2026-09-02"),
  endDate: field(),
  courseStatus: field(),
  previousDose: field(),
  previousFrequency: field(),
  changeDate: field(),
  reporterRole: role,
  reporterRoleEvidence: role === "suspected" ? "we think it was this" : null,
  ...overrides,
});

/** The reporter's own choice for each medicine, in order. */
const choose = (
  decisions: ExtractionDecisions,
  ...roles: ExtractionDecisions["medicines"][number]["role"][]
) => {
  roles.forEach((role, index) => (decisions.medicines[index].role = role));
  return decisions;
};

const KEY = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("initialDecisions", () => {
  it("pre-selects only well-supported values and never ones needing review", () => {
    const decisions = initialDecisions(
      extraction({
        onsetDate: ok("2026-09-04"),
        outcome: review("fatal"),
        onsetTime: field({
          status: "ambiguous",
          evidence: "around 9 pm",
          needsReview: true,
        }),
        symptoms: [ok("rash"), review("fever")],
      }),
    );
    expect(decisions.onsetDate).toEqual({ accept: true, value: "2026-09-04" });
    expect(decisions.outcome).toEqual({ accept: false, value: "fatal" });
    expect(decisions.onsetTime).toEqual({ accept: false, value: "" });
    expect(decisions.symptoms.map((s) => s.accept)).toEqual([true, false]);
  });

  it("never pre-selects whether a medicine is suspected, even when the reporter's words suggest it", () => {
    const decisions = initialDecisions(
      extraction({
        medicines: [
          medicine(ok("amoxicillin"), "suspected"),
          medicine(ok("metformin"), "other"),
          medicine(ok("cetirizine"), "unclear"),
          medicine(review("BP tablet"), "suspected"),
        ],
      }),
    );
    expect(decisions.medicines.map((m) => m.role)).toEqual([
      "undecided",
      "undecided",
      "undecided",
      "undecided",
    ]);
    expect(undecidedMedicines(decisions)).toEqual([
      "amoxicillin",
      "metformin",
      "cetirizine",
      "BP tablet",
    ]);
  });

  it("never pre-selects course-change details", () => {
    const flagged = (value: string) =>
      field({
        status: "reported",
        value,
        evidence: value,
        needsReview: true,
        flags: [{ code: "confirm_course_change", message: "x" }],
      });
    const [decision] = initialDecisions(
      extraction({
        medicines: [
          medicine(ok("atorvastatin"), "unclear", {
            courseStatus: flagged("dose_changed"),
            previousDose: flagged("10 mg"),
            changeDate: flagged("2026-10-01"),
            endDate: ok("2026-10-10"),
          }),
        ],
      }),
    ).medicines;
    expect(decision.courseStatus.accept).toBe(false);
    expect(decision.previousDose.accept).toBe(false);
    expect(decision.changeDate.accept).toBe(false);
    expect(decision.endDate).toEqual({ accept: true, value: "2026-10-10" });
  });
});

describe("applyExtraction", () => {
  const base = () => emptyReportDraft(KEY);

  it("fills an empty form from accepted suggestions and the reporter's choices", () => {
    const decisions = choose(
      initialDecisions(
        extraction({
          medicines: [medicine(ok("amoxicillin"))],
          symptoms: [ok("itchy rash")],
          onsetDate: ok("2026-09-04"),
          outcome: ok("recovering"),
          medicalAttention: ok("clinic_or_doctor"),
        }),
      ),
      "suspected",
    );
    const { draft, applied, kept } = applyExtraction(base(), decisions);
    expect(draft.medicines).toEqual([
      medicineDraft({
        name: "amoxicillin",
        dose: "500 mg",
        route: "oral",
        startDate: "2026-09-02",
        suspected: true,
      }),
    ]);
    expect(draft.suspectedSelection).toBe("marked");
    expect(draft.reaction).toMatchObject({
      onsetDate: "2026-09-04",
      outcome: "recovering",
      medicalAttention: "clinic_or_doctor",
      symptoms: ["itchy rash"],
    });
    expect(draft.aiAssisted).toBe(true);
    expect(kept).toEqual([]);
    expect(applied).toContain("Suspected medicine: amoxicillin");
  });

  it("adds each medicine as its own entry, keeping details with the right medicine", () => {
    const decisions = choose(
      initialDecisions(
        extraction({
          medicines: [
            medicine(ok("amoxicillin"), "suspected", { dose: ok("500 mg") }),
            medicine(ok("paracetamol"), "other", {
              dose: ok("650 mg"),
              startDate: field(),
            }),
          ],
        }),
      ),
      "suspected",
      "other",
    );
    const { draft } = applyExtraction(base(), decisions);
    expect(draft.medicines.map((m) => [m.name, m.dose, m.suspected])).toEqual([
      ["amoxicillin", "500 mg", true],
      ["paracetamol", "650 mg", false],
    ]);
    // Not-suspected medicines become entries, not free text.
    expect(draft.otherMedicines).toBe("");
    expect(
      reportSubmissionSchema.safeParse({ ...draft, declaration: true }),
    ).toMatchObject({ success: false }); // still needs the reporter's other answers
  });

  it("never overwrites what the reporter already entered, including their suspected mark", () => {
    const draft = base();
    draft.medicines[0] = medicineDraft({
      name: "Amoxicillin",
      dose: "250 mg",
      suspected: false,
    });
    draft.reaction.outcome = "recovered";
    const result = applyExtraction(
      draft,
      choose(
        initialDecisions(
          extraction({
            medicines: [medicine(ok("amoxicillin"))],
            outcome: ok("recovering"),
          }),
        ),
        "suspected",
      ),
    );
    expect(result.draft.medicines).toHaveLength(1);
    expect(result.draft.medicines[0]).toMatchObject({
      name: "Amoxicillin",
      dose: "250 mg",
      route: "oral",
      suspected: false,
    });
    expect(result.draft.suspectedSelection).toBe("");
    expect(result.draft.reaction.outcome).toBe("recovered");
    expect(result.kept).toEqual([
      "amoxicillin: not marked as suspected, as you set it",
      "amoxicillin: dose",
      "Outcome",
    ]);
  });

  it("does not mark a medicine suspected when the reporter chose “Not sure”", () => {
    const draft = { ...base(), suspectedSelection: "not_sure" };
    const result = applyExtraction(
      draft,
      choose(
        initialDecisions(
          extraction({ medicines: [medicine(ok("ibuprofen"))] }),
        ),
        "suspected",
      ),
    );
    expect(result.draft.medicines[0]).toMatchObject({
      name: "ibuprofen",
      suspected: false,
    });
    expect(result.draft.suspectedSelection).toBe("not_sure");
    expect(result.kept[0]).toMatch(/Not sure/);
  });

  it("applies course-change details only to an entry marked as a dose change", () => {
    const withChange = (status: string) =>
      medicine(ok("atorvastatin"), "unclear", {
        dose: ok("20 mg"),
        courseStatus: ok(status),
        previousDose: ok("10 mg"),
        changeDate: ok("2026-10-01"),
      });
    const accepted = (status: string) => {
      const decisions = choose(
        initialDecisions(extraction({ medicines: [withChange(status)] })),
        "suspected",
      );
      for (const key of ["courseStatus", "previousDose", "changeDate"] as const)
        decisions.medicines[0][key].accept = true;
      return applyExtraction(base(), decisions);
    };

    const changed = accepted("dose_changed");
    expect(changed.draft.medicines[0]).toMatchObject({
      dose: "20 mg",
      courseStatus: "dose_changed",
      previousDose: "10 mg",
      changeDate: "2026-10-01",
    });

    const stopped = accepted("stopped");
    expect(stopped.draft.medicines[0]).toMatchObject({
      courseStatus: "stopped",
      previousDose: "",
      changeDate: "",
    });
    expect(stopped.skipped).toHaveLength(2);
  });

  it("applies edited values and ignores rejected ones", () => {
    const decisions = initialDecisions(
      extraction({ onsetDate: ok("2026-09-04"), outcome: ok("recovering") }),
    );
    decisions.onsetDate = { accept: true, value: "2026-09-05" };
    decisions.outcome = { ...decisions.outcome, accept: false };
    const { draft } = applyExtraction(base(), decisions);
    expect(draft.reaction.onsetDate).toBe("2026-09-05");
    expect(draft.reaction.outcome).toBe("");
  });

  it("skips medicines left undecided or marked “don't add”", () => {
    const decisions = choose(
      initialDecisions(
        extraction({
          medicines: [medicine(ok("metformin")), medicine(ok("cetirizine"))],
        }),
      ),
      "undecided",
      "skip",
    );
    const { draft, applied } = applyExtraction(base(), decisions);
    expect(draft.medicines).toEqual([medicineDraft()]);
    expect(applied).toEqual([]);
  });

  it("respects the medicine and symptom limits", () => {
    const draft = base();
    draft.medicines = Array.from({ length: 10 }, (_, i) =>
      medicineDraft({ name: `Synthetic ${i}` }),
    );
    draft.reaction.symptoms = Array.from(
      { length: 10 },
      (_, i) => `symptom ${i}`,
    );
    const result = applyExtraction(
      draft,
      choose(
        initialDecisions(
          extraction({
            medicines: [medicine(ok("amoxicillin"))],
            symptoms: [ok("rash")],
          }),
        ),
        "suspected",
      ),
    );
    expect(result.draft.medicines).toHaveLength(10);
    expect(result.skipped).toHaveLength(2);
  });

  it("changes nothing and stays non-AI-assisted when nothing is accepted", () => {
    const original = base();
    const result = applyExtraction(
      original,
      initialDecisions(extraction({ outcome: review("fatal") })),
    );
    expect(result.draft).toEqual(original);
    expect(result.applied).toEqual([]);
  });
});
