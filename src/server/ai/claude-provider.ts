import Anthropic from "@anthropic-ai/sdk";
import { extractionJsonSchema } from "@/lib/ai/extraction-schema";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from "./prompt";
import {
  ExtractionProviderError,
  type ExtractionProvider,
  type ProviderResult,
} from "./provider";

export const DEFAULT_EXTRACTION_MODEL = "claude-opus-5-5";

/** Per-attempt HTTP timeout. The service also enforces an overall deadline. */
export const PROVIDER_TIMEOUT_MS = 45_000;

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 1 });
}

type BetaMessagesClient = {
  beta: { messages: Pick<Anthropic["beta"]["messages"], "create"> };
};

/**
 * Calls Claude with a strict JSON-schema structured output. Only the minimised
 * description is sent: no patient details, report ID or reporter information.
 */
export class ClaudeExtractionProvider implements ExtractionProvider {
  constructor(
    private readonly client: BetaMessagesClient,
    readonly model: string = DEFAULT_EXTRACTION_MODEL,
  ) {}

  async extract(text: string, signal: AbortSignal): Promise<ProviderResult> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [
            { role: "user", content: buildExtractionUserMessage(text) },
          ],
          output_config: {
            effort: "medium",
            format: { type: "json_schema", schema: extractionJsonSchema() },
          },
          ...(FALLBACK_MODELS.has(this.model)
            ? {
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default" as const,
              }
            : {}),
        },
        { signal },
      );
    } catch (error) {
      throw toProviderError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new ExtractionProviderError(
        "refused",
        false,
        "Model declined the request",
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new ExtractionProviderError(
        "invalid_response",
        true,
        "Response truncated (max_tokens)",
      );
    }

    const block = response.content.find(
      (item): item is Anthropic.Beta.BetaTextBlock => item.type === "text",
    );
    if (!block) {
      throw new ExtractionProviderError(
        "invalid_response",
        true,
        "No text block in response",
      );
    }
    try {
      return { output: JSON.parse(block.text), model: response.model };
    } catch {
      throw new ExtractionProviderError(
        "invalid_response",
        true,
        "Response was not valid JSON",
      );
    }
  }
}

/** Most specific first, so retryable and non-retryable failures stay distinct. */
export function toProviderError(error: unknown): ExtractionProviderError {
  if (error instanceof ExtractionProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError || isAbortError(error)) {
    return new ExtractionProviderError(
      "timeout",
      true,
      "Request aborted at deadline",
    );
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ExtractionProviderError("timeout", true, "Request timed out");
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ExtractionProviderError(
      "not_configured",
      false,
      `Credential rejected (${error.status})`,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ExtractionProviderError(
      "rate_limited",
      true,
      "Provider rate limit (429)",
    );
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return new ExtractionProviderError(
      "provider_unavailable",
      false,
      `Request rejected (${error.status})`,
    );
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ExtractionProviderError(
      "provider_unavailable",
      true,
      `Provider error (${error.status})`,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ExtractionProviderError(
      "provider_unavailable",
      true,
      "Connection failed",
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new ExtractionProviderError(
      "provider_unavailable",
      true,
      `Provider error (${error.status ?? "unknown"})`,
    );
  }
  return new ExtractionProviderError(
    "provider_unavailable",
    true,
    "Unexpected provider failure",
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
