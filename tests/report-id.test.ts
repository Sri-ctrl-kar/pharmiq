import { describe, expect, it } from "vitest";
import {
  REPORT_ID_PATTERN,
  generateReportId,
  isValidReportId,
} from "@/lib/reports/report-id";

describe("generateReportId", () => {
  it("uses the ADR-<year>-<6 chars> format with the submission year", () => {
    const id = generateReportId(new Date("2026-10-23T00:00:00Z"));
    expect(id).toMatch(/^ADR-2026-[0-9A-Z]{6}$/);
    expect(isValidReportId(id)).toBe(true);
  });

  it("only uses unambiguous Crockford base32 characters", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateReportId()).not.toMatch(/[ILOU]/);
    }
  });

  it("maps random bytes deterministically and without bias", () => {
    const fixed = (bytes: Uint8Array) =>
      bytes.map((_, i) => [0, 31, 32, 255, 10, 64][i]);
    expect(generateReportId(new Date("2027-01-01T00:00:00Z"), fixed)).toBe(
      "ADR-2027-0Z0ZA0",
    );
  });

  it("is effectively unique across many generations", () => {
    const ids = new Set(
      Array.from({ length: 10_000 }, () => generateReportId()),
    );
    expect(ids.size).toBeGreaterThan(9_990);
  });

  it("rejects malformed IDs", () => {
    for (const bad of [
      "ADR-26-ABCDEF",
      "ADR-2026-ABCDE",
      "ADR-2026-ABCDEI",
      "adr-2026-abcdef",
    ]) {
      expect(REPORT_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});
