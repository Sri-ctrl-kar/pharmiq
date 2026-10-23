import { z } from "zod";

// Empty strings in .env files are treated as "not set".
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const optionalUrl = optionalString.pipe(z.url().optional());

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  /** Directory for the local demonstration report store (no Supabase). */
  DEMO_DATA_DIR: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type FeatureFlags = {
  /** Supabase URL and anon key are present, so reports can be persisted. */
  supabase: boolean;
  /** Service role key is present for trusted server-side operations. */
  supabaseAdmin: boolean;
  /** Claude API key is present, so AI-assisted extraction can be offered. */
  aiExtraction: boolean;
};

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    // Report variable names only, never values.
    const names = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(
      `Invalid environment configuration: ${[...new Set(names)].join(", ")}`,
    );
  }
  return result.data;
}

export function getFeatureFlags(env: ServerEnv): FeatureFlags {
  const supabase = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return {
    supabase,
    supabaseAdmin: supabase && Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    aiExtraction: Boolean(env.ANTHROPIC_API_KEY),
  };
}
