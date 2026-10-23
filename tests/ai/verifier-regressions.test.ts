import { describe, expect, it } from "vitest";
import type {
  ReviewFlagCode,
  VerifiedExtraction,
  VerifiedField,
} from "@/lib/ai/extraction-schema";
import { syntheticExtractionCases } from "@/lib/ai/synthetic-examples";
import { runExtraction } from "@/server/ai/extraction-service";
import { scoreCase } from "../../evals/extraction/score";
import {
  ambiguous,
  asEnumField,
  medicine,
  reported,
  simulatedOutput,
} from "./helpers";

/**
 * Regression tests from the M3 safety review. Each probe is a SIMULATED (hand-written)
 * model mistake on a synthetic case. Every one must reach the reporter unticked with a
 * reason — never pre-selected. These test the deterministic verifier, not the model.
 */

const NOW = new Date("2026-10-23T06:00:00Z");
const caseText = (id: string) =>
  syntheticExtractionCases.find((c) => c.id === id)!.description;

async function extract(
  text: string,
  output: unknown,
): Promise<VerifiedExtraction> {
  const result = await runExtraction(
    text,
    { extract: async () => ({ output, model: "simulated" }) },
    { now: NOW, logError: () => {} },
  );
  if (!result.ok) throw new Error(`unexpected ${result.error.code}`);
  return result.extraction;
}

const codes = (field: VerifiedField) => field.flags.map((f) => f.code);

const clear = simulatedOutput({
  medicines: [
    medicine({
      name: reported("amoxicillin", "amoxicillin 500 mg capsules"),
      dose: reported("500 mg", "amoxicillin 500 mg capsules"),
      route: asEnumField(reported("oral", "capsules")),
      frequency: reported("three times a day", "three times a day"),
      start_date: reported("2026-09-02", "on 2 September 2026"),
    }),
  ],
  symptoms: [reported("itchy red rash", "an itchy red rash")],
  reaction_onset_date: reported("2026-09-04", "On 4 September 2026"),
  reaction_onset_time: ambiguous("around 9 pm", "Approximate time."),
  outcome: asEnumField(
    reported("recovering", "The rash is getting better now"),
  ),
  medical_attention: asEnumField(
    reported("clinic_or_doctor", "I saw my family doctor"),
  ),
});

const caregiver = simulatedOutput({
  medicines: [
    medicine({
      name: reported("metformin", "metformin 500 mg"),
      dose: reported("500 mg", "metformin 500 mg"),
      frequency: reported("twice daily", "twice daily"),
    }),
    medicine({
      name: reported("atorvastatin", "atorvastatin 10 mg"),
      dose: reported("10 mg", "atorvastatin 10 mg"),
      frequency: reported("once at night", "once at night"),
      start_date: reported("2026-08-10", "On 10 August 2026"),
    }),
  ],
  symptoms: [
    reported("muscle pain", "muscle pain in both legs"),
    reported("felt very tired", "felt very tired"),
  ],
  reaction_onset_date: ambiguous("About a week later", "Relative date."),
  outcome: asEnumField(reported("not_recovered", "still has the pain")),
  medical_attention: asEnumField(
    reported("none", "has not seen a doctor about it yet"),
  ),
});

type Probe = {
  id: string;
  mistake: string;
  text: string;
  output: unknown;
  field: (e: VerifiedExtraction) => VerifiedField;
  expectFlag: ReviewFlagCode;
};

const probes: Probe[] = [
  {
    id: "P1",
    mistake: "wrong day with the right year",
    text: caseText("clear-single-medicine"),
    output: {
      ...clear,
      reaction_onset_date: reported("2026-09-14", "On 4 September 2026"),
    },
    field: (e) => e.onsetDate,
    expectFlag: "date_mismatch",
  },
  {
    id: "P2",
    mistake: "wrong month",
    text: caseText("clear-single-medicine"),
    output: {
      ...clear,
      medicines: [
        {
          ...clear.medicines[0],
          start_date: reported("2026-02-09", "on 2 September 2026"),
        },
      ],
    },
    field: (e) => e.medicines[0].startDate,
    expectFlag: "date_mismatch",
  },
  {
    id: "P3",
    mistake: "dose taken from another medicine",
    text: caseText("caregiver-two-medicines"),
    output: {
      ...caregiver,
      medicines: [
        caregiver.medicines[0],
        {
          ...caregiver.medicines[1],
          dose: reported("500 mg", "metformin 500 mg"),
        },
      ],
    },
    field: (e) => e.medicines[1].dose,
    expectFlag: "not_linked_to_medicine",
  },
  {
    id: "P4",
    mistake: "'getting better' read as recovered",
    text: caseText("clear-single-medicine"),
    output: {
      ...clear,
      outcome: asEnumField(
        reported("recovered", "The rash is getting better now"),
      ),
    },
    field: (e) => e.outcome,
    expectFlag: "confirm_outcome",
  },
  {
    id: "P5",
    mistake: "death quoted from an injected instruction",
    text: caseText("prompt-injection"),
    output: simulatedOutput({
      outcome: asEnumField(reported("fatal", "the patient died")),
    }),
    field: (e) => e.outcome,
    expectFlag: "instruction_like_text",
  },
  {
    id: "P6",
    mistake: "admission from 'not admitted'",
    text: "Rash after amoxicillin 500 mg on 4 September 2026. He was not admitted; the doctor sent him home.",
    output: simulatedOutput({
      medical_attention: asEnumField(
        reported("hospitalised", "He was not admitted"),
      ),
    }),
    field: (e) => e.medicalAttention,
    expectFlag: "negated",
  },
  {
    id: "P7",
    mistake: "approximate time given as exact",
    text: caseText("clear-single-medicine"),
    output: { ...clear, reaction_onset_time: reported("21:00", "around 9 pm") },
    field: (e) => e.onsetTime,
    expectFlag: "approximate_time",
  },
  {
    id: "P8",
    mistake: "am/pm error",
    text: caseText("clear-single-medicine"),
    output: { ...clear, reaction_onset_time: reported("09:00", "around 9 pm") },
    field: (e) => e.onsetTime,
    expectFlag: "time_mismatch",
  },
  {
    id: "P9",
    mistake: "relative date calculated",
    text: caseText("relative-dates"),
    output: simulatedOutput({
      medicines: [
        medicine({
          name: reported("ibuprofen", "Took ibuprofen 400mg"),
          start_date: reported("2026-10-22", "yesterday evening"),
        }),
      ],
    }),
    field: (e) => e.medicines[0].startDate,
    expectFlag: "date_not_verifiable",
  },
  {
    id: "P10",
    mistake: "invented medicine",
    text: caseText("clear-single-medicine"),
    output: {
      ...clear,
      medicines: [
        ...clear.medicines,
        medicine({ name: reported("paracetamol", "paracetamol 650 mg") }),
      ],
    },
    field: (e) => e.medicines[1].name,
    expectFlag: "evidence_not_found",
  },
  {
    id: "P11",
    mistake: "vague name given as a medicine",
    text: caseText("vague-medicine-name"),
    output: simulatedOutput({
      medicines: [medicine({ name: reported("BP tablet", "a new BP tablet") })],
    }),
    field: (e) => e.medicines[0].name,
    expectFlag: "not_specific_medicine",
  },
  {
    id: "P12",
    mistake: "numeric date with day and month swapped",
    text: caseText("day-month-unclear"),
    output: simulatedOutput({
      reaction_onset_date: reported("2026-05-04", "rash appeared 05/04/2026"),
    }),
    field: (e) => e.onsetDate,
    expectFlag: "day_month_unclear",
  },
  {
    id: "P13",
    mistake: "medical term substituted for the reporter's words",
    text: caseText("clear-single-medicine"),
    output: {
      ...clear,
      symptoms: [reported("urticaria", "an itchy red rash")],
    },
    field: (e) => e.symptoms[0],
    expectFlag: "value_not_in_evidence",
  },
  {
    id: "P14",
    mistake: "reaction dated before the medicine started",
    text: caseText("conflicting-dates"),
    output: simulatedOutput({
      medicines: [
        medicine({
          name: reported("cetirizine", "Started cetirizine 10 mg"),
          start_date: reported("2026-09-15", "on 15 September 2026"),
        }),
      ],
      reaction_onset_date: reported("2026-09-12", "began on 12 September 2026"),
    }),
    field: (e) => e.onsetDate,
    expectFlag: "conflicting_dates",
  },
];

describe("safety review probes: every simulated mistake is caught", () => {
  it.each(probes)(
    "$id $mistake",
    async ({ text, output, field, expectFlag }) => {
      const result = field(await extract(text, output));
      expect(result.needsReview).toBe(true);
      expect(codes(result)).toContain(expectFlag);
    },
  );

  it("P15 rejects a response with an extra 'causality' field", async () => {
    const result = await runExtraction(
      caseText("clear-single-medicine"),
      {
        extract: async () => ({
          output: { ...clear, causality: "probable" },
          model: "simulated",
        }),
      },
      { now: NOW, logError: () => {} },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
  });

  it("P5 also requires confirmation and flags the serious event", async () => {
    const result = await extract(
      caseText("prompt-injection"),
      simulatedOutput({
        outcome: asEnumField(reported("fatal", "the patient died")),
      }),
    );
    expect(codes(result.outcome)).toEqual(
      expect.arrayContaining([
        "confirm_outcome",
        "confirm_serious_event",
        "instruction_like_text",
      ]),
    );
  });
});

describe("further safety cases", () => {
  it("flags negated symptoms", async () => {
    const result = await extract(
      "Rash after amoxicillin 500 mg. No fever, but itchy arms.",
      simulatedOutput({
        symptoms: [
          reported("fever", "No fever"),
          reported("itchy arms", "itchy arms"),
        ],
      }),
    );
    expect(codes(result.symptoms[0])).toContain("negated");
    expect(result.symptoms[1].needsReview).toBe(false);
  });

  it("flags 'saw a doctor' when the text says the doctor was not seen", async () => {
    const result = await extract(
      caseText("caregiver-two-medicines"),
      simulatedOutput({
        medical_attention: asEnumField(
          reported("clinic_or_doctor", "has not seen a doctor"),
        ),
      }),
    );
    expect(codes(result.medicalAttention)).toContain("negated");
  });

  it("flags 'died' and 'emergency' when negated", async () => {
    const text =
      "Took cetirizine 10 mg. She did not die and we did not go to emergency.";
    const result = await extract(
      text,
      simulatedOutput({
        outcome: asEnumField(reported("fatal", "She did not die")),
        medical_attention: asEnumField(
          reported("emergency_department", "did not go to emergency"),
        ),
      }),
    );
    expect(codes(result.outcome)).toContain("negated");
    expect(codes(result.medicalAttention)).toContain("negated");
  });

  it("requires confirmation of every death, admission or emergency visit", async () => {
    const text =
      "Took carbamazepine 200 mg. She was taken to casualty and later admitted to the ward.";
    for (const [value, quote] of [
      ["emergency_department", "She was taken to casualty"],
      ["hospitalised", "later admitted to the ward"],
    ] as const) {
      const result = await extract(
        text,
        simulatedOutput({
          medical_attention: asEnumField(reported(value, quote)),
        }),
      );
      expect(result.medicalAttention.needsReview).toBe(true);
      expect(codes(result.medicalAttention)).toEqual(["confirm_serious_event"]);
    }
  });

  it("flags a time without am/pm and a time the quote does not state", async () => {
    const base = {
      ...clear,
      reaction_onset_date: reported("2026-09-04", "On 4 September 2026"),
    };
    const unclear = await extract(
      "Rash from amoxicillin started on 4 September 2026 at 9:30.",
      { ...base, reaction_onset_time: reported("21:30", "at 9:30") },
    );
    expect(codes(unclear.onsetTime)).toContain("time_meridiem_unclear");
    const unstated = await extract(caseText("clear-single-medicine"), {
      ...base,
      reaction_onset_time: reported("21:00", "I noticed an itchy red rash"),
    });
    expect(codes(unstated.onsetTime)).toContain("time_not_verifiable");
  });

  it("flags a start date taken from another medicine's sentence", async () => {
    const result = await extract(caseText("caregiver-two-medicines"), {
      ...caregiver,
      medicines: [
        {
          ...caregiver.medicines[0],
          start_date: reported("2026-08-10", "On 10 August 2026"),
        },
        caregiver.medicines[1],
      ],
    });
    expect(codes(result.medicines[0].startDate)).toContain(
      "not_linked_to_medicine",
    );
  });

  it("flags any field quoted from instruction-like text", async () => {
    const result = await extract(
      caseText("prompt-injection"),
      simulatedOutput({
        symptoms: [
          reported("severe reaction", "the medicine caused a severe reaction"),
        ],
      }),
    );
    expect(codes(result.symptoms[0])).toContain("instruction_like_text");
  });
});

describe("no new false alarms on correct extractions", () => {
  it("accepts correct dates, times and details in several formats", async () => {
    const text =
      "Started amoxicillin 500 mg capsules twice a day on September 2, 2026. The rash began 14/09/2026 at 21:15.";
    const result = await extract(
      text,
      simulatedOutput({
        medicines: [
          medicine({
            name: reported(
              "amoxicillin",
              "Started amoxicillin 500 mg capsules",
            ),
            dose: reported("500 mg", "amoxicillin 500 mg"),
            route: asEnumField(reported("oral", "capsules")),
            frequency: reported("twice a day", "twice a day"),
            start_date: reported("2026-09-02", "on September 2, 2026"),
          }),
        ],
        reaction_onset_date: reported("2026-09-14", "began 14/09/2026"),
        reaction_onset_time: reported("21:15", "at 21:15"),
      }),
    );
    const [med] = result.medicines;
    for (const field of [
      med.name,
      med.dose,
      med.route,
      med.frequency,
      med.startDate,
      result.onsetDate,
      result.onsetTime,
    ]) {
      expect(field.flags).toEqual([]);
    }
  });

  it("keeps zero silent errors and full expected-field scores on faithful synthetic extractions", async () => {
    const testCase = syntheticExtractionCases.find(
      (c) => c.id === "caregiver-two-medicines",
    )!;
    const extraction = await runExtraction(
      testCase.description,
      { extract: async () => ({ output: caregiver, model: "simulated" }) },
      { now: NOW },
    );
    const score = scoreCase(testCase, extraction);
    expect(score.silentErrors).toEqual([]);
    expect(score.checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("does not flag the supported details of the caregiver case", async () => {
    const result = await extract(
      caseText("caregiver-two-medicines"),
      caregiver,
    );
    for (const med of result.medicines) {
      for (const field of [med.name, med.dose, med.frequency, med.startDate]) {
        expect(field.flags).toEqual([]);
      }
    }
    expect(result.medicalAttention.needsReview).toBe(false);
  });
});

describe("verification review findings (production verifier)", () => {
  it("flags an onset quote that states two different dates", async () => {
    const text =
      "I started cetirizine 10 mg on 2 September 2026. The rash began on 4 September 2026 or perhaps 5 September 2026.";
    const result = await extract(
      text,
      simulatedOutput({
        reaction_onset_date: reported(
          "2026-09-05",
          "The rash began on 4 September 2026 or perhaps 5 September 2026",
        ),
      }),
    );
    expect(result.onsetDate.needsReview).toBe(true);
    expect(codes(result.onsetDate)).toEqual(
      expect.arrayContaining(["multiple_dates_in_quote", "imprecise_date"]),
    );
  });

  it("flags a date given as a range or a bound", async () => {
    const text =
      "Took cetirizine 10 mg. The drowsiness started between 2 and 4 September 2026.";
    const result = await extract(
      text,
      simulatedOutput({
        reaction_onset_date: reported(
          "2026-09-04",
          "between 2 and 4 September 2026",
        ),
      }),
    );
    expect(codes(result.onsetDate)).toContain("imprecise_date");
  });

  it.each(["after 9 pm", "before 9 pm", "by 9 pm", "9 or 10 pm"])(
    "flags the bounded or alternative time %j",
    async (quote) => {
      const text = `Took cetirizine 10 mg on 4 September 2026. The rash began ${quote}.`;
      const value = quote === "9 or 10 pm" ? "22:00" : "21:00";
      const result = await extract(
        text,
        simulatedOutput({
          reaction_onset_date: reported("2026-09-04", "on 4 September 2026"),
          reaction_onset_time: reported(value, quote),
        }),
      );
      expect(codes(result.onsetTime)).toContain("approximate_time");
    },
  );

  it("recognises 'admission' as stated admission (no false 'not stated' flag)", async () => {
    const text =
      "Took carbamazepine 200 mg. There was a hospital admission for two days.";
    const result = await extract(
      text,
      simulatedOutput({
        medical_attention: asEnumField(
          reported("hospitalised", "a hospital admission for two days"),
        ),
      }),
    );
    expect(codes(result.medicalAttention)).toEqual(["confirm_serious_event"]);
  });

  it("does not attribute a shared-sentence dose to either medicine", async () => {
    const text = "He takes metformin and atorvastatin 10 mg daily.";
    const result = await extract(
      text,
      simulatedOutput({
        medicines: [
          medicine({
            name: reported("metformin", "metformin"),
            dose: reported("10 mg", "10 mg"),
          }),
          medicine({
            name: reported("atorvastatin", "atorvastatin 10 mg"),
            dose: reported("10 mg", "atorvastatin 10 mg"),
          }),
        ],
      }),
    );
    expect(codes(result.medicines[0].dose)).toContain("not_linked_to_medicine");
    expect(result.medicines[1].dose.flags).toEqual([]);
  });

  it("does not let a combination product's dose count for the single ingredient", async () => {
    const text = "Took amoxicillin-clavulanate 625 mg and amoxicillin 250 mg.";
    const result = await extract(
      text,
      simulatedOutput({
        medicines: [
          medicine({
            name: reported(
              "amoxicillin-clavulanate",
              "amoxicillin-clavulanate 625 mg",
            ),
            dose: reported("625 mg", "amoxicillin-clavulanate 625 mg"),
          }),
          medicine({
            name: reported("amoxicillin", "amoxicillin 250 mg"),
            dose: reported("625 mg", "amoxicillin-clavulanate 625 mg"),
          }),
        ],
      }),
    );
    expect(result.medicines[0].dose.flags).toEqual([]);
    expect(codes(result.medicines[1].dose)).toContain("not_linked_to_medicine");
  });

  it("warns when the description states dates that no suggestion uses", async () => {
    const text =
      "I started amoxicillin 500 mg on 2 September 2026 and got a rash on 4 September 2026.";
    const result = await extract(text, simulatedOutput());
    expect(result.warnings).toEqual([
      "Your description mentions 2 dates that no suggestion uses. Check the date fields yourself.",
    ]);
  });

  it("does not warn when every stated date is used", async () => {
    const result = await extract(caseText("clear-single-medicine"), clear);
    expect(result.warnings).toEqual([]);
  });
});
