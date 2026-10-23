import type { ReviewerIdentity } from "@/lib/review/types";
import type { ReviewRepository } from "@/server/review/repository";
import {
  SupabaseReviewRepository,
  type ReviewDbClient,
} from "@/server/review/supabase-review-repository";
import {
  DEMO_SESSION_COOKIE,
  demoSessionKey,
  verifyDemoSessionToken,
} from "./demo-session";
import type { ReviewerAuthMode } from "./reviewer-auth-mode";

export type ReviewerAccess =
  | {
      status: "authorised";
      method: "supabase" | "demo-code";
      reviewer: ReviewerIdentity;
      /** Only handed out after authorisation. */
      repository: ReviewRepository;
    }
  | { status: "signed_out"; method: "supabase" | "demo-code" }
  | { status: "forbidden"; method: "supabase" }
  | { status: "not_configured"; missing: string[] }
  | { status: "unavailable" };

/** What reviewer access needs from a signed-in Supabase session. */
export type SupabaseSession = {
  getUser(): Promise<{ id: string; email: string | null } | null>;
  /** Calls public.is_reviewer() as the signed-in user. */
  isReviewer(): Promise<boolean>;
  /** The same user-scoped client, for RLS-protected reads and review_report(). */
  reviewClient: ReviewDbClient;
};

type Dependencies = {
  authMode: ReviewerAuthMode;
  readCookie: (name: string) => string | undefined;
  /** The local demo store, or null when storage is not the demo store. */
  demoRepository: () => ReviewRepository | null;
  supabase: () => Promise<SupabaseSession>;
  now?: Date;
};

export const DEMO_REVIEWER: ReviewerIdentity = {
  id: "demo-reviewer",
  label: "Demo reviewer (shared access code)",
};

/**
 * Server-side reviewer authorisation. Every reviewer page and action calls this; nothing
 * on the client (no role selector, no hidden field) can grant access.
 */
export async function resolveReviewerAccess({
  authMode,
  readCookie,
  demoRepository,
  supabase,
  now = new Date(),
}: Dependencies): Promise<ReviewerAccess> {
  if (authMode.mode === "not_configured") {
    return { status: "not_configured", missing: authMode.missing };
  }

  if (authMode.mode === "demo-code") {
    const check = verifyDemoSessionToken(
      readCookie(DEMO_SESSION_COOKIE),
      demoSessionKey(authMode),
      now,
    );
    if (!check.valid) return { status: "signed_out", method: "demo-code" };
    const repository = demoRepository();
    if (!repository) return { status: "unavailable" };
    return {
      status: "authorised",
      method: "demo-code",
      reviewer: DEMO_REVIEWER,
      repository,
    };
  }

  try {
    const session = await supabase();
    const user = await session.getUser();
    if (!user) return { status: "signed_out", method: "supabase" };
    if (!(await session.isReviewer()))
      return { status: "forbidden", method: "supabase" };
    const reviewer: ReviewerIdentity = {
      id: user.id,
      label: user.email ?? `Reviewer ${user.id.slice(0, 8)}`,
    };
    return {
      status: "authorised",
      method: "supabase",
      reviewer,
      repository: new SupabaseReviewRepository(session.reviewClient, reviewer),
    };
  } catch {
    return { status: "unavailable" };
  }
}
