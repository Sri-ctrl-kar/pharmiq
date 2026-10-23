"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRateLimiter } from "@/server/ai/rate-limit";
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_COOKIE_PATH,
} from "@/server/auth/demo-session";
import {
  getReviewerAccess,
  getReviewerAuthMode,
} from "@/server/auth/reviewer-session";
import { createSupabaseUserClient } from "@/server/auth/supabase-server";
import {
  handleDemoSignIn,
  handleStatusChange,
  type ReviewActionState,
} from "@/server/review/handlers";

// Demo-grade brute-force protection, in memory per server instance. The per-client key
// comes from X-Forwarded-For, which a client can spoof unless a trusted proxy sets it,
// so a server-wide cap also bounds total guesses (and the per-client map's growth).
const signInLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
const globalSignInLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

async function signInAllowed() {
  if (!globalSignInLimiter("all").allowed) return false;
  return signInLimiter(await clientKey()).allowed;
}

async function clientKey() {
  return (
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}

/** Reviewer-only. Authorisation is re-checked here on every call. */
export async function updateReportStatusAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const result = await handleStatusChange(formData, await getReviewerAccess());
  if (result.status === "success") refresh();
  return result;
}

export type SignInState = { message: string | null };

const credentials = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const authMode = getReviewerAuthMode();
  const allowed = await signInAllowed();

  if (authMode.mode === "demo-code") {
    const result = handleDemoSignIn(formData, authMode, { allowed });
    if (!result.ok) return { message: result.message };
    (await cookies()).set(DEMO_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: DEMO_SESSION_COOKIE_PATH,
      maxAge: result.maxAgeSeconds,
    });
    redirect("/reviewer");
  }

  if (authMode.mode === "supabase") {
    if (!allowed)
      return { message: "Too many attempts. Wait a minute and try again." };
    const parsed = credentials.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success)
      return { message: "Enter your email address and password." };
    const supabase = await createSupabaseUserClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { message: "Email or password is not correct." };
    redirect("/reviewer");
  }

  return { message: "Reviewer sign-in is not configured on this server." };
}

export async function signOutAction(): Promise<void> {
  const authMode = getReviewerAuthMode();
  (await cookies()).delete({
    name: DEMO_SESSION_COOKIE,
    path: DEMO_SESSION_COOKIE_PATH,
  });
  if (authMode.mode === "supabase") {
    const supabase = await createSupabaseUserClient();
    await supabase.auth.signOut();
  }
  redirect("/reviewer/sign-in");
}
