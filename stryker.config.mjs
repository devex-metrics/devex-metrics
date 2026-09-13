// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
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
    // Ratcheted just under the current baseline (58% as of 2026-09) so CI fails
    // on regressions without blocking on the pre-existing gap tracked by the
    // weekly mutation-improvement issue. Raise this as the score improves.
    break: 55,
  },
};
