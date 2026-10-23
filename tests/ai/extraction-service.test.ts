import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticExtractionCases } from "@/lib/ai/synthetic-examples";
import { findPossibleIdentifiers, minimiseForAi } from "@/lib/reports/privacy";
import {
  ClaudeExtractionProvider,
  DEFAULT_EXTRACTION_MODEL,
  toProviderError,
} from "@/server/ai/claude-provider";
import { runExtraction } from "@/server/ai/extraction-service";
import {
  ExtractionProviderError,
  type ExtractionProvider,
} from "@/server/ai/provider";
import { asEnumField, medicine, reported, simulatedOutput } from "./helpers";

const NOW = new Date("2026-10-23T06:00:00Z");
const silent = () => {};
const caseText = (id: string) =>
  syntheticExtractionCases.find((c) => c.id === id)!.description;

function providerReturning(
  output: unknown,
): ExtractionProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async extract(text) {
      calls.push(text);
      return { output, model: "claude-opus-5-5" };
    },
  };
}

function providerFailing(error: unknown): ExtractionProvider {
  return {
    async extract() {
      throw error;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("data minimisation", () => {
  it("removes names, phone numbers, emails, ID numbers, links and PIN codes", () => {
    const { text, redactions } = minimiseForAi(
      "My name is Ravi Kumar, Dr. Sharma saw me. Call 98765 43210 or 080-23456789, mail ravi@example.com, " +
        "Aadhaar 1234 5678 9012, PAN ABCDE1234F, see https://example.com/x, pin code 560001. Took amoxicillin 500 mg on 2 September 2026.",
    );
    for (const leaked of [
      "Ravi",
      "Kumar",
      "Sharma",
      "98765",
      "23456789",
      "ravi@",
      "1234 5678",
      "ABCDE1234F",
      "example.com",
      "560001",
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain("Took amoxicillin 500 mg on 2 September 2026.");
    expect(
      Object.fromEntries(redactions.map((r) => [r.kind, r.count])),
    ).toEqual({
      email: 1,
      link: 1,
      id_number: 2,
      phone: 2,
      name: 2,
      postcode: 1,
    });
  });

  it("leaves clinical details, doses and dates intact", () => {
    const clinical =
      "Paracetamol 650 mg started 03/04/2026, 2 tablets every 6 hours for 10 days.";
    expect(minimiseForAi(clinical)).toEqual({ text: clinical, redactions: [] });
  });

  it("meets the redaction expectations of the synthetic test set", () => {
    for (const testCase of syntheticExtractionCases) {
      const { redactions } = minimiseForAi(testCase.description);
      for (const expected of testCase.expected.redactions ?? []) {
        expect(
          redactions.find((r) => r.kind === expected.kind)?.count ?? 0,
        ).toBeGreaterThanOrEqual(expected.count);
      }
    }
  });

  it("keeps warning about identifiers in the form", () => {
    expect(findPossibleIdentifiers("call 98765 43210")).toEqual([
      "a phone number",
    ]);
  });
});

describe("runExtraction", () => {
  const source = caseText("identifiers-removed");
  const goodOutput = simulatedOutput({
    medicines: [
      medicine({
        name: reported("carbamazepine", "carbamazepine 200 mg tablets"),
      }),
    ],
    medical_attention: asEnumField(
      reported("hospitalised", "was admitted for two days"),
    ),
  });

  it("sends only the minimised description and returns verified suggestions", async () => {
    const provider = providerReturning(goodOutput);
    const result = await runExtraction(source, provider, { now: NOW });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).not.toMatch(/Ravi|Kumar|98765/);
    expect(provider.calls[0]).toContain("[PHONE REMOVED]");
    expect(result).toMatchObject({
      ok: true,
      model: "claude-opus-5-5",
      redactions: expect.arrayContaining([
        { kind: "phone", count: 1 },
        { kind: "name", count: 1 },
      ]),
    });
  });

  it("rejects input that is too short, too long or not text, without calling the provider", async () => {
    const provider = providerReturning(goodOutput);
    for (const input of [
      "too short",
      "x".repeat(4001),
      42,
      null,
      { description: source },
    ]) {
      expect(await runExtraction(input, provider)).toMatchObject({
        ok: false,
        error: { code: "invalid_input", retryable: false },
      });
    }
    expect(provider.calls).toHaveLength(0);
  });

  it("falls back to manual entry when AI is not configured", async () => {
    expect(await runExtraction(source, null)).toMatchObject({
      ok: false,
      error: {
        code: "not_configured",
        retryable: false,
        message: expect.stringMatching(/fill in the form yourself/),
      },
    });
  });

  it("rejects malformed model output as a whole, with a retryable error", async () => {
    const logError = vi.fn();
    const result = await runExtraction(
      source,
      providerReturning({ medicines: "carbamazepine" }),
      { logError },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_response", retryable: true },
    });
    expect(logError.mock.calls[0][0]).not.toMatch(/carbamazepine|Ravi/);
  });

  it.each([
    ["timeout", true],
    ["rate_limited", true],
    ["provider_unavailable", true],
    ["refused", false],
    ["not_configured", false],
  ] as const)(
    "maps a %s provider failure to a safe error",
    async (code, retryable) => {
      const result = await runExtraction(
        source,
        providerFailing(new ExtractionProviderError(code, retryable, "detail")),
        { logError: silent },
      );
      expect(result).toMatchObject({ ok: false, error: { code, retryable } });
    },
  );

  it("treats unexpected exceptions as a retryable provider failure", async () => {
    const result = await runExtraction(
      source,
      providerFailing(new TypeError("boom")),
      { logError: silent },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "provider_unavailable", retryable: true },
    });
  });

  it("enforces an overall deadline", async () => {
    const hanging: ExtractionProvider = {
      extract: (_text, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    };
    const result = await runExtraction(
      source,
      {
        extract: async (text, signal) => {
          try {
            return await hanging.extract(text, signal);
          } catch (error) {
            throw toProviderError(error);
          }
        },
      },
      { deadlineMs: 30, logError: silent },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "timeout", retryable: true },
    });
  });
});

describe("ClaudeExtractionProvider", () => {
  function fakeClient(response: Partial<Anthropic.Beta.BetaMessage> | Error) {
    const create = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return {
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        content: [],
        ...response,
      };
    });
    return { client: { beta: { messages: { create } } } as never, create };
  }
  const textBlock = (text: string) =>
    [{ type: "text", text, citations: null }] as never;
  const signal = new AbortController().signal;

  it("sends a strict structured-output request with only the description", async () => {
    const { client, create } = fakeClient({
      content: textBlock(JSON.stringify(simulatedOutput())),
    });
    const provider = new ClaudeExtractionProvider(client);
    const result = await provider.extract(
      "Rash after amoxicillin 500 mg.",
      signal,
    );

    expect(result).toEqual({
      output: simulatedOutput(),
      model: "claude-opus-5-5",
    });
    const [params, options] = create.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { signal: AbortSignal },
    ];
    expect(params.model).toBe(DEFAULT_EXTRACTION_MODEL);
    expect(options.signal).toBe(signal);
    expect(params.output_config).toMatchObject({
      effort: "medium",
      format: {
        type: "json_schema",
        schema: { type: "object", additionalProperties: false },
      },
    });
    expect(params).toMatchObject({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(params).not.toHaveProperty("thinking");
    const messages = params.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain(
      "<description>\nRash after amoxicillin 500 mg.\n</description>",
    );
    expect(String(params.system)).toMatch(/Do not diagnose/);
  });

  it("omits refusal fallbacks for models that do not support them", async () => {
    const { client, create } = fakeClient({ content: textBlock("{}") });
    await new ClaudeExtractionProvider(client, "claude-haiku-5-5").extract(
      "text",
      signal,
    );
    expect((create.mock.calls[0] as unknown[])[0]).not.toHaveProperty(
      "fallbacks",
    );
  });

  it.each([
    [
      "a refusal",
      { stop_reason: "refusal" as const, content: textBlock("{}") },
      "refused",
    ],
    [
      "truncated output",
      { stop_reason: "max_tokens" as const, content: textBlock('{"medi') },
      "invalid_response",
    ],
    ["no text block", { content: [] }, "invalid_response"],
    [
      "non-JSON text",
      { content: textBlock("Here are the fields: amoxicillin") },
      "invalid_response",
    ],
  ])("handles %s", async (_label, response, code) => {
    const { client } = fakeClient(response);
    await expect(
      new ClaudeExtractionProvider(client).extract("text", signal),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    [
      Anthropic.APIError.generate(
        401,
        { error: { message: "bad key" } },
        "bad key",
        new Headers(),
      ),
      "not_configured",
      false,
    ],
    [
      Anthropic.APIError.generate(
        429,
        { error: { message: "slow" } },
        "slow",
        new Headers(),
      ),
      "rate_limited",
      true,
    ],
    [
      Anthropic.APIError.generate(
        529,
        { error: { message: "overloaded" } },
        "overloaded",
        new Headers(),
      ),
      "provider_unavailable",
      true,
    ],
    [
      Anthropic.APIError.generate(
        400,
        { error: { message: "bad" } },
        "bad",
        new Headers(),
      ),
      "provider_unavailable",
      false,
    ],
    [new Anthropic.APIConnectionTimeoutError(), "timeout", true],
    [
      new Anthropic.APIConnectionError({ message: "down" }),
      "provider_unavailable",
      true,
    ],
    [new Anthropic.APIUserAbortError(), "timeout", true],
  ])("maps SDK error %# to %s", async (error, code, retryable) => {
    const { client } = fakeClient(error as Error);
    await expect(
      new ClaudeExtractionProvider(client).extract("text", signal),
    ).rejects.toMatchObject({ code, retryable });
  });
});
