// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/types.ts",          // pure type definitions
    "!src/index.ts",          // CLI entry point – hard to unit test
    "!src/save-fixture.ts",   // dev utility script
    "!src/build-pages.ts",    // tested via subprocess (execFileSync) – Stryker cannot track coverage
  ],
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null, // report results without failing the build on score alone
  },
};
