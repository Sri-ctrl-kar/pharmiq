import type { ExtractionErrorCode } from "@/lib/ai/extraction-schema";

export type ProviderResult = {
  /** Parsed JSON from the model. Untrusted until verified. */
  output: unknown;
  /** Model that actually served the request (may differ after a fallback). */
  model: string;
};

/** Anything that can turn minimised description text into raw extraction JSON. */
export interface ExtractionProvider {
  extract(text: string, signal: AbortSignal): Promise<ProviderResult>;
}

/** A provider failure with a safe, user-facing category. Messages contain no report text. */
export class ExtractionProviderError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    readonly retryable: boolean,
    detail: string,
  ) {
    super(detail);
    this.name = "ExtractionProviderError";
  }
}
