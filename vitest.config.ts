import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // Vitest defaults to adding its own "github-actions" reporter (a "Vitest
    // Test Report" job summary block) whenever GITHUB_ACTIONS=true. That fires
    // on every Vitest invocation — including each internal dry-run/mutant run
    // Stryker's vitest-runner performs during the mutation job — flooding the
    // step summary with redundant per-run reports. Pinning reporters here
    // suppresses that auto-detection so only our curated coverage-summary.mjs
    // / mutation-summary.mjs output appears in the step summary.
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "cobertura", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts"],
    },
  },
});
