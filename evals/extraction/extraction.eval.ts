import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { syntheticExtractionCases } from "@/lib/ai/synthetic-examples";
import {
  ClaudeExtractionProvider,
  DEFAULT_EXTRACTION_MODEL,
  createClaudeClient,
} from "@/server/ai/claude-provider";
import { runExtraction } from "@/server/ai/extraction-service";
import { scoreCase, type CaseScore } from "./score";

/**
 * Live evaluation against the Claude API on the SYNTHETIC test set.
 * Run: ANTHROPIC_API_KEY=... npm run eval:extraction
 * Costs real money (one request per case). Skipped when no key is set.
 */
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_EXTRACTION_MODEL;

describe.skipIf(!apiKey)(
  `extraction eval (${model}, ${syntheticExtractionCases.length} synthetic cases)`,
  () => {
    it(
      "runs every case and reports field checks and silent errors",
      async () => {
        const provider = new ClaudeExtractionProvider(
          createClaudeClient(apiKey!),
          model,
        );
        const scores: (CaseScore & { model?: string })[] = [];
        for (const testCase of syntheticExtractionCases) {
          const response = await runExtraction(testCase.description, provider);
          scores.push({
            ...scoreCase(testCase, response),
            model: response.ok ? response.model : undefined,
          });
        }

        const passed = scores.reduce((sum, s) => sum + s.passed, 0);
        const total = scores.reduce((sum, s) => sum + s.total, 0);
        const silent = scores.flatMap((s) =>
          s.silentErrors.map((e) => `${s.caseId}: ${e}`),
        );
        console.table(
          scores.map((s) => ({
            case: s.caseId,
            checks: `${s.passed}/${s.total}`,
            silentErrors: s.silentErrors.length,
          })),
        );
        for (const s of scores) {
          for (const check of s.checks.filter((c) => !c.pass))
            console.log(`  ✗ ${s.caseId} ${check.path}: ${check.detail}`);
        }
        console.log(
          `Field checks passed: ${passed}/${total}. Silent errors: ${silent.length}.`,
        );
        silent.forEach((line) => console.log(`  ! ${line}`));

        await mkdir("evals/extraction/results", { recursive: true });
        await writeFile(
          `evals/extraction/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
          JSON.stringify(
            { model, passed, total, silentErrors: silent, scores },
            null,
            2,
          ),
        );
        expect(scores).toHaveLength(syntheticExtractionCases.length);
      },
      15 * 60_000,
    );
  },
);

describe.skipIf(Boolean(apiKey))("extraction eval", () => {
  it("is skipped: set ANTHROPIC_API_KEY to run it against the live API", () => {
    expect(apiKey).toBeUndefined();
  });
});
