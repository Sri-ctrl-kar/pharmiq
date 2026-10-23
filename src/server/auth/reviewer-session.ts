import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { getServerEnv } from "@/server/env";
import { LocalDemoReportRepository } from "@/server/reports/local-demo-repository";
import {
  getReportRepository,
  getStorageStatus,
} from "@/server/reports/storage";
import type { ReviewDbClient } from "@/server/review/supabase-review-repository";
import { resolveReviewerAccess, type ReviewerAccess } from "./reviewer-access";
import {
  resolveReviewerAuthMode,
  type ReviewerAuthMode,
} from "./reviewer-auth-mode";
import { createSupabaseUserClient } from "./supabase-server";

export function getReviewerAuthMode(): ReviewerAuthMode {
  return resolveReviewerAuthMode(getServerEnv(), getStorageStatus());
}

/** Server-side reviewer authorisation for the current request. */
export async function getReviewerAccess(): Promise<ReviewerAccess> {
  // Reviewer data is only ever rendered at request time — never prerendered or prefetched.
  await connection();
  const cookieStore = await cookies();
  return resolveReviewerAccess({
    authMode: getReviewerAuthMode(),
    readCookie: (name) => cookieStore.get(name)?.value,
    demoRepository: () => {
      const repository = getReportRepository();
      return repository instanceof LocalDemoReportRepository
        ? repository
        : null;
    },
    supabase: async () => {
      const client = await createSupabaseUserClient();
      return {
        getUser: async () => {
          const { data, error } = await client.auth.getUser();
          if (error || !data.user) return null;
          return { id: data.user.id, email: data.user.email ?? null };
        },
        isReviewer: async () => {
          const { data, error } = await client.rpc("is_reviewer");
          return !error && data === true;
        },
        reviewClient: client as unknown as ReviewDbClient,
      };
    },
  });
}
