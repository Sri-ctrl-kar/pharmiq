import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conditional classes and lets later Tailwind utilities win", () => {
    expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4");
  });

  it("resolves conflicts between custom token colours", () => {
    expect(cn("bg-primary", "bg-danger")).toBe("bg-danger");
  });
});
