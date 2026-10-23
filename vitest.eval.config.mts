import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live evaluations that call external APIs. Not part of `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 15 * 60_000,
  },
});
