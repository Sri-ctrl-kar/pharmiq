import type {
  ExtractionErrorCode,
  ExtractionResponse,
} from "@/lib/ai/extraction-schema";
import { minimiseForAi } from "@/lib/reports/privacy";
import { ExtractionProviderError, type ExtractionProvider } from "./provider";
import { verifyExtraction } from "./verify-extraction";

export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 4000;
/** Overall deadline for one extraction, including the SDK's single retry. */
export const EXTRACTION_DEADLINE_MS = 60_000;

export const extractionErrorMessages: Record<ExtractionErrorCode, string> = {
  not_configured:
    "AI assistance is not available on this server. Please fill in the form yourself — it works the same way.",
  invalid_input: `Write at least ${MIN_DESCRIPTION_LENGTH} characters (up to ${MAX_DESCRIPTION_LENGTH}) before using AI assistance.`,
  forbidden: "This request was blocked.",
  rate_limited:
    "Too many AI requests just now. Wait a minute and try again, or fill in the form yourself.",
  timeout:
    "The AI service took too long to respond. Try again, or fill in the form yourself.",
  provider_unavailable:
    "The AI service is unavailable right now. Try again shortly, or fill in the form yourself.",
  refused:
    "The AI service could not process this description. Please fill in the form yourself.",
  invalid_response:
    "The AI service returned an answer we could not check, so nothing was filled in. Try again, or fill in the form yourself.",
};

export function extractionError(
  code: ExtractionErrorCode,
  retryable: boolean,
): Extract<ExtractionResponse, { ok: false }> {
  return {
    ok: false,
    error: { code, message: extractionErrorMessages[code], retryable },
  };
}

type Options = {
  deadlineMs?: number;
  now?: Date;
  /** Receives error categories only — never description text. */
  logError?: (message: string) => void;
};

/**
 * Minimise → call provider (with deadline) → verify. Returns either verified suggestions
 * or a safe error; never partially verified output.
 */
export async function runExtraction(
  description: unknown,
  provider: ExtractionProvider | null,
  {
    deadlineMs = EXTRACTION_DEADLINE_MS,
    now = new Date(),
    logError = (message) => console.error(message),
  }: Options = {},
): Promise<ExtractionResponse> {
  const text = typeof description === "string" ? description.trim() : "";
  if (
    text.length < MIN_DESCRIPTION_LENGTH ||
    text.length > MAX_DESCRIPTION_LENGTH
  ) {
    return extractionError("invalid_input", false);
  }
  if (!provider) return extractionError("not_configured", false);

  const minimised = minimiseForAi(text);

  let result;
  try {
    result = await provider.extract(
      minimised.text,
      AbortSignal.timeout(deadlineMs),
    );
  } catch (error) {
    const failure =
      error instanceof ExtractionProviderError
        ? error
        : new ExtractionProviderError(
            "provider_unavailable",
            true,
            "Unexpected failure",
          );
    logError(`[ai-extract] ${failure.code}: ${failure.message}`);
    return extractionError(failure.code, failure.retryable);
  }

  const verified = verifyExtraction(result.output, minimised.text, now);
  if (!verified.ok) {
    logError("[ai-extract] invalid_response: output failed schema validation");
    return extractionError("invalid_response", true);
  }

  return {
    ok: true,
    extraction: verified.extraction,
    redactions: minimised.redactions,
    model: result.model,
  };
}
