import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseServerEnv } from "@/lib/env-schema";

/**
 * Refreshes Supabase Auth session cookies for reviewer routes so a signed-in reviewer
 * is not logged out when their access token expires. This is NOT authorisation: every
 * reviewer page and action re-checks access on the server. Does nothing unless Supabase
 * is fully configured.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let env;
  try {
    env = parseServerEnv(process.env);
  } catch {
    return response;
  }
  if (
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return response;
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet)
            response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers ?? {}))
            response.headers.set(key, value);
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/reviewer/:path*"],
};
