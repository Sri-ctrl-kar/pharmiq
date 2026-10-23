import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_SESSION_COOKIE,
  accessCodeMatches,
  createDemoSessionToken,
  DEMO_SESSION_TTL_SECONDS,
  demoSessionKey,
  verifyDemoSessionToken,
} from "@/server/auth/demo-session";
import {
  resolveReviewerAccess,
  type ReviewerAccess,
  type SupabaseSession,
} from "@/server/auth/reviewer-access";
import {
  resolveReviewerAuthMode,
  type ReviewerAuthMode,
} from "@/server/auth/reviewer-auth-mode";
import { LocalDemoReportRepository } from "@/server/reports/local-demo-repository";
import { submitReport } from "@/server/reports/submit-report";
import { handleDemoSignIn, handleStatusChange } from "@/server/review/handlers";
import { validDraft } from "../fixtures";

const SECRET = "test-secret-that-is-at-least-32-characters";
const CODE = "synthetic-demo-code";
const NOW = new Date("2026-10-23T06:00:00Z");
const demoMode: ReviewerAuthMode = {
  mode: "demo-code",
  code: CODE,
  secret: SECRET,
};
const KEY = demoSessionKey(demoMode);

describe("demo session tokens", () => {
  it("verifies a token it issued, until it expires", () => {
    const token = createDemoSessionToken(SECRET, NOW, 60);
    expect(verifyDemoSessionToken(token, SECRET, NOW)).toMatchObject({
      valid: true,
    });
    expect(
      verifyDemoSessionToken(token, SECRET, new Date(NOW.getTime() + 61_000)),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects missing, malformed, tampered and wrongly signed tokens", () => {
    const token = createDemoSessionToken(SECRET, NOW);
    const [data, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        sub: "demo-reviewer",
        iat: 0,
        exp: 9_999_999_999,
      }),
    ).toString("base64url");
    expect(verifyDemoSessionToken(undefined, SECRET, NOW).valid).toBe(false);
    expect(verifyDemoSessionToken("not-a-token", SECRET, NOW)).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(
      verifyDemoSessionToken(`${forged}.${signature}`, SECRET, NOW),
    ).toEqual({ valid: false, reason: "bad_signature" });
    expect(
      verifyDemoSessionToken(`${data}.${signature}x`, SECRET, NOW),
    ).toEqual({ valid: false, reason: "bad_signature" });
    expect(
      verifyDemoSessionToken(
        token,
        "another-secret-that-is-also-32-chars-long",
        NOW,
      ),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("binds sessions to the current access code and secret", () => {
    const token = createDemoSessionToken(KEY, NOW);
    expect(verifyDemoSessionToken(token, KEY, NOW).valid).toBe(true);
    // Rotating either value signs every existing session out.
    for (const rotated of [
      { code: "a-new-demo-code-2026", secret: SECRET },
      { code: CODE, secret: "a-rotated-secret-that-is-32-chars-long" },
    ]) {
      expect(
        verifyDemoSessionToken(token, demoSessionKey(rotated), NOW),
      ).toEqual({ valid: false, reason: "bad_signature" });
    }
    // The raw secret alone is not the signing key.
    expect(verifyDemoSessionToken(token, SECRET, NOW).valid).toBe(false);
  });

  it("rejects correctly signed tokens with an over-long lifetime or a future issue time", () => {
    // Sign arbitrary payloads with the real key to test the payload checks alone.
    const sign = (payload: object) => {
      const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${data}.${createHmac("sha256", KEY).update(data).digest("base64url")}`;
    };
    const iat = Math.floor(NOW.getTime() / 1000);
    expect(
      verifyDemoSessionToken(
        sign({ v: 1, sub: "demo-reviewer", iat, exp: iat + 600 }),
        KEY,
        NOW,
      ).valid,
    ).toBe(true);
    expect(
      verifyDemoSessionToken(
        sign({
          v: 1,
          sub: "demo-reviewer",
          iat,
          exp: iat + DEMO_SESSION_TTL_SECONDS + 1,
        }),
        KEY,
        NOW,
      ),
    ).toEqual({ valid: false, reason: "malformed" });
    expect(
      verifyDemoSessionToken(
        sign({ v: 1, sub: "demo-reviewer", iat: iat + 3600, exp: iat + 7200 }),
        KEY,
        NOW,
      ),
    ).toEqual({ valid: false, reason: "malformed" });
    expect(
      verifyDemoSessionToken(
        sign({ v: 1, sub: "admin", iat, exp: iat + 600 }),
        KEY,
        NOW,
      ),
    ).toEqual({ valid: false, reason: "malformed" });
  });

  it("compares access codes exactly", () => {
    expect(accessCodeMatches(CODE, CODE, SECRET)).toBe(true);
    expect(accessCodeMatches(`${CODE} `, CODE, SECRET)).toBe(false);
    expect(accessCodeMatches("", CODE, SECRET)).toBe(false);
  });
});

describe("resolveReviewerAuthMode", () => {
  it("uses Supabase Auth whenever Supabase storage is configured (demo code ignored)", () => {
    expect(
      resolveReviewerAuthMode(
        { REVIEWER_DEMO_ACCESS_CODE: CODE, REVIEWER_SESSION_SECRET: SECRET },
        { mode: "supabase" },
      ),
    ).toEqual({ mode: "supabase" });
  });

  it("locks the reviewer area on the demo store unless both demo settings are strong enough", () => {
    expect(resolveReviewerAuthMode({}, { mode: "local-demo" })).toMatchObject({
      mode: "not_configured",
      missing: [
        expect.stringMatching(/ACCESS_CODE/),
        expect.stringMatching(/SESSION_SECRET/),
      ],
    });
    expect(
      resolveReviewerAuthMode(
        { REVIEWER_DEMO_ACCESS_CODE: "short", REVIEWER_SESSION_SECRET: SECRET },
        { mode: "local-demo" },
      ).mode,
    ).toBe("not_configured");
    expect(
      resolveReviewerAuthMode(
        { REVIEWER_DEMO_ACCESS_CODE: CODE, REVIEWER_SESSION_SECRET: "short" },
        { mode: "local-demo" },
      ).mode,
    ).toBe("not_configured");
    expect(
      resolveReviewerAuthMode(
        { REVIEWER_DEMO_ACCESS_CODE: CODE, REVIEWER_SESSION_SECRET: SECRET },
        { mode: "local-demo" },
      ),
    ).toEqual(demoMode);
  });

  it("locks the reviewer area when storage is misconfigured", () => {
    expect(
      resolveReviewerAuthMode(
        {},
        { mode: "misconfigured", missing: ["SUPABASE_SERVICE_ROLE_KEY"] },
      ),
    ).toEqual({
      mode: "not_configured",
      missing: ["SUPABASE_SERVICE_ROLE_KEY"],
    });
  });
});

describe("resolveReviewerAccess", () => {
  let dir: string;
  let repository: LocalDemoReportRepository;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "adr-auth-"));
    repository = new LocalDemoReportRepository(
      path.join(dir, "store.json"),
      [],
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const unusedSupabase = vi.fn(async (): Promise<SupabaseSession> => {
    throw new Error("must not be called");
  });
  const demo = (cookie?: string) =>
    resolveReviewerAccess({
      authMode: demoMode,
      readCookie: (name) => (name === DEMO_SESSION_COOKIE ? cookie : undefined),
      demoRepository: () => repository,
      supabase: unusedSupabase,
      now: NOW,
    });

  it("authorises only a valid signed demo session", async () => {
    expect(await demo()).toEqual({ status: "signed_out", method: "demo-code" });
    expect(await demo("forged.token")).toEqual({
      status: "signed_out",
      method: "demo-code",
    });
    const access = await demo(createDemoSessionToken(KEY, NOW));
    expect(access).toMatchObject({
      status: "authorised",
      method: "demo-code",
      reviewer: { id: "demo-reviewer" },
    });
    expect(unusedSupabase).not.toHaveBeenCalled();
  });

  it("returns no repository when not configured", async () => {
    const access = await resolveReviewerAccess({
      authMode: { mode: "not_configured", missing: ["X"] },
      readCookie: () => createDemoSessionToken(SECRET, NOW),
      demoRepository: () => repository,
      supabase: unusedSupabase,
    });
    expect(access).toEqual({ status: "not_configured", missing: ["X"] });
    expect(access).not.toHaveProperty("repository");
  });

  const supabaseSession = (
    user: { id: string; email: string | null } | null,
    reviewer: boolean,
  ): SupabaseSession => ({
    getUser: async () => user,
    isReviewer: async () => reviewer,
    reviewClient: {} as never,
  });
  const viaSupabase = (session: SupabaseSession | Error) =>
    resolveReviewerAccess({
      authMode: { mode: "supabase" },
      readCookie: () => undefined,
      demoRepository: () => repository,
      supabase: async () => {
        if (session instanceof Error) throw session;
        return session;
      },
    });

  it("requires a Supabase user with the reviewer role", async () => {
    expect(await viaSupabase(supabaseSession(null, false))).toEqual({
      status: "signed_out",
      method: "supabase",
    });
    expect(
      await viaSupabase(
        supabaseSession({ id: "u-1", email: "user@example.test" }, false),
      ),
    ).toEqual({ status: "forbidden", method: "supabase" });
    expect(
      await viaSupabase(
        supabaseSession({ id: "u-2", email: "reviewer@example.test" }, true),
      ),
    ).toMatchObject({
      status: "authorised",
      method: "supabase",
      reviewer: { id: "u-2", label: "reviewer@example.test" },
    });
    expect(await viaSupabase(new Error("network"))).toEqual({
      status: "unavailable",
    });
  });

  it("never accepts a demo cookie in Supabase mode", async () => {
    const access = await resolveReviewerAccess({
      authMode: { mode: "supabase" },
      readCookie: () => createDemoSessionToken(SECRET, NOW),
      demoRepository: () => repository,
      supabase: async () => supabaseSession(null, false),
    });
    expect(access.status).toBe("signed_out");
  });
});

describe("reviewer action authorisation", () => {
  let dir: string;
  let repository: LocalDemoReportRepository;
  let reportId: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "adr-actions-"));
    repository = new LocalDemoReportRepository(
      path.join(dir, "store.json"),
      [],
    );
    const result = await submitReport(validDraft(), { repository });
    reportId = result.ok ? result.reportId : "";
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const startReview = () =>
    form({ reportId, expectedStatus: "submitted", nextStatus: "under_review" });

  it.each([
    ["signed out", { status: "signed_out", method: "demo-code" } as const],
    [
      "signed in without the reviewer role",
      { status: "forbidden", method: "supabase" } as const,
    ],
    [
      "not configured",
      { status: "not_configured", missing: [] as string[] } as const,
    ],
  ] satisfies [string, ReviewerAccess][])(
    "changes nothing when the caller is %s",
    async (_label, access) => {
      const result = await handleStatusChange(startReview(), access);
      expect(result).toMatchObject({
        status: "error",
        message: expect.stringMatching(/not signed in as a reviewer/),
      });
      expect((await repository.getReport(reportId))!.status).toBe("submitted");
    },
  );

  it("changes the status for an authorised reviewer and reports success", async () => {
    const access = {
      status: "authorised",
      method: "demo-code",
      reviewer: { id: "demo-reviewer", label: "Demo" },
      repository,
    } as const;
    expect(await handleStatusChange(startReview(), access)).toEqual({
      status: "success",
      message: "Status changed to “Under review”.",
    });
    expect((await repository.getReport(reportId))!.status).toBe("under_review");
    // Re-sending the same (now stale) form is a conflict, not a second change.
    expect(await handleStatusChange(startReview(), access)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/changed by someone else/),
    });
  });

  it("returns field errors for invalid input without writing", async () => {
    const access = {
      status: "authorised",
      method: "demo-code",
      reviewer: { id: "demo-reviewer", label: "Demo" },
      repository,
    } as const;
    const result = await handleStatusChange(
      form({ reportId, expectedStatus: "submitted", nextStatus: "reviewed" }),
      access,
    );
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { nextStatus: expect.any(String) },
    });
    expect((await repository.getReport(reportId))!.status).toBe("submitted");
  });

  it("reports storage failures without leaking details", async () => {
    const logError = vi.fn();
    const broken = {
      mode: "local-demo" as const,
      listReports: vi.fn(),
      getReport: vi.fn(),
      updateStatus: vi.fn().mockRejectedValue(
        Object.assign(new Error("disk full at /secret/path"), {
          code: "ENOSPC",
        }),
      ),
    };
    const access = {
      status: "authorised",
      method: "demo-code",
      reviewer: { id: "demo-reviewer", label: "Demo" },
      repository: broken,
    } as const;
    const result = await handleStatusChange(startReview(), access, logError);
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/Nothing was changed/),
    });
    expect(JSON.stringify(result)).not.toContain("/secret/path");
    expect(logError.mock.calls[0][0]).toBe(
      "[review] status update failed: Error (ENOSPC)",
    );
  });
});

describe("demo sign-in", () => {
  const form = (code?: string) => {
    const data = new FormData();
    if (code !== undefined) data.set("accessCode", code);
    return data;
  };

  it("issues a verifiable session token only for the right code", () => {
    const result = handleDemoSignIn(form(CODE), demoMode, {
      allowed: true,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(verifyDemoSessionToken(result.token, KEY, NOW).valid).toBe(true);
    expect(
      handleDemoSignIn(form("wrong-code-123"), demoMode, { allowed: true }),
    ).toEqual({ ok: false, message: "That access code is not correct." });
    expect(handleDemoSignIn(form(), demoMode, { allowed: true })).toEqual({
      ok: false,
      message: "Enter the access code.",
    });
  });

  it("refuses when rate limited or when demo access is not enabled", () => {
    expect(handleDemoSignIn(form(CODE), demoMode, { allowed: false }).ok).toBe(
      false,
    );
    expect(
      handleDemoSignIn(form(CODE), { mode: "supabase" }, { allowed: true }).ok,
    ).toBe(false);
    expect(
      handleDemoSignIn(
        form(CODE),
        { mode: "not_configured", missing: [] },
        { allowed: true },
      ).ok,
    ).toBe(false);
  });
});
