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
} from "@/lib/ai/extraction-schema";
import { emptyReportDraft } from "@/lib/reports/schema";

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
) => ({
  name,
  dose: ok("500 mg"),
  route: ok("oral"),
  frequency: field(),
  startDate: ok("2026-09-02"),
  reporterRole: role,
  reporterRoleEvidence: null,
});

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

  it("requires a decision for medicines with an unclear role or a name needing review", () => {
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
      "suspected",
      "other",
      "undecided",
      "undecided",
    ]);
    expect(undecidedMedicines(decisions)).toEqual(["cetirizine", "BP tablet"]);
  });
});

describe("applyExtraction", () => {
  const base = () => emptyReportDraft(KEY);

  it("fills an empty form from accepted suggestions and marks it AI-assisted", () => {
    const decisions = initialDecisions(
      extraction({
        medicines: [medicine(ok("amoxicillin"))],
        symptoms: [ok("itchy rash")],
        onsetDate: ok("2026-09-04"),
        outcome: ok("recovering"),
        medicalAttention: ok("clinic_or_doctor"),
      }),
    );
    const { draft, applied, kept } = applyExtraction(base(), decisions);
    expect(draft.suspectedMedicines).toEqual([
      {
        name: "amoxicillin",
        dose: "500 mg",
        route: "oral",
        frequency: "",
        startDate: "2026-09-02",
      },
    ]);
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

  it("never overwrites what the reporter already entered", () => {
    const draft = base();
    draft.suspectedMedicines[0] = {
      name: "Amoxicillin",
      dose: "250 mg",
      route: "",
      frequency: "",
      startDate: "",
    };
    draft.reaction.outcome = "recovered";
    const result = applyExtraction(
      draft,
      initialDecisions(
        extraction({
          medicines: [medicine(ok("amoxicillin"))],
          outcome: ok("recovering"),
        }),
      ),
    );
    expect(result.draft.suspectedMedicines).toHaveLength(1);
    expect(result.draft.suspectedMedicines[0]).toMatchObject({
      name: "Amoxicillin",
      dose: "250 mg",
      route: "oral",
    });
    expect(result.draft.reaction.outcome).toBe("recovered");
    expect(result.kept).toEqual(["amoxicillin: dose", "Outcome"]);
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

  it("adds 'other' medicines to the other-medicines text, and skips undecided ones", () => {
    const decisions: ExtractionDecisions = initialDecisions(
      extraction({
        medicines: [
          medicine(ok("metformin"), "other"),
          medicine(ok("cetirizine"), "unclear"),
        ],
      }),
    );
    const { draft, applied } = applyExtraction(base(), decisions);
    expect(draft.otherMedicines).toBe("metformin 500 mg, started 2026-09-02");
    expect(draft.suspectedMedicines[0].name).toBe("");
    expect(applied).toEqual(["Other medicine: metformin"]);
  });

  it("respects the suspected-medicine and symptom limits", () => {
    const draft = base();
    draft.suspectedMedicines = ["a1", "b2", "c3", "d4", "e5"].map((name) => ({
      name,
      dose: "",
      route: "",
      frequency: "",
      startDate: "",
    }));
    draft.reaction.symptoms = Array.from(
      { length: 10 },
      (_, i) => `symptom ${i}`,
    );
    const result = applyExtraction(
      draft,
      initialDecisions(
        extraction({
          medicines: [medicine(ok("amoxicillin"))],
          symptoms: [ok("rash")],
        }),
      ),
    );
    expect(result.draft.suspectedMedicines).toHaveLength(5);
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
