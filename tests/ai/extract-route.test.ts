import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionProvider } from "@/server/ai/provider";
import { simulatedOutput } from "./helpers";

const state = vi.hoisted(() => ({
  provider: null as ExtractionProvider | null,
}));
vi.mock("@/server/ai", () => ({ getExtractionProvider: () => state.provider }));

const DESCRIPTION = "Itchy rash two days after starting amoxicillin 500 mg.";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// A fresh module per test resets the in-memory rate limiter.
async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/extract/route");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.provider = {
    extract: vi.fn(async () => ({
      output: simulatedOutput(),
      model: "claude-opus-5-5",
    })),
  };
});

describe("POST /api/extract", () => {
  it("returns verified suggestions and disables caching", async () => {
    const { POST } = await loadRoute();
    const response = await POST(post({ description: DESCRIPTION }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      model: "claude-opus-5-5",
    });
  });

  it("returns 503 and a manual-entry message when AI is not configured", async () => {
    state.provider = null;
    const { POST } = await loadRoute();
    const response = await POST(post({ description: DESCRIPTION }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "not_configured" },
    });
  });

  it("rejects non-JSON requests, bad bodies and oversized bodies", async () => {
    const { POST } = await loadRoute();
    expect(
      (
        await POST(
          post({ description: DESCRIPTION }, { "content-type": "text/plain" }),
        )
      ).status,
    ).toBe(400);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post({ text: DESCRIPTION }))).status).toBe(400);
    expect((await POST(post({ description: "x".repeat(25_000) }))).status).toBe(
      400,
    );
    expect(state.provider!.extract).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      post({ description: DESCRIPTION }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("rate limits each client and reports when to retry", async () => {
    const { POST } = await loadRoute();
    for (let i = 0; i < 5; i++) {
      expect((await POST(post({ description: DESCRIPTION }))).status).toBe(200);
    }
    const limited = await POST(post({ description: DESCRIPTION }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different client is unaffected.
    expect(
      (
        await POST(
          post(
            { description: DESCRIPTION },
            { "x-forwarded-for": "198.51.100.1" },
          ),
        )
      ).status,
    ).toBe(200);
  });

  it("maps provider failures to HTTP status codes", async () => {
    const { POST } = await loadRoute();
    // Import after the module reset so the route and the test share one class.
    const { ExtractionProviderError } = await import("@/server/ai/provider");
    const cases = [
      ["timeout", 504],
      ["provider_unavailable", 502],
      ["refused", 422],
    ] as const;
    for (const [code, status] of cases) {
      state.provider = {
        extract: async () => {
          throw new ExtractionProviderError(code, code !== "refused", "detail");
        },
      };
      const response = await POST(
        post({ description: DESCRIPTION }, { "x-forwarded-for": code }),
      );
      expect(response.status).toBe(status);
    }
  });
});
