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
import {
  checkDateAgainstQuote,
  checkTimeAgainstQuote,
  compactText as compact,
  isImprecise,
  isInInstructionLikeText,
  isLinkedToMedicine,
  isNegated,
  normaliseText as normalise,
  statedDateMentions,
  toIsoDate,
} from "./evidence-checks";

/**
 * Deterministic checks applied to every model response before anything reaches the
 * reporter. The model is never trusted:
 *
 * - The response must match the strict wire schema exactly (unknown keys reject it).
 * - Every quoted `evidence` must appear verbatim in the text the model was given, and
 *   must not come from text that reads like an instruction to the AI.
 * - Names, doses, frequencies and symptoms must appear in their quote; negated
 *   symptoms ("no fever") are flagged.
 * - Dates must be real, not in the future, and the quote must state that exact day,
 *   month and year. Times must match a clock time in the quote; approximate or
 *   am/pm-unclear times are flagged.
 * - Dose, route, frequency and start date must be linked to their own medicine (the
 *   quote names it, or sits in a sentence that names it, and names no other medicine).
 * - Death, hospital admission and emergency visits always need the reporter's own
 *   confirmation, need explicit wording, and are flagged when negated.
 * - Outcome is an interpretation of the reporter's words and always needs confirmation.
 * - Vague medicine names, duplicates and conflicting dates are flagged.
 * - Model notes that read like advice, diagnosis, causality or severity are replaced.
 *
 * Flagged or ambiguous values are returned with `needsReview: true`; the UI never
 * pre-selects them. These are heuristics over English text: see docs/AI_EXTRACTION.md
 * for what they cannot catch.
 */

const MAX_NOTE_LENGTH = 200;
const SAFE_NOTE = "Check this against the description.";

const UNSAFE_NOTE =
  /\b(stop|discontinu|switch|reduc|increas|avoid|continu|restart|chang)\w*\s+(taking|using|the|your|this|that|it|medic\w*|dose\w*|tablet\w*|drug\w*)\b|\bcaus(e|ed|es|ing|al|ality)\b|\bdiagnos|\ballerg(y|ic)\s+to\b|\byou should\b|\brecommend|\bside[- ]effects?\s+of\b|\breaction\s+(to|from)\b|\bsevere\b|\bserious\b|\blife[- ]threatening\b|\bdue to\b/i;

/** Serious events: never pre-selected, need explicit wording, checked for negation. */
const SERIOUS_EVENT_WORDS: Record<string, RegExp> = {
  fatal: /\b(die|died|dies|dying|death|dead|passed away|expired|fatal)\b/i,
  hospitalised:
    /\b(admit\w*|admission\w*|hospitali[sz]\w*|in\s?patient|ward|icu|intensive care)\b/i,
  emergency_department:
    /\b(emergency|casualty|a\s?&\s?e|er\b|accident and emergency)\b/i,
};

/** Non-serious categories whose wording can still be negated ("has not seen a doctor"). */
const NEGATABLE_WORDS: Record<string, RegExp> = {
  clinic_or_doctor: /\b(doctor|clinic|gp|physician|dr|consult\w*|opd)\b/i,
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const GENERIC_MEDICINE_WORDS = new Set(
  (
    "the my a an some his her their new old white blue red yellow pink green small big " +
    "tablet tablets pill pills medicine medicines medication medications capsule capsules " +
    "syrup injection injections drops cream ointment antibiotic antibiotics painkiller " +
    "painkillers bp blood pressure sugar diabetes thyroid dawa dawai goli course drug drugs " +
    "vaccine vaccines vaccination flu shot jab"
  ).split(" "),
);

const clean = (text: string | null) => {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
};

type FieldKind =
  "text" | "symptom" | "date" | "time" | "route" | "outcome" | "attention";
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
    } else if (isInInstructionLikeText(sourceText, evidence)) {
      flag(
        "instruction_like_text",
        "This comes from text that reads like an instruction to the AI, not part of the report.",
      );
    }

    const checkSeriousEvent = (words: RegExp) => {
      flag(
        "confirm_serious_event",
        "Serious event: confirm this yourself before adding it.",
      );
      if (evidence === null || !words.test(evidence)) {
        flag(
          "unsupported_severity",
          "The description does not explicitly state this.",
        );
      } else if (isNegated(sourceText, evidence, words)) {
        flag("negated", "Your text says this did not happen.");
      }
    };

    if (value !== null) {
      switch (kind) {
        case "text":
        case "symptom":
          if (
            evidence !== null &&
            !compact(evidence).includes(compact(value))
          ) {
            flag(
              "value_not_in_evidence",
              "This value does not appear in the quoted text.",
            );
          }
          if (
            kind === "symptom" &&
            evidence !== null &&
            isNegated(
              sourceText,
              evidence,
              new RegExp(escapeRegExp(normalise(value))),
            )
          ) {
            flag("negated", "Your text says this did not happen.");
          }
          break;
        case "date": {
          if (!isRealCalendarDate(value)) {
            flag("invalid_date", "Not a valid calendar date.");
            break;
          }
          if (!isNotFutureDate(value, now)) {
            flag("future_date", "This date is in the future.");
          }
          if (evidence === null) break;
          const check = checkDateAgainstQuote(value, evidence);
          if (check === "not_stated") {
            flag(
              "date_not_verifiable",
              "The quoted text does not state this calendar date.",
            );
          } else if (check === "matches_without_year") {
            flag(
              "year_not_stated",
              "The year is not stated in the quoted text.",
            );
          } else if (check === "mismatch") {
            flag(
              "date_mismatch",
              "This date does not match the date in the quoted text.",
            );
          } else if (check === "multiple_dates") {
            flag(
              "multiple_dates_in_quote",
              "The quoted text gives more than one date.",
            );
          }
          if (isImprecise(evidence)) {
            flag(
              "imprecise_date",
              "The text gives an approximate date, a range or a before/after date.",
            );
          }
          const numeric = evidence.match(
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
          break;
        }
        case "time": {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
            flag("invalid_time", "Not a valid time (HH:MM).");
            break;
          }
          if (evidence === null) break;
          const check = checkTimeAgainstQuote(value, evidence);
          if (check === "not_stated") {
            flag(
              "time_not_verifiable",
              "The quoted text does not state this clock time.",
            );
          } else if (check === "mismatch") {
            flag(
              "time_mismatch",
              "This time does not match the time in the quoted text.",
            );
          } else if (check === "meridiem_unclear") {
            flag(
              "time_meridiem_unclear",
              "The text does not say whether this is morning or evening.",
            );
          }
          if (isImprecise(evidence)) {
            flag(
              "approximate_time",
              "The text gives an approximate time, a range or a before/after time.",
            );
          }
          break;
        }
        case "outcome":
          flag(
            "confirm_outcome",
            "Outcome is an interpretation of your words: confirm it yourself.",
          );
          if (SERIOUS_EVENT_WORDS[value]) {
            checkSeriousEvent(SERIOUS_EVENT_WORDS[value]);
          }
          break;
        case "attention":
          if (SERIOUS_EVENT_WORDS[value]) {
            checkSeriousEvent(SERIOUS_EVENT_WORDS[value]);
          } else if (
            NEGATABLE_WORDS[value] &&
            evidence !== null &&
            isNegated(sourceText, evidence, NEGATABLE_WORDS[value])
          ) {
            flag("negated", "Your text says this did not happen.");
          }
          break;
        case "route":
          break;
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
        route: verifyField(medicine.route, "route"),
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

  // Each detail must belong to its own medicine, not another one in the text.
  const allNames = medicines.map((medicine) => medicine.name.value!);
  for (const medicine of medicines) {
    const name = medicine.name.value!;
    const others = allNames.filter((other) => compact(other) !== compact(name));
    for (const detail of [
      medicine.dose,
      medicine.route,
      medicine.frequency,
      medicine.startDate,
    ]) {
      if (
        detail.value !== null &&
        detail.evidence !== null &&
        !detail.flags.some((f) => f.code === "evidence_not_found") &&
        !isLinkedToMedicine(sourceText, detail.evidence, name, others)
      ) {
        addFlag(
          detail,
          "not_linked_to_medicine",
          "This detail is not clearly linked to this medicine in your text.",
        );
      }
    }
  }

  // Symptoms ----------------------------------------------------------------
  let symptoms = wire.symptoms
    .map((symptom) => verifyField(symptom, "symptom"))
    .filter((symptom) => symptom.value !== null);
  if (symptoms.length > MAX_SYMPTOMS) {
    warnings.push(`Only the first ${MAX_SYMPTOMS} symptoms are shown.`);
    symptoms = symptoms.slice(0, MAX_SYMPTOMS);
  }

  // Reaction ----------------------------------------------------------------
  const onsetDate = verifyField(wire.reaction_onset_date, "date");
  const onsetTime = verifyField(wire.reaction_onset_time, "time");
  const outcome = verifyField(wire.outcome, "outcome");
  const medicalAttention = verifyField(wire.medical_attention, "attention");

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

  // Omission check: dates the reporter wrote that no suggestion uses.
  const usedDates = new Set(
    [onsetDate, ...medicines.map((medicine) => medicine.startDate)]
      .map((field) => field.value)
      .filter((value): value is string => value !== null),
  );
  const unusedDates = statedDateMentions(sourceText).filter((readings) =>
    readings.every((reading) => {
      const iso = toIsoDate(reading);
      return iso === null || !usedDates.has(iso);
    }),
  ).length;
  if (unusedDates > 0) {
    warnings.push(
      `Your description mentions ${unusedDates === 1 ? "a date" : `${unusedDates} dates`} that no suggestion uses. Check the date fields yourself.`,
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
