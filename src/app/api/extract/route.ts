import type {
  ExtractionErrorCode,
  ExtractionResponse,
} from "@/lib/ai/extraction-schema";
import { getExtractionProvider } from "@/server/ai";
import { extractionError, runExtraction } from "@/server/ai/extraction-service";
import { createRateLimiter } from "@/server/ai/rate-limit";

const MAX_BODY_CHARS = 20_000;

// Demo-grade protection of API spend: per client and for the whole instance.
const perClient = createRateLimiter({ limit: 5, windowMs: 60_000 });
const perInstance = createRateLimiter({ limit: 200, windowMs: 60 * 60_000 });

const statusFor: Record<ExtractionErrorCode, number> = {
  invalid_input: 400,
  forbidden: 403,
  refused: 422,
  rate_limited: 429,
  provider_unavailable: 502,
  invalid_response: 502,
  not_configured: 503,
  timeout: 504,
};

function respond(
  body: ExtractionResponse,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status: body.ok ? 200 : statusFor[body.error.code],
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/**
 * POST { description } → verified extraction suggestions.
 * Only the description is accepted; it is minimised before leaving the server and is
 * never logged or stored.
 */
export async function POST(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return respond(extractionError("invalid_input", false));
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return respond(extractionError("forbidden", false));
  }

  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  for (const check of [perClient(client), perInstance("all")]) {
    if (!check.allowed) {
      return respond(extractionError("rate_limited", true), {
        "Retry-After": String(check.retryAfterSeconds),
      });
    }
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS)
    return respond(extractionError("invalid_input", false));
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return respond(extractionError("invalid_input", false));
  }
  const description =
    body && typeof body === "object" && "description" in body
      ? body.description
      : undefined;

  return respond(await runExtraction(description, getExtractionProvider()));
}
