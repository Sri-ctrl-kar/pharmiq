import {
  wireExtractionSchema,
  type ReviewFlag,
  type ReviewFlagCode,
  type VerifiedExtraction,
  type VerifiedField,
  type VerifiedMedicine,
  type WireField,
} from "@/lib/ai/extraction-schema";
import { MAX_SUSPECTED_MEDICINES, MAX_SYMPTOMS } from "@/lib/reports/constants";
import { isNotFutureDate, isRealCalendarDate } from "@/lib/reports/schema";

/**
 * Deterministic checks applied to every model response before anything reaches the
 * reporter. The model is never trusted:
 *
 * - The response must match the strict wire schema exactly (unknown keys reject it).
 * - Every quoted `evidence` must appear verbatim in the text the model was given.
 * - Values must appear in their quote (names, doses, frequencies, symptoms), be valid
 *   and not in the future (dates), and severe categories need explicit wording.
 * - Vague medicine names, duplicates and conflicting dates are flagged.
 * - Model notes that read like advice, diagnosis, causality or severity are replaced.
 *
 * Flagged or ambiguous values are returned with `needsReview: true`; the UI never
 * pre-selects them.
 */

const MAX_NOTE_LENGTH = 200;
const SAFE_NOTE = "Check this against the description.";

const UNSAFE_NOTE =
  /\b(stop|discontinu|switch|reduc|increas|avoid|continu|restart|chang)\w*\s+(taking|using|the|your|this|that|it|medic\w*|dose\w*|tablet\w*|drug\w*)\b|\bcaus(e|ed|es|ing|al|ality)\b|\bdiagnos|\ballerg(y|ic)\s+to\b|\byou should\b|\brecommend|\bside[- ]effects?\s+of\b|\breaction\s+(to|from)\b|\bsevere\b|\bserious\b|\blife[- ]threatening\b|\bdue to\b/i;

const SEVERITY_EVIDENCE: Record<string, RegExp> = {
  fatal: /\b(died|death|dead|passed away|expired|fatal)\b/i,
  hospitalised:
    /\b(admit\w*|hospitali[sz]\w*|in\s?patient|ward|icu|intensive care)\b/i,
  emergency_department:
    /\b(emergency|casualty|a\s?&\s?e|er\b|accident and emergency)\b/i,
};

const GENERIC_MEDICINE_WORDS = new Set(
  (
    "the my a an some his her their new old white blue red yellow pink green small big " +
    "tablet tablets pill pills medicine medicines medication medications capsule capsules " +
    "syrup injection injections drops cream ointment antibiotic antibiotics painkiller " +
    "painkillers bp blood pressure sugar diabetes thyroid dawa dawai goli course drug drugs " +
    "vaccine vaccines vaccination flu shot jab"
  ).split(" "),
);

const normalise = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const compact = (text: string) =>
  normalise(text).replace(/[^\p{L}\p{N}]/gu, "");

const clean = (text: string | null) => {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
};

type FieldKind = "text" | "date" | "time" | "enum";
type AnyWireField = Omit<WireField, "value"> & { value: string | null };

export type VerifyResult =
  | { ok: true; extraction: VerifiedExtraction }
  | { ok: false; reason: "schema" };

export function verifyExtraction(
  raw: unknown,
  sourceText: string,
  now: Date = new Date(),
): VerifyResult {
  const parsed = wireExtractionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema" };
  const wire = parsed.data;

  const source = normalise(sourceText);
  const inSource = (quote: string) => {
    const needle = normalise(quote);
    return needle.length > 0 && source.includes(needle);
  };
  const warnings: string[] = [];

  function verifyField(field: AnyWireField, kind: FieldKind): VerifiedField {
    const flags: ReviewFlag[] = [];
    const flag = (code: ReviewFlagCode, message: string) => {
      if (!flags.some((existing) => existing.code === code))
        flags.push({ code, message });
    };

    let status = field.status;
    const value = clean(field.value);
    const evidence = clean(field.evidence);
    const rawNote = clean(field.note);
    const note = rawNote
      ? UNSAFE_NOTE.test(rawNote)
        ? SAFE_NOTE
        : rawNote.slice(0, MAX_NOTE_LENGTH)
      : null;

    if (status === "missing") {
      if (value === null && evidence === null) {
        return {
          status,
          value: null,
          evidence: null,
          note: null,
          flags,
          needsReview: false,
        };
      }
      status = "ambiguous";
      flag(
        "inconsistent_status",
        "Marked as not mentioned, but a value was given.",
      );
    }
    if (status === "reported" && value === null) {
      if (evidence === null) {
        return {
          status: "missing",
          value: null,
          evidence: null,
          note: null,
          flags,
          needsReview: false,
        };
      }
      status = "ambiguous";
    }

    if (evidence === null) {
      if (value !== null) {
        flag("evidence_not_found", "No supporting quote from the description.");
      }
    } else if (!inSource(evidence)) {
      flag(
        "evidence_not_found",
        "The quoted text does not appear in the description.",
      );
    }

    if (value !== null) {
      switch (kind) {
        case "text":
          if (
            evidence !== null &&
            !compact(evidence).includes(compact(value))
          ) {
            flag(
              "value_not_in_evidence",
              "This value does not appear in the quoted text.",
            );
          }
          break;
        case "date":
          if (!isRealCalendarDate(value)) {
            flag("invalid_date", "Not a valid calendar date.");
          } else {
            if (!isNotFutureDate(value, now)) {
              flag("future_date", "This date is in the future.");
            }
            if (evidence !== null && !evidence.includes(value.slice(0, 4))) {
              flag(
                "year_not_stated",
                "The year is not stated in the quoted text.",
              );
            }
            const numeric = evidence?.match(
              /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/,
            );
            if (numeric) {
              const [first, second] = [Number(numeric[1]), Number(numeric[2])];
              if (first <= 12 && second <= 12 && first !== second) {
                flag(
                  "day_month_unclear",
                  "Day and month order is unclear in this date.",
                );
              }
            }
          }
          break;
        case "time":
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
            flag("invalid_time", "Not a valid time (HH:MM).");
          }
          break;
        case "enum": {
          const required = SEVERITY_EVIDENCE[value];
          if (required && !(evidence !== null && required.test(evidence))) {
            flag(
              "unsupported_severity",
              "The description does not explicitly state this.",
            );
          }
          break;
        }
      }
    }

    return {
      status,
      value,
      evidence,
      note,
      flags,
      needsReview: status === "ambiguous" || flags.length > 0,
    };
  }

  const addFlag = (
    field: VerifiedField,
    code: ReviewFlagCode,
    message: string,
  ) => {
    if (!field.flags.some((existing) => existing.code === code)) {
      field.flags.push({ code, message });
    }
    field.needsReview = true;
  };

  // Medicines ---------------------------------------------------------------
  let medicines: VerifiedMedicine[] = wire.medicines
    .map((medicine) => {
      const name = verifyField(medicine.name, "text");
      const roleEvidence = clean(medicine.reporter_role_evidence);
      const roleSupported = roleEvidence !== null && inSource(roleEvidence);
      return {
        name,
        dose: verifyField(medicine.dose, "text"),
        route: verifyField(medicine.route, "enum"),
        frequency: verifyField(medicine.frequency, "text"),
        startDate: verifyField(medicine.start_date, "date"),
        reporterRole:
          medicine.reporter_role === "unclear" || roleSupported
            ? medicine.reporter_role
            : "unclear",
        reporterRoleEvidence: roleSupported ? roleEvidence : null,
      } satisfies VerifiedMedicine;
    })
    .filter((medicine) => medicine.name.value !== null);

  if (medicines.length < wire.medicines.length) {
    warnings.push("A medicine without a name was ignored.");
  }
  if (medicines.length > MAX_SUSPECTED_MEDICINES) {
    warnings.push(
      `More than ${MAX_SUSPECTED_MEDICINES} medicines were mentioned; only the first ${MAX_SUSPECTED_MEDICINES} are shown. Add others under “Other information”.`,
    );
    medicines = medicines.slice(0, MAX_SUSPECTED_MEDICINES);
  }

  const seenNames = new Set<string>();
  for (const medicine of medicines) {
    const name = medicine.name.value!;
    const words = normalise(name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (
      compact(name).length < 3 ||
      words.every((word) => GENERIC_MEDICINE_WORDS.has(word))
    ) {
      addFlag(
        medicine.name,
        "not_specific_medicine",
        "This is not a specific medicine name. Check the pack or prescription.",
      );
    }
    const key = compact(name);
    if (seenNames.has(key)) {
      addFlag(
        medicine.name,
        "duplicate_medicine",
        "This medicine is listed more than once.",
      );
    }
    seenNames.add(key);
  }

  // Symptoms ----------------------------------------------------------------
  let symptoms = wire.symptoms
    .map((symptom) => verifyField(symptom, "text"))
    .filter((symptom) => symptom.value !== null);
  if (symptoms.length > MAX_SYMPTOMS) {
    warnings.push(`Only the first ${MAX_SYMPTOMS} symptoms are shown.`);
    symptoms = symptoms.slice(0, MAX_SYMPTOMS);
  }

  // Reaction ----------------------------------------------------------------
  const onsetDate = verifyField(wire.reaction_onset_date, "date");
  const onsetTime = verifyField(wire.reaction_onset_time, "time");
  const outcome = verifyField(wire.outcome, "enum");
  const medicalAttention = verifyField(wire.medical_attention, "enum");

  if (
    onsetTime.value !== null &&
    (onsetDate.value === null || onsetDate.needsReview)
  ) {
    addFlag(
      onsetTime,
      "time_without_date",
      "A time was found but the date is missing or unclear.",
    );
  }

  const validDate = (field: VerifiedField) =>
    field.value !== null && isRealCalendarDate(field.value)
      ? field.value
      : null;
  const onset = validDate(onsetDate);
  if (onset) {
    for (const medicine of medicines) {
      const started = validDate(medicine.startDate);
      if (started && onset < started) {
        const message =
          "The reaction start date is before this medicine's start date.";
        addFlag(onsetDate, "conflicting_dates", message);
        addFlag(medicine.startDate, "conflicting_dates", message);
      }
    }
  }

  return {
    ok: true,
    extraction: {
      medicines,
      symptoms,
      onsetDate,
      onsetTime,
      outcome,
      medicalAttention,
      warnings,
    },
  };
}
