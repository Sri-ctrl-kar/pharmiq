import type { WireExtraction, WireField } from "@/lib/ai/extraction-schema";

/**
 * Builders for SIMULATED model outputs. These are hand-written stand-ins for Claude's
 * response, used to test the deterministic guardrails. They are not real model results.
 */

export const missing = (): WireField => ({
  status: "missing",
  value: null,
  evidence: null,
  note: null,
});

export const reported = (value: string, evidence: string): WireField => ({
  status: "reported",
  value,
  evidence,
  note: null,
});

export const ambiguous = (
  evidence: string,
  note: string,
  value: string | null = null,
): WireField => ({ status: "ambiguous", value, evidence, note });

type WireMedicine = WireExtraction["medicines"][number];

export function medicine(
  overrides: Partial<WireMedicine> & { name: WireField },
): WireMedicine {
  return {
    dose: missing(),
    route: missing() as WireMedicine["route"],
    frequency: missing(),
    start_date: missing(),
    end_date: missing(),
    course_status: missing() as WireMedicine["course_status"],
    previous_dose: missing(),
    previous_frequency: missing(),
    change_date: missing(),
    reporter_role: "unclear",
    reporter_role_evidence: null,
    ...overrides,
  };
}

export function simulatedOutput(
  overrides: Partial<WireExtraction> = {},
): WireExtraction {
  return {
    medicines: [],
    symptoms: [],
    reaction_onset_date: missing(),
    reaction_onset_time: missing(),
    outcome: missing() as WireExtraction["outcome"],
    medical_attention: missing() as WireExtraction["medical_attention"],
    ...overrides,
  };
}

/** Narrow WireField to an enum-valued field without fighting the type system in tests. */
export const asEnumField = <T>(field: WireField) => field as unknown as T;
