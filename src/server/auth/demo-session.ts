import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed session tokens for SHARED-CODE DEMO reviewer access (local demo store only).
 * This proves the browser was given access by someone who knew the server's access
 * code; it does not identify an individual. Production uses Supabase Auth instead.
 *
 * Token: base64url(JSON payload) "." base64url(HMAC-SHA256(key, payload)), where the key
 * is derived from both the session secret and the access code (`demoSessionKey`), so
 * changing either one invalidates every issued session. Tokens are not stored on the
 * server and cannot be revoked individually.
 */

export const DEMO_SESSION_COOKIE = "adr_reviewer_demo";
/** Only sent to reviewer pages and their server actions, not the rest of the site. */
export const DEMO_SESSION_COOKIE_PATH = "/reviewer";
export const DEMO_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MIN_ACCESS_CODE_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;

type Payload = { v: 1; sub: "demo-reviewer"; iat: number; exp: number };

/** Clock skew tolerated for a token's issue time. */
const MAX_CLOCK_SKEW_SECONDS = 60;

const sign = (secret: string, data: string) =>
  createHmac("sha256", secret).update(data).digest("base64url");

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Signing key for demo sessions, bound to the current access code and secret. */
export function demoSessionKey({
  code,
  secret,
}: {
  code: string;
  secret: string;
}): string {
  return sign(secret, `session-key:v1:${code}`);
}

export function createDemoSessionToken(
  key: string,
  now: Date = new Date(),
  ttlSeconds: number = DEMO_SESSION_TTL_SECONDS,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: Payload = {
    v: 1,
    sub: "demo-reviewer",
    iat,
    exp: iat + ttlSeconds,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(key, data)}`;
}

export type DemoSessionCheck =
  | { valid: true; expiresAt: Date }
  | {
      valid: false;
      reason: "missing" | "malformed" | "bad_signature" | "expired";
    };

export function verifyDemoSessionToken(
  token: string | undefined,
  key: string,
  now: Date = new Date(),
): DemoSessionCheck {
  if (!token) return { valid: false, reason: "missing" };
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined)
    return { valid: false, reason: "malformed" };
  if (!safeEqual(signature, sign(key, data)))
    return { valid: false, reason: "bad_signature" };
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (
    payload.v !== 1 ||
    payload.sub !== "demo-reviewer" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    // Defence in depth: never honour a lifetime longer than the server issues.
    payload.exp - payload.iat > DEMO_SESSION_TTL_SECONDS ||
    payload.iat * 1000 > now.getTime() + MAX_CLOCK_SKEW_SECONDS * 1000
  ) {
    return { valid: false, reason: "malformed" };
  }
  if (payload.exp * 1000 <= now.getTime())
    return { valid: false, reason: "expired" };
  return { valid: true, expiresAt: new Date(payload.exp * 1000) };
}

/** Constant-time comparison of a submitted access code with the configured one. */
export function accessCodeMatches(
  submitted: string,
  configured: string,
  secret: string,
): boolean {
  // Compare HMACs so the comparison length does not depend on the inputs.
  return safeEqual(
    sign(secret, `code:${submitted}`),
    sign(secret, `code:${configured}`),
  );
}
