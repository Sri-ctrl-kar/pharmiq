import { describe, expect, it } from "vitest";
import { findPossibleIdentifiers } from "@/lib/reports/privacy";

describe("findPossibleIdentifiers", () => {
  it("flags emails, Indian mobile numbers and Aadhaar-like numbers", () => {
    expect(findPossibleIdentifiers("mail me at ravi@example.com")).toEqual([
      "an email address",
    ]);
    expect(findPossibleIdentifiers("call +91 98765 43210")).toEqual([
      "a phone number",
    ]);
    expect(findPossibleIdentifiers("ID 1234 5678 9012")).toEqual([
      "an Aadhaar-like number",
    ]);
  });

  it("does not flag ordinary clinical text", () => {
    expect(
      findPossibleIdentifiers(
        "500 mg twice daily for 10 days, rash on 12/09/2026",
      ),
    ).toEqual([]);
    expect(findPossibleIdentifiers(null)).toEqual([]);
  });
});
