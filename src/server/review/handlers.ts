import { statusChangeSchema, reviewerStatusLabels } from "@/lib/review/status";
import { toFieldErrors, type FieldErrors } from "@/lib/reports/schema";
import type { ReviewerAccess } from "@/server/auth/reviewer-access";
import {
  accessCodeMatches,
  createDemoSessionToken,
  DEMO_SESSION_TTL_SECONDS,
  demoSessionKey,
} from "@/server/auth/demo-session";
import type { ReviewerAuthMode } from "@/server/auth/reviewer-auth-mode";

export type ReviewActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: FieldErrors };

const NOT_AUTHORISED =
  "You are not signed in as a reviewer, so nothing was changed. Sign in and try again.";

/**
 * Reviewer status change. Authorisation is checked first, then the untrusted form input
 * is validated; storage re-checks the transition and the expected current status.
 */
export async function handleStatusChange(
  formData: FormData,
  access: ReviewerAccess,
  logError: (message: string) => void = (message) => console.error(message),
): Promise<ReviewActionState> {
  if (access.status !== "authorised") {
    return { status: "error", message: NOT_AUTHORISED };
  }

  const parsed = statusChangeSchema.safeParse({
    reportId: formData.get("reportId"),
    expectedStatus: formData.get("expectedStatus"),
    nextStatus: formData.get("nextStatus"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "The status was not changed. Check the highlighted fields.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  try {
    const result = await access.repository.updateStatus(
      parsed.data,
      access.reviewer,
    );
    if (result.ok) {
      return {
        status: "success",
        message: `Status changed to “${reviewerStatusLabels[result.report.status]}”.`,
      };
    }
    const messages: Record<typeof result.reason, string> = {
      conflict:
        "This report's status was changed by someone else since you opened it. Nothing was changed — reload to see the latest status.",
      not_found: "This report could not be found. Nothing was changed.",
      invalid_transition:
        "That status change is not allowed. Nothing was changed.",
      forbidden: NOT_AUTHORISED,
    };
    return { status: "error", message: messages[result.reason] };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    logError(
      `[review] status update failed: ${error instanceof Error ? error.name : "unknown"}${typeof code === "string" ? ` (${code})` : ""}`,
    );
    return {
      status: "error",
      message:
        "The status could not be saved because of a problem on our side. Nothing was changed. Try again shortly.",
    };
  }
}

export type DemoSignInResult =
  | { ok: true; token: string; maxAgeSeconds: number }
  | { ok: false; message: string };

export function handleDemoSignIn(
  formData: FormData,
  authMode: ReviewerAuthMode,
  { allowed, now = new Date() }: { allowed: boolean; now?: Date },
): DemoSignInResult {
  if (authMode.mode !== "demo-code") {
    return {
      ok: false,
      message: "Demo access is not available on this server.",
    };
  }
  if (!allowed) {
    return {
      ok: false,
      message: "Too many attempts. Wait a minute and try again.",
    };
  }
  const code = formData.get("accessCode");
  if (typeof code !== "string" || code.length === 0 || code.length > 200) {
    return { ok: false, message: "Enter the access code." };
  }
  if (!accessCodeMatches(code, authMode.code, authMode.secret)) {
    return { ok: false, message: "That access code is not correct." };
  }
  return {
    ok: true,
    token: createDemoSessionToken(demoSessionKey(authMode), now),
    maxAgeSeconds: DEMO_SESSION_TTL_SECONDS,
  };
}
