/**
 * Human-readable report IDs: `ADR-<year>-<6 Crockford base32 chars>`, e.g. ADR-2026-7K3F9Q.
 * 30 random bits per year; collisions are caught by a unique constraint and retried.
 * Crockford base32 omits I, L, O and U so IDs are easy to read aloud and copy.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_LENGTH = 6;

export const REPORT_ID_PATTERN = /^ADR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;

export function generateReportId(
  now: Date = new Date(),
  random: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(RANDOM_LENGTH));
  let suffix = "";
  for (const byte of bytes) {
    // 256 is a multiple of 32, so this mapping has no modulo bias.
    suffix += ALPHABET[byte % ALPHABET.length];
  }
  return `ADR-${now.getUTCFullYear()}-${suffix}`;
}

export function isValidReportId(value: string): boolean {
  return REPORT_ID_PATTERN.test(value);
}
