// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  // Wraps @stryker-mutator/vitest-runner; see the file for why.
  plugins: ["./scripts/stryker-vitest5-runner.mjs"],
  coverageAnalysis: "perTest",
  // dist/ is gitignored, so Stryker's sandbox (which respects .gitignore when
  // copying files) never receives it. build-pages.test.ts shells out to
  // dist/build-pages.js, so it needs a fresh build inside each sandbox.
  buildCommand: "npm run build",
  mutate: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/types.ts",          // pure type definitions
    "!src/index.ts",          // CLI entry point – hard to unit test
    "!src/save-fixture.ts",   // dev utility script
    "!src/build-pages.ts",    // tested via subprocess (execFileSync) – Stryker cannot track coverage
    "!src/collect-group.ts",  // CLI entry point – hard to unit test
    "!src/build-multi-site.ts", // CLI entry point – hard to unit test
  ],
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  thresholds: {
    high: 80,
    low: 60,
    // Ratchet just under the measured baseline (61.87% on 2026-09-27, the first full run
    // after scripts/stryker-vitest5-runner.mjs fixed the vitest 5 name-filter bug that had
    // been reporting every mutant as "survived"). Raise it as the score improves.
    break: 60,
  },
};
