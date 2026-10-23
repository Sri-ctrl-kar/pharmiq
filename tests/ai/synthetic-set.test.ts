import { describe, expect, it } from "vitest";
import { syntheticExtractionCases } from "@/lib/ai/synthetic-examples";
import { isRealCalendarDate } from "@/lib/reports/schema";
import { runExtraction } from "@/server/ai/extraction-service";
import { scoreCase } from "../../evals/extraction/score";
import {
  ambiguous,
  asEnumField,
  medicine,
  missing,
  reported,
  simulatedOutput,
} from "./helpers";

const NOW = new Date("2026-10-23T06:00:00Z");

describe("synthetic test set", () => {
  it("has unique ids and descriptions the endpoint accepts", () => {
    const ids = syntheticExtractionCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(syntheticExtractionCases.length).toBeGreaterThanOrEqual(10);
    for (const c of syntheticExtractionCases) {
      expect(c.description.length).toBeGreaterThanOrEqual(10);
      expect(c.description.length).toBeLessThanOrEqual(4000);
    }
  });

  it("has an answer key grounded in each description (no invented expectations)", () => {
    for (const c of syntheticExtractionCases) {
      const text = c.description.toLowerCase();
      for (const m of c.expected.medicines)
        expect(text).toContain(m.name.toLowerCase());
      const dates = [
        c.expected.onsetDate,
        ...c.expected.medicines.map((m) => m.startDate),
      ].filter((f) => f?.value);
      for (const date of dates) {
        expect(isRealCalendarDate(date!.value!)).toBe(true);
        expect(c.description).toContain(date!.value!.slice(0, 4));
      }
    }
  });
});

describe("scoreCase", () => {
  const testCase = syntheticExtractionCases.find(
    (c) => c.id === "clear-single-medicine",
  )!;

  /** SIMULATED faithful model output for the clear case (not a real model result). */
  const faithful = simulatedOutput({
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
    reaction_onset_time: ambiguous("around 9 pm", "Approximate."),
    outcome: asEnumField(
      reported("recovering", "The rash is getting better now"),
    ),
    medical_attention: asEnumField(
      reported("clinic_or_doctor", "I saw my family doctor"),
    ),
  });

  const run = (output: unknown) =>
    runExtraction(
      testCase.description,
      { extract: async () => ({ output, model: "simulated" }) },
      { now: NOW },
    );

  it("passes every check with zero silent errors for a faithful extraction", async () => {
    const score = scoreCase(testCase, await run(faithful));
    expect(score.silentErrors).toEqual([]);
    expect(score.passed).toBe(score.total);
  });

  it("counts a wrong value that would be pre-selected as a silent error", async () => {
    // Route mapping is one of the remaining interpretations the verifier cannot check.
    const wrong = {
      ...faithful,
      medicines: [
        {
          ...faithful.medicines[0],
          route: asEnumField(reported("topical", "capsules")),
        },
      ],
    };
    const score = scoreCase(testCase, await run(wrong));
    expect(score.silentErrors).toEqual([
      'medicines[0] amoxicillin.route: "topical" would be pre-selected',
    ]);
    expect(score.passed).toBe(score.total - 1);
  });

  it("does not count flagged (non-pre-selected) mistakes as silent errors", async () => {
    const fabricated = {
      ...faithful,
      outcome: asEnumField(reported("fatal", "The rash is getting better now")),
    };
    const score = scoreCase(testCase, await run(fabricated));
    expect(score.silentErrors).toEqual([]);
    expect(score.passed).toBe(score.total - 1);
  });

  it("scores an error response as a failure", async () => {
    const score = scoreCase(testCase, await run("not json at all"));
    expect(score).toMatchObject({ passed: 0, total: 1 });
  });

  it("flags unexpected medicines offered without review", async () => {
    const extra = {
      ...faithful,
      medicines: [
        ...faithful.medicines,
        medicine({ name: reported("rash", "red rash") }),
      ],
      reaction_onset_date: missing(),
    };
    const score = scoreCase(testCase, await run(extra));
    expect(score.silentErrors).toContain(
      'unexpected medicine "rash" would be offered without a flag',
    );
  });
});
