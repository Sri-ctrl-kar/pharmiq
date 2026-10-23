/**
 * Flags text that looks like it contains direct identifiers, so the reporter can remove
 * them. A heuristic warning only: it never blocks submission and never edits the text.
 */
const patterns: { kind: string; pattern: RegExp }[] = [
  { kind: "an email address", pattern: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i },
  {
    kind: "a phone number",
    pattern: /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/,
  },
  {
    kind: "an Aadhaar-like number",
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  },
];

export function findPossibleIdentifiers(
  text: string | null | undefined,
): string[] {
  if (!text) return [];
  return patterns
    .filter(({ pattern }) => pattern.test(text))
    .map(({ kind }) => kind);
}
