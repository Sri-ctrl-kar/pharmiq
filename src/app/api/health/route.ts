import { connection } from "next/server";
import { getServerFeatureFlags } from "@/server/env";
import { getStorageStatus } from "@/server/reports/storage";

/** Reports which integrations are configured. Booleans and mode names only — never values. */
export async function GET() {
  // Read env at request time, not at build time.
  await connection();
  return Response.json({
    status: "ok",
    storage: getStorageStatus().mode,
    features: getServerFeatureFlags(),
  });
}
