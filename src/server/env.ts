import "server-only";

import {
  getFeatureFlags,
  parseServerEnv,
  type FeatureFlags,
  type ServerEnv,
} from "@/lib/env-schema";

let cached: ServerEnv | undefined;

/** Validated server environment. Importing this from a Client Component fails the build. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function getServerFeatureFlags(): FeatureFlags {
  return getFeatureFlags(getServerEnv());
}
