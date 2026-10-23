import type {
  ExtractionResponse,
  VerifiedField,
  VerifiedMedicine,
} from "@/lib/ai/extraction-schema";
import type {
  ExpectedField,
  SyntheticExtractionCase,
} from "@/lib/ai/synthetic-examples";

/**
 * Scores one extraction against a synthetic case's hand-written expectations.
 *
 * Two kinds of result:
 * - checks: did each expected field come back with an acceptable status and value?
 * - silentErrors: values that would be PRE-SELECTED in the UI (no review flag) but are
 *   wrong or unexpected. This is the safety metric: the target is zero.
 *
 * A behaviour check on a tiny synthetic set — not a clinical accuracy measure.
 */

export type Check = { path: string; pass: boolean; detail: string };
export type CaseScore = {
  caseId: string;
  checks: Check[];
  passed: number;
  total: number;
  silentErrors: string[];
};

const compact = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function checkField(
  path: string,
  actual: VerifiedField | undefined,
  expected: ExpectedField,
  checks: Check[],
  silentErrors: string[],
) {
  const allowed = Array.isArray(expected.status)
    ? expected.status
    : [expected.status];
  if (!actual) {
    checks.push({ path, pass: false, detail: "not returned" });
    return;
  }
  const statusOk = allowed.includes(actual.status);
  const valueOk =
    expected.value === undefined ||
    actual.status !== "reported" ||
    (actual.value !== null &&
      compact(actual.value) === compact(expected.value));
  checks.push({
    path,
    pass: statusOk && valueOk,
    detail: `expected ${allowed.join("|")}${expected.value ? ` "${expected.value}"` : ""}; got ${actual.status}${actual.value ? ` "${actual.value}"` : ""}`,
  });
  const preselected = actual.status === "reported" && !actual.needsReview;
  if (preselected && (!valueOk || !allowed.includes("reported"))) {
    silentErrors.push(`${path}: "${actual.value}" would be pre-selected`);
  }
}

export function scoreCase(
  testCase: SyntheticExtractionCase,
  response: ExtractionResponse,
): CaseScore {
  const checks: Check[] = [];
  const silentErrors: string[] = [];
  const done = () => ({
    caseId: testCase.id,
    checks,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    silentErrors,
  });

  if (!response.ok) {
    checks.push({
      path: "response",
      pass: false,
      detail: `error ${response.error.code}`,
    });
    return done();
  }
  const { extraction } = response;
  const { expected } = testCase;

  const matched = new Set<VerifiedMedicine>();
  expected.medicines.forEach((medicine, index) => {
    const found = extraction.medicines.find((candidate) => {
      const name = compact(candidate.name.value ?? "");
      return (
        name.includes(compact(medicine.name)) ||
        compact(medicine.name).includes(name)
      );
    });
    const path = `medicines[${index}] ${medicine.name}`;
    checks.push({
      path: `${path} found`,
      pass: Boolean(found),
      detail: found ? `as "${found.name.value}"` : "missing",
    });
    if (!found) return;
    matched.add(found);
    if (medicine.nameNeedsReview) {
      checks.push({
        path: `${path} flagged for review`,
        pass: found.name.needsReview,
        detail: String(found.name.needsReview),
      });
    }
    for (const key of [
      "dose",
      "route",
      "frequency",
      "startDate",
      "endDate",
      "courseStatus",
      "previousDose",
      "changeDate",
    ] as const) {
      if (medicine[key])
        checkField(
          `${path}.${key}`,
          found[key],
          medicine[key],
          checks,
          silentErrors,
        );
    }
  });
  for (const extra of extraction.medicines.filter((m) => !matched.has(m))) {
    if (!extra.name.needsReview)
      silentErrors.push(
        `unexpected medicine "${extra.name.value}" would be offered without a flag`,
      );
  }

  for (const symptom of expected.symptoms) {
    const found = extraction.symptoms.some((s) =>
      compact(s.value ?? "").includes(compact(symptom)),
    );
    checks.push({
      path: `symptom "${symptom}"`,
      pass: found,
      detail: found ? "found" : "missing",
    });
  }

  checkField(
    "onsetDate",
    extraction.onsetDate,
    expected.onsetDate,
    checks,
    silentErrors,
  );
  if (expected.onsetTime)
    checkField(
      "onsetTime",
      extraction.onsetTime,
      expected.onsetTime,
      checks,
      silentErrors,
    );
  checkField(
    "outcome",
    extraction.outcome,
    expected.outcome,
    checks,
    silentErrors,
  );
  checkField(
    "medicalAttention",
    extraction.medicalAttention,
    expected.medicalAttention,
    checks,
    silentErrors,
  );

  const raised = new Set(
    [
      ...extraction.medicines.flatMap((m) => [
        m.name,
        m.dose,
        m.route,
        m.frequency,
        m.startDate,
        m.endDate,
        m.courseStatus,
        m.previousDose,
        m.previousFrequency,
        m.changeDate,
      ]),
      ...extraction.symptoms,
      extraction.onsetDate,
      extraction.onsetTime,
      extraction.outcome,
      extraction.medicalAttention,
    ].flatMap((field) => field.flags.map((flag) => flag.code)),
  );
  for (const flag of expected.flags ?? []) {
    checks.push({
      path: `flag ${flag}`,
      pass: raised.has(flag),
      detail: raised.has(flag) ? "raised" : "not raised",
    });
  }
  for (const redaction of expected.redactions ?? []) {
    const count =
      response.redactions.find((r) => r.kind === redaction.kind)?.count ?? 0;
    checks.push({
      path: `redacted ${redaction.kind}`,
      pass: count >= redaction.count,
      detail: `${count}`,
    });
  }
  return done();
}
