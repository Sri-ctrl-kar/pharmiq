import { describe, expect, it } from "vitest";
import { getFeatureFlags, parseServerEnv } from "@/lib/env-schema";

describe("parseServerEnv", () => {
  it("treats a missing or empty configuration as all features off", () => {
    const env = parseServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "",
      ANTHROPIC_API_KEY: "  ",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(getFeatureFlags(env)).toEqual({
      supabase: false,
      supabaseAdmin: false,
      aiExtraction: false,
    });
  });

  it("enables features only when their required variables are present", () => {
    const env = parseServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      ANTHROPIC_API_KEY: "key",
    });
    expect(getFeatureFlags(env)).toEqual({
      supabase: true,
      supabaseAdmin: false,
      aiExtraction: true,
    });
  });

  it("does not enable admin access without the public Supabase config", () => {
    const env = parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "service" });
    expect(getFeatureFlags(env).supabaseAdmin).toBe(false);
  });

  it("rejects a malformed URL and names the variable without leaking its value", () => {
    const secretLooking = "not-a-url-sk-123";
    expect(() =>
      parseServerEnv({ NEXT_PUBLIC_SUPABASE_URL: secretLooking }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    try {
      parseServerEnv({ NEXT_PUBLIC_SUPABASE_URL: secretLooking });
    } catch (error) {
      expect(String(error)).not.toContain(secretLooking);
    }
  });
});
