import { describe, expect, it } from "vitest";
import type { VerifiedExtraction } from "@/lib/ai/extraction-schema";
import { syntheticExtractionCases } from "@/lib/ai/synthetic-examples";
import { verifyExtraction } from "@/server/ai/verify-extraction";
import {
  ambiguous,
  asEnumField,
  medicine,
  missing,
  reported,
  simulatedOutput,
} from "./helpers";

const NOW = new Date("2026-10-23T06:00:00Z");
const text = (id: string) =>
  syntheticExtractionCases.find((c) => c.id === id)!.description;

function verified(raw: unknown, source: string): VerifiedExtraction {
  const result = verifyExtraction(raw, source, NOW);
  if (!result.ok) throw new Error("expected verification to succeed");
  return result.extraction;
}

describe("valid extraction", () => {
  const source = text("clear-single-medicine");
  const output = simulatedOutput({
    medicines: [
      medicine({
        name: reported("amoxicillin", "amoxicillin 500 mg capsules"),
        dose: reported("500 mg", "amoxicillin 500 mg capsules"),
        route: asEnumField(reported("oral", "capsules")),
        frequency: reported("three times a day", "three times a day"),
        start_date: reported("2026-09-02", "on 2 September 2026"),
      }),
    ],
    symptoms: [
      reported("itchy red rash", "an itchy red rash on my arms and chest"),
    ],
    reaction_onset_date: reported("2026-09-04", "On 4 September 2026"),
    reaction_onset_time: ambiguous("around 9 pm", "Approximate time."),
    outcome: asEnumField(
      reported("recovering", "The rash is getting better now"),
    ),
    medical_attention: asEnumField(
      reported("clinic_or_doctor", "I saw my family doctor"),
    ),
  });

  it("accepts well-supported values without flags", () => {
    const result = verified(output, source);
    const [med] = result.medicines;
    expect(med.name).toMatchObject({
      status: "reported",
      value: "amoxicillin",
      needsReview: false,
    });
    expect(med.dose.value).toBe("500 mg");
    expect(med.startDate).toMatchObject({ value: "2026-09-02", flags: [] });
    expect(result.onsetDate).toMatchObject({
      value: "2026-09-04",
      needsReview: false,
    });
    expect(result.outcome).toMatchObject({
      value: "recovering",
      needsReview: false,
    });
    expect(result.medicalAttention.value).toBe("clinic_or_doctor");
    expect(result.symptoms.map((s) => s.value)).toEqual(["itchy red rash"]);
    expect(result.warnings).toEqual([]);
  });

  it("always routes ambiguous values to human review", () => {
    expect(verified(output, source).onsetTime).toMatchObject({
      status: "ambiguous",
      value: null,
      needsReview: true,
    });
  });

  it("matches quotes despite case, whitespace and typographic differences", () => {
    const result = verified(
      simulatedOutput({
        symptoms: [reported("Itchy red rash", "AN  ITCHY red rash")],
      }),
      source,
    );
    expect(result.symptoms[0].needsReview).toBe(false);
  });
});

describe("missing fields", () => {
  it("returns not-mentioned fields as missing with no value and no review needed", () => {
    const result = verified(simulatedOutput(), text("almost-nothing"));
    for (const field of [
      result.onsetDate,
      result.onsetTime,
      result.outcome,
      result.medicalAttention,
    ]) {
      expect(field).toEqual({
        status: "missing",
        value: null,
        evidence: null,
        note: null,
        flags: [],
        needsReview: false,
      });
    }
    expect(result.medicines).toEqual([]);
  });

  it("treats 'reported' with neither value nor quote as missing", () => {
    const result = verified(
      simulatedOutput({
        reaction_onset_date: {
          status: "reported",
          value: null,
          evidence: null,
          note: null,
        },
      }),
      text("almost-nothing"),
    );
    expect(result.onsetDate.status).toBe("missing");
  });

  it("flags a 'missing' field that nevertheless carries a value", () => {
    const result = verified(
      simulatedOutput({
        reaction_onset_date: {
          status: "missing",
          value: "2026-09-01",
          evidence: null,
          note: null,
        },
      }),
      text("almost-nothing"),
    );
    expect(result.onsetDate.status).toBe("ambiguous");
    expect(result.onsetDate.flags.map((f) => f.code)).toContain(
      "inconsistent_status",
    );
  });
});

describe("ambiguous descriptions", () => {
  it("keeps relative dates ambiguous with no calculated value", () => {
    const source = text("relative-dates");
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("ibuprofen", "Took ibuprofen 400mg"),
            start_date: ambiguous(
              "yesterday evening",
              "Relative date; the exact date is not stated.",
            ),
          }),
        ],
        reaction_onset_date: ambiguous("this morning", "Relative date."),
      }),
      source,
    );
    expect(result.medicines[0].startDate).toMatchObject({
      status: "ambiguous",
      value: null,
      needsReview: true,
    });
    expect(result.onsetDate.value).toBeNull();
  });

  it("flags vague medicine names even when the model marked them reported", () => {
    const source = text("vague-medicine-name");
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({ name: reported("BP tablet", "a new BP tablet") }),
        ],
      }),
      source,
    );
    expect(result.medicines[0].name.needsReview).toBe(true);
    expect(result.medicines[0].name.flags.map((f) => f.code)).toEqual([
      "not_specific_medicine",
    ]);
  });

  it.each(["antibiotic", "the injection", "flu vaccine", "BP"])(
    "treats %s as not specific",
    (name) => {
      const source = `I took ${name} and felt sick.`;
      const result = verified(
        simulatedOutput({
          medicines: [medicine({ name: reported(name, name) })],
        }),
        source,
      );
      expect(result.medicines[0].name.flags.map((f) => f.code)).toContain(
        "not_specific_medicine",
      );
    },
  );

  it("flags reaction dates that are before the medicine start date", () => {
    const source = text("conflicting-dates");
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("cetirizine", "Started cetirizine 10 mg"),
            start_date: reported("2026-09-15", "on 15 September 2026"),
          }),
        ],
        reaction_onset_date: reported(
          "2026-09-12",
          "began on 12 September 2026",
        ),
      }),
      source,
    );
    expect(result.onsetDate.flags.map((f) => f.code)).toEqual([
      "conflicting_dates",
    ]);
    expect(result.medicines[0].startDate.needsReview).toBe(true);
  });

  it("flags numeric dates whose day and month could be swapped", () => {
    const source = text("day-month-unclear");
    const result = verified(
      simulatedOutput({
        reaction_onset_date: reported("2026-04-05", "rash appeared 05/04/2026"),
      }),
      source,
    );
    expect(result.onsetDate.flags.map((f) => f.code)).toContain(
      "day_month_unclear",
    );
  });

  it("does not flag unambiguous numeric dates", () => {
    const source = "Rash appeared 25/04/2026 after paracetamol.";
    const result = verified(
      simulatedOutput({
        reaction_onset_date: reported("2026-04-25", "Rash appeared 25/04/2026"),
      }),
      source,
    );
    expect(result.onsetDate.flags).toEqual([]);
  });

  it("flags a time without a usable date", () => {
    const source = "At 14:30 I felt dizzy after metformin.";
    const result = verified(
      simulatedOutput({ reaction_onset_time: reported("14:30", "At 14:30") }),
      source,
    );
    expect(result.onsetTime.flags.map((f) => f.code)).toContain(
      "time_without_date",
    );
  });
});

describe("fabricated or unsupported values", () => {
  const source = text("clear-single-medicine");

  it("flags a medicine that does not appear in the description", () => {
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("paracetamol", "took paracetamol 650 mg"),
          }),
        ],
      }),
      source,
    );
    expect(result.medicines[0].name).toMatchObject({ needsReview: true });
    expect(result.medicines[0].name.flags.map((f) => f.code)).toContain(
      "evidence_not_found",
    );
  });

  it("flags a value that is not in its own quote", () => {
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("amoxicillin", "amoxicillin 500 mg"),
            dose: reported("250 mg", "amoxicillin 500 mg"),
          }),
        ],
      }),
      source,
    );
    expect(result.medicines[0].dose.flags.map((f) => f.code)).toEqual([
      "value_not_in_evidence",
    ]);
  });

  it("flags values with no supporting quote", () => {
    const result = verified(
      simulatedOutput({
        symptoms: [
          { status: "reported", value: "fever", evidence: null, note: null },
        ],
      }),
      source,
    );
    expect(result.symptoms[0].flags.map((f) => f.code)).toEqual([
      "evidence_not_found",
    ]);
  });

  it("flags a year the model assumed but the reporter did not write", () => {
    const result = verified(
      simulatedOutput({
        reaction_onset_date: reported("2026-09-04", "4 Sept"),
      }),
      "Rash started 4 Sept after amoxicillin.",
    );
    expect(result.onsetDate.flags.map((f) => f.code)).toContain(
      "year_not_stated",
    );
  });

  it("flags invalid and future dates", () => {
    const future = verified(
      simulatedOutput({
        reaction_onset_date: reported("2027-01-05", "5 January 2027"),
      }),
      "Rash on 5 January 2027.",
    );
    expect(future.onsetDate.flags.map((f) => f.code)).toContain("future_date");
    const invalid = verified(
      simulatedOutput({
        reaction_onset_date: reported("2026-02-30", "30 February 2026"),
      }),
      "Rash on 30 February 2026.",
    );
    expect(invalid.onsetDate.flags.map((f) => f.code)).toContain(
      "invalid_date",
    );
  });

  it("does not accept death or hospital admission without explicit wording", () => {
    const result = verified(
      simulatedOutput({
        outcome: asEnumField(
          reported("fatal", "The rash is getting better now"),
        ),
        medical_attention: asEnumField(
          reported("hospitalised", "I saw my family doctor"),
        ),
      }),
      source,
    );
    expect(result.outcome.flags.map((f) => f.code)).toEqual([
      "unsupported_severity",
    ]);
    expect(result.medicalAttention.flags.map((f) => f.code)).toEqual([
      "unsupported_severity",
    ]);
  });

  it("accepts hospital admission when the reporter states it", () => {
    const result = verified(
      simulatedOutput({
        medical_attention: asEnumField(
          reported("hospitalised", "was admitted for two days"),
        ),
      }),
      text("identifiers-removed"),
    );
    expect(result.medicalAttention.needsReview).toBe(false);
  });

  it("downgrades a 'suspected' role without the reporter's own words", () => {
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("amoxicillin", "amoxicillin"),
            reporter_role: "suspected",
            reporter_role_evidence: "amoxicillin clearly caused this",
          }),
        ],
      }),
      source,
    );
    expect(result.medicines[0]).toMatchObject({
      reporterRole: "unclear",
      reporterRoleEvidence: null,
    });
  });

  it("keeps a 'suspected' role that quotes the reporter", () => {
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("atorvastatin", "atorvastatin 10 mg"),
            reporter_role: "suspected",
            reporter_role_evidence:
              "We think the new tablet might be the reason",
          }),
        ],
      }),
      text("caregiver-two-medicines"),
    );
    expect(result.medicines[0].reporterRole).toBe("suspected");
  });

  it("replaces model notes that give advice, diagnose or assert causality", () => {
    for (const note of [
      "You should stop taking this medicine.",
      "This was probably caused by amoxicillin.",
      "Consistent with a diagnosis of urticaria.",
      "This looks like a serious reaction.",
    ]) {
      const result = verified(
        simulatedOutput({
          reaction_onset_date: ambiguous("4 September 2026", note),
        }),
        source,
      );
      expect(result.onsetDate.note).toBe("Check this against the description.");
    }
  });

  it("keeps neutral notes", () => {
    const result = verified(
      simulatedOutput({
        reaction_onset_date: ambiguous("around 9 pm", "Approximate time only."),
      }),
      source,
    );
    expect(result.onsetDate.note).toBe("Approximate time only.");
  });
});

describe("malformed AI output", () => {
  const source = text("clear-single-medicine");

  it.each([
    ["null", null],
    ["a string", "amoxicillin, rash"],
    ["an array", []],
    ["missing keys", { medicines: [] }],
    [
      "wrong status",
      simulatedOutput({
        reaction_onset_date: {
          status: "likely",
          value: null,
          evidence: null,
          note: null,
        } as never,
      }),
    ],
    [
      "enum outside the vocabulary",
      simulatedOutput({
        outcome: {
          status: "reported",
          value: "worse",
          evidence: "x",
          note: null,
        } as never,
      }),
    ],
    [
      "wrong value type",
      simulatedOutput({
        reaction_onset_date: {
          status: "reported",
          value: 20260904,
          evidence: "x",
          note: null,
        } as never,
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(verifyExtraction(raw, source, NOW)).toEqual({
      ok: false,
      reason: "schema",
    });
  });

  it("rejects fabricated extra fields such as causality, severity or advice", () => {
    for (const extra of [
      { causality: "probable" },
      { severity: "severe" },
      { advice: "Stop the medicine." },
    ]) {
      expect(
        verifyExtraction({ ...simulatedOutput(), ...extra }, source, NOW).ok,
      ).toBe(false);
    }
    const nested = simulatedOutput({
      medicines: [
        {
          ...medicine({ name: reported("amoxicillin", "amoxicillin") }),
          causal: true,
        } as never,
      ],
    });
    expect(verifyExtraction(nested, source, NOW).ok).toBe(false);
    const inField = simulatedOutput({
      reaction_onset_date: {
        ...reported("2026-09-04", "4 September 2026"),
        diagnosis: "urticaria",
      } as never,
    });
    expect(verifyExtraction(inField, source, NOW).ok).toBe(false);
  });
});

describe("limits and housekeeping", () => {
  it("drops nameless medicines and caps the list at five with a warning", () => {
    const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    const source = `Took ${names.join(", ")} last week.`;
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({ name: missing() }),
          ...names.map((name) => medicine({ name: reported(name, name) })),
        ],
      }),
      source,
    );
    expect(result.medicines.map((m) => m.name.value)).toEqual(
      names.slice(0, 5),
    );
    expect(result.warnings).toHaveLength(2);
  });

  it("flags duplicate medicines", () => {
    const source = "Took Amoxicillin then amoxicillin again.";
    const result = verified(
      simulatedOutput({
        medicines: [
          medicine({ name: reported("Amoxicillin", "Amoxicillin") }),
          medicine({ name: reported("amoxicillin", "amoxicillin") }),
        ],
      }),
      source,
    );
    expect(result.medicines[1].name.flags.map((f) => f.code)).toContain(
      "duplicate_medicine",
    );
    expect(result.medicines[0].name.needsReview).toBe(false);
  });
});
