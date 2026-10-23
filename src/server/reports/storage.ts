import "server-only";

import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { ServerEnv } from "@/lib/env-schema";
import { getServerEnv } from "@/server/env";
import { LocalDemoReportRepository } from "./local-demo-repository";
import type { ReportRepository } from "./repository";
import {
  SupabaseReportRepository,
  type RpcClient,
} from "./supabase-repository";

export type StorageStatus =
  | { mode: "supabase" }
  | { mode: "local-demo" }
  | { mode: "misconfigured"; missing: string[] };

const SUPABASE_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Supabase is used only when fully configured. With no Supabase variables at all, the
 * local demo store is used. A partial Supabase configuration fails closed instead of
 * silently writing reports to the demo store.
 */
export function resolveStorageStatus(env: ServerEnv): StorageStatus {
  const missing = SUPABASE_VARS.filter((name) => !env[name]);
  if (missing.length === 0) return { mode: "supabase" };
  if (missing.length === SUPABASE_VARS.length) return { mode: "local-demo" };
  return { mode: "misconfigured", missing };
}

export function getStorageStatus(): StorageStatus {
  return resolveStorageStatus(getServerEnv());
}

let repository: ReportRepository | undefined;

/** Returns null when storage is misconfigured; callers must treat that as a failed write. */
export function getReportRepository(): ReportRepository | null {
  if (repository) return repository;
  const env = getServerEnv();
  const status = resolveStorageStatus(env);

  if (status.mode === "misconfigured") return null;

  if (status.mode === "supabase") {
    const client = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL!,
      env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    repository = new SupabaseReportRepository(client as unknown as RpcClient);
  } else {
    const dir = env.DEMO_DATA_DIR ?? path.join(process.cwd(), ".data");
    repository = new LocalDemoReportRepository(
      path.join(dir, "demo-reports.json"),
    );
  }
  return repository;
}
