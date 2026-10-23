import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getServerEnv } from "@/server/env";

/**
 * Supabase client acting as the signed-in user (anon key + session cookies), so
 * row-level security applies. Never use the service-role key for reviewer access.
 */
export async function createSupabaseUserClient() {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured");
  }
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet)
              cookieStore.set(name, value, options);
          } catch {
            // Called during Server Component rendering, where cookies are read-only.
            // src/proxy.ts refreshes the session on the next request.
          }
        },
      },
    },
  );
}
