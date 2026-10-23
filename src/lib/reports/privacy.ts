/**
 * Privacy helpers for free text.
 *
 * - `findPossibleIdentifiers` warns the reporter; it never blocks or edits their text.
 * - `minimiseForAi` produces the copy of the text that may leave our server for an AI
 *   provider, with likely direct identifiers replaced by placeholders. The reporter's
 *   own text is stored unchanged.
 *
 * Both are heuristics: they reduce, but cannot guarantee the absence of, identifiers.
 */

type Rule = {
  kind: string;
  label: string;
  pattern: RegExp;
  replacement: string;
};

// Order matters: longer numeric patterns run before shorter ones.
const rules: Rule[] = [
  {
    kind: "email",
    label: "an email address",
    pattern: /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi,
    replacement: "[EMAIL REMOVED]",
  },
  {
    kind: "link",
    label: "a web link",
    pattern: /\bhttps?:\/\/\S+|\bwww\.\S+/gi,
    replacement: "[LINK REMOVED]",
  },
  {
    kind: "id_number",
    label: "an Aadhaar-like number",
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: "[ID NUMBER REMOVED]",
  },
  {
    kind: "id_number",
    label: "a PAN-like number",
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    replacement: "[ID NUMBER REMOVED]",
  },
  {
    kind: "phone",
    label: "a phone number",
    pattern: /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g,
    replacement: "[PHONE REMOVED]",
  },
  {
    kind: "phone",
    label: "a phone number",
    pattern: /\b0\d{2,4}[\s-]\d{6,8}\b/g,
    replacement: "[PHONE REMOVED]",
  },
  {
    kind: "name",
    label: "a name",
    pattern:
      /\b(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Kumari|Sri)\.?\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
    replacement: "[NAME REMOVED]",
  },
  {
    kind: "name",
    label: "a name",
    pattern: /\b(my name is|name:)\s+[A-Za-z]+(?:\s+[A-Z][a-zA-Z]+)?/gi,
    replacement: "$1 [NAME REMOVED]",
  },
  {
    kind: "postcode",
    label: "a PIN code",
    pattern: /\b(pin(?:\s*code)?|pincode)\s*[:\-]?\s*\d{6}\b/gi,
    replacement: "$1 [PIN REMOVED]",
  },
];

export function findPossibleIdentifiers(
  text: string | null | undefined,
): string[] {
  if (!text) return [];
  const labels = rules
    .filter((rule) =>
      new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(
        text,
      ),
    )
    .map((rule) => rule.label);
  return [...new Set(labels)];
}

export type Redaction = { kind: string; count: number };

export function minimiseForAi(text: string): {
  text: string;
  redactions: Redaction[];
} {
  const counts = new Map<string, number>();
  let result = text;
  for (const rule of rules) {
    result = result.replace(rule.pattern, (...args: string[]) => {
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
      // Re-apply the replacement so `$1` group references keep the leading phrase.
      return args[0].replace(
        new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")),
        rule.replacement,
      );
    });
  }
  return {
    text: result,
    redactions: [...counts].map(([kind, count]) => ({ kind, count })),
  };
}
