/**
 * Pure text checks used by the extraction verifier. They read the reporter's quoted
 * words and answer narrow questions ("which calendar dates does this quote state?",
 * "is this event negated?"). They are deliberately conservative: when in doubt the
 * caller flags the value for human review rather than accepting it.
 */

export const normaliseText = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export const compactText = (text: string) =>
  normaliseText(text).replace(/[^\p{L}\p{N}]/gu, "");

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** A date stated in text. `year` is null when the text gives only day and month. */
export type StatedDate = { year: number | null; month: number; day: number };

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const ORDINAL = "(?:st|nd|rd|th)?";

const validDay = (year: number | null, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = new Date(Date.UTC(year ?? 2024, month, 0)).getUTCDate(); // leap-safe default
  return day <= days;
};

/**
 * Each date mention in the text, with every reading a person could reasonably take.
 * Numeric dates such as 03/04/2026 are one mention with two readings (day-first and
 * month-first). Relative expressions ("yesterday", "last week") yield nothing.
 */
export function statedDateMentions(text: string): StatedDate[][] {
  let rest = normaliseText(text);
  const mentions: StatedDate[][] = [];
  let current: StatedDate[] = [];
  const add = (year: number | null, month: number, day: number) => {
    if (
      validDay(year, month, day) &&
      !current.some(
        (d) => d.year === year && d.month === month && d.day === day,
      )
    ) {
      current.push({ year, month, day });
    }
  };
  const take = (pattern: RegExp, handle: (m: RegExpExecArray) => void) => {
    rest = rest.replace(pattern, (...args) => {
      current = [];
      handle(args as unknown as RegExpExecArray);
      if (current.length > 0) mentions.push(current);
      return " ";
    });
  };
  const year4 = (value?: string) => (value ? Number(value) : null);

  // 2026-09-04 (ISO)
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) =>
    add(Number(m[1]), Number(m[2]), Number(m[3])),
  );
  // 04/09/2026, 4-9-26, 4.9.2026
  take(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, (m) => {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    add(year, Number(m[2]), Number(m[1])); // day/month/year (usual in India)
    add(year, Number(m[1]), Number(m[2])); // month/day/year
  });
  // 4 September 2026, 4th of Sept, 2026, 4 Sep
  take(
    new RegExp(
      `\\b(\\d{1,2})${ORDINAL}\\s*(?:of\\s+)?(${MONTH})\\.?(?:,?\\s*(\\d{4}))?\\b`,
      "g",
    ),
    (m) => add(year4(m[3]), MONTHS[m[2]], Number(m[1])),
  );
  // September 4, 2026, Sept 4th 2026, Sep 4
  take(
    new RegExp(
      `\\b(${MONTH})\\.?\\s+(\\d{1,2})${ORDINAL}(?:,?\\s*(\\d{4}))?\\b`,
      "g",
    ),
    (m) => add(year4(m[3]), MONTHS[m[1]], Number(m[2])),
  );
  return mentions;
}

/** Every calendar date the text states, in any reading (flattened, de-duplicated). */
export function statedDates(text: string): StatedDate[] {
  const found: StatedDate[] = [];
  for (const reading of statedDateMentions(text).flat()) {
    if (
      !found.some(
        (d) =>
          d.year === reading.year &&
          d.month === reading.month &&
          d.day === reading.day,
      )
    ) {
      found.push(reading);
    }
  }
  return found;
}

export const toIsoDate = ({ year, month, day }: StatedDate) =>
  year === null
    ? null
    : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export type DateCheck =
  | "matches"
  | "matches_without_year"
  | "multiple_dates"
  | "mismatch"
  | "not_stated";

/**
 * Does the quote state exactly this ISO date (YYYY-MM-DD)? A quote that states more
 * than one date ("4 September 2026 or perhaps 5 September 2026") cannot confirm which
 * one is meant, so a match there is reported as `multiple_dates`.
 */
export function checkDateAgainstQuote(
  isoDate: string,
  quote: string,
): DateCheck {
  const [year, month, day] = isoDate.split("-").map(Number);
  const dates = statedDates(quote);
  if (dates.length === 0) return "not_stated";
  if (
    dates.some((d) => d.year === year && d.month === month && d.day === day)
  ) {
    return statedDateMentions(quote).length > 1 ? "multiple_dates" : "matches";
  }
  if (
    dates.some((d) => d.year === null && d.month === month && d.day === day)
  ) {
    return "matches_without_year";
  }
  return "mismatch";
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** A clock time stated in text. `meridiemKnown` is false for "9:30" or "9 o'clock". */
export type StatedTime = { minutes: number; meridiemKnown: boolean };

export function statedTimes(text: string): StatedTime[] {
  let rest = normaliseText(text);
  const found: StatedTime[] = [];
  const add = (hour: number, minute: number, meridiemKnown: boolean) => {
    if (hour > 23 || minute > 59) return;
    const minutes = hour * 60 + minute;
    if (!found.some((t) => t.minutes === minutes))
      found.push({ minutes, meridiemKnown });
  };
  const withMeridiem = (hour: number, minute: number, meridiem: string) => {
    if (hour < 1 || hour > 12) return;
    const pm = meridiem.startsWith("p");
    add((hour % 12) + (pm ? 12 : 0), minute, true);
  };
  const take = (pattern: RegExp, handle: (m: string[]) => void) => {
    rest = rest.replace(pattern, (...args: string[]) => {
      handle(args);
      return " ";
    });
  };
  const MERIDIEM = "(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)";

  take(
    new RegExp(`\\b(\\d{1,2})[:.](\\d{2})\\s*${MERIDIEM}(?![a-z])`, "g"),
    (m) => withMeridiem(Number(m[1]), Number(m[2]), m[3]),
  );
  take(new RegExp(`\\b(\\d{1,2})\\s*${MERIDIEM}(?![a-z])`, "g"), (m) =>
    withMeridiem(Number(m[1]), 0, m[2]),
  );
  take(/\b(noon|midday)\b/g, () => add(12, 0, true));
  take(/\bmidnight\b/g, () => add(0, 0, true));
  take(/\b(\d{1,2})[:.](\d{2})\b/g, (m) => {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    // 24-hour times (13:00+, or written with a leading zero) are unambiguous.
    if (
      hour > 12 ||
      hour === 0 ||
      (m[1].length === 2 && m[1].startsWith("0"))
    ) {
      add(hour, minute, true);
    } else {
      add(hour, minute, false);
      if (hour < 12) add(hour + 12, minute, false);
    }
  });
  take(/\b(\d{1,2})\s*o'?\s?clock\b/g, (m) => {
    const hour = Number(m[1]);
    if (hour >= 1 && hour <= 12) {
      add(hour % 12, 0, false);
      add((hour % 12) + 12, 0, false);
    }
  });
  return found;
}

export type TimeCheck =
  "matches" | "meridiem_unclear" | "mismatch" | "not_stated";

/** Does the quote state exactly this HH:MM time? */
export function checkTimeAgainstQuote(time: string, quote: string): TimeCheck {
  const [hour, minute] = time.split(":").map(Number);
  const target = hour * 60 + minute;
  const times = statedTimes(quote);
  if (times.length === 0) return "not_stated";
  const match = times.find((t) => t.minutes === target);
  if (!match) return "mismatch";
  return match.meridiemKnown ? "matches" : "meridiem_unclear";
}

// Wording that makes a stated date or time approximate, a bound, a range or a choice.
const IMPRECISE =
  /\b(around|about|approx\w*|roughly|nearly|almost|sometime|some time|maybe|perhaps|probably|or so|-ish|ish|before|after|by|until|till|between|or|either)\b|~/;

/** True when the quote's date or time is approximate or not a single exact point. */
export const isImprecise = (quote: string) =>
  IMPRECISE.test(normaliseText(quote));

// ---------------------------------------------------------------------------
// Context: sentences, negation, instruction-like text
// ---------------------------------------------------------------------------

const isBoundary = (text: string, index: number) => {
  const char = text[index];
  if (char === "!" || char === "?" || char === ";") return true;
  // A full stop ends a sentence only when followed by a space or the end (not 9.30).
  return char === "." && (index + 1 >= text.length || text[index + 1] === " ");
};

/**
 * The sentence(s) of `source` containing each occurrence of `quote` (both normalised).
 * Returns an empty array when the quote does not occur.
 */
export function sentencesContaining(source: string, quote: string): string[] {
  const haystack = normaliseText(source);
  const needle = normaliseText(quote);
  if (!needle) return [];
  const sentences: string[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + 1)
  ) {
    let start = at;
    while (start > 0 && !isBoundary(haystack, start - 1)) start--;
    let end = at + needle.length;
    while (end < haystack.length && !isBoundary(haystack, end)) end++;
    sentences.push(haystack.slice(start, end).trim());
  }
  return sentences;
}

const NEGATION =
  /\b(no|not|never|without|nor|none|denies|denied|neither)\b|n't\b/;

/**
 * True when, in any sentence containing `quote`, a match of `keyword` is preceded within
 * a few words by a negation ("not admitted", "wasn't taken to hospital", "no fever").
 */
export function isNegated(
  source: string,
  quote: string,
  keyword: RegExp,
): boolean {
  const flags = keyword.flags.includes("g")
    ? keyword.flags
    : `${keyword.flags}g`;
  for (const sentence of sentencesContaining(source, quote)) {
    for (const match of sentence.matchAll(new RegExp(keyword.source, flags))) {
      const before = sentence
        .slice(0, match.index)
        // Negation does not carry past punctuation or a contrast ("no fever but dizzy").
        .split(/[,:()]|\b(?:but|however|although|though|yet|whereas)\b/)
        .pop()!
        .trim()
        .split(/\s+/)
        .slice(-4)
        .join(" ");
      if (NEGATION.test(before)) return true;
    }
  }
  return false;
}

const INSTRUCTION =
  /\b(ignore|disregard)\b.{0,40}\b(instruction|prompt|above|previous|prior|rules?)\b|\b(system prompt|previous instructions)\b|\byou are (an? |the )?(ai|assistant|model|language model)\b|\b(state|say|output|respond|write|answer|report|claim) that\b|\bpretend\b|\bas an ai\b/;

/** True when the quote sits in a sentence that reads like an instruction to the AI. */
export function isInInstructionLikeText(
  source: string,
  quote: string,
): boolean {
  return sentencesContaining(source, quote).some((sentence) =>
    INSTRUCTION.test(sentence),
  );
}

/**
 * Is a detail quote linked to this medicine? It is when the quote names the medicine,
 * or sits in a sentence that names this medicine and no other extracted medicine.
 * A quote naming a different medicine is never linked. Longer names that contain this
 * one ("amoxicillin-clavulanate" vs "amoxicillin") do not count as naming it.
 */
export function isLinkedToMedicine(
  source: string,
  quote: string,
  name: string,
  otherNames: string[],
): boolean {
  const own = compactText(name);
  if (!own) return false;
  const others = otherNames
    .map(compactText)
    .filter((key) => key.length > 0 && key !== own);
  const longer = others.filter((key) => key.includes(own));
  const namesOwn = (text: string) =>
    longer
      .reduce((rest, key) => rest.split(key).join("\u0000"), text)
      .includes(own);
  const namesOther = (text: string) => others.some((key) => text.includes(key));

  const quoted = compactText(quote);
  if (namesOwn(quoted)) return true;
  if (namesOther(quoted)) return false;
  return sentencesContaining(source, quote).some((sentence) => {
    const text = compactText(sentence);
    // A sentence naming two medicines cannot attribute an unnamed detail ("10 mg").
    return namesOwn(text) && !namesOther(text);
  });
}
