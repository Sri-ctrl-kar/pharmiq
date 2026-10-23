import type { ServerEnv } from "@/lib/env-schema";
import type { StorageStatus } from "@/server/reports/storage";
import {
  MIN_ACCESS_CODE_LENGTH,
  MIN_SESSION_SECRET_LENGTH,
} from "./demo-session";

export type ReviewerAuthMode =
  | { mode: "supabase" }
  | { mode: "demo-code"; code: string; secret: string }
  | { mode: "not_configured"; missing: string[] };

/**
 * How reviewers authenticate, derived from server configuration:
 * - Supabase storage → Supabase Auth; reviewer role from public.profiles (RLS-enforced).
 * - Local demo storage → locked unless a demo access code AND session secret are set.
 *   The demo code can only ever unlock the local demo store.
 * - Anything else → reviewer area locked.
 */
export function resolveReviewerAuthMode(
  env: ServerEnv,
  storage: StorageStatus,
): ReviewerAuthMode {
  if (storage.mode === "supabase") return { mode: "supabase" };
  if (storage.mode === "misconfigured") {
    return { mode: "not_configured", missing: storage.missing };
  }
  const missing: string[] = [];
  const code = env.REVIEWER_DEMO_ACCESS_CODE ?? "";
  const secret = env.REVIEWER_SESSION_SECRET ?? "";
  if (code.length < MIN_ACCESS_CODE_LENGTH) {
    missing.push(
      `REVIEWER_DEMO_ACCESS_CODE (at least ${MIN_ACCESS_CODE_LENGTH} characters)`,
    );
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    missing.push(
      `REVIEWER_SESSION_SECRET (at least ${MIN_SESSION_SECRET_LENGTH} characters)`,
    );
  }
  return missing.length
    ? { mode: "not_configured", missing }
    : { mode: "demo-code", code, secret };
}
