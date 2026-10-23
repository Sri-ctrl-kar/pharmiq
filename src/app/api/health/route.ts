import { connection } from "next/server";
import { getServerFeatureFlags } from "@/server/env";

/** Reports which integrations are configured. Booleans only — never values. */
export async function GET() {
  // Read env at request time, not at build time.
  await connection();
  return Response.json({ status: "ok", features: getServerFeatureFlags() });
}
