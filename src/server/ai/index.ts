import "server-only";

import { getServerEnv } from "@/server/env";
import {
  ClaudeExtractionProvider,
  DEFAULT_EXTRACTION_MODEL,
  createClaudeClient,
} from "./claude-provider";
import type { ExtractionProvider } from "./provider";

let provider: ExtractionProvider | null | undefined;

/** Null when no Claude API key is configured: the form then works manually only. */
export function getExtractionProvider(): ExtractionProvider | null {
  if (provider !== undefined) return provider;
  const env = getServerEnv();
  provider = env.ANTHROPIC_API_KEY
    ? new ClaudeExtractionProvider(
        createClaudeClient(env.ANTHROPIC_API_KEY),
        env.ANTHROPIC_MODEL ?? DEFAULT_EXTRACTION_MODEL,
      )
    : null;
  return provider;
}

export function isAiExtractionConfigured(): boolean {
  return Boolean(getServerEnv().ANTHROPIC_API_KEY);
}
