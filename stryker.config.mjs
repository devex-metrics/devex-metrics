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
    // NOTE: cannot be a non-null number right now. @stryker-mutator/vitest-runner@10.0.0
    // crashes on every real mutant run against vitest@5.0.0 (bumped 2026-09-12, after the
    // last known-good 58% score in the #215 mutation-improvement issue, which predates it):
    //   TypeError: Converting circular structure to JSON
    //     property 'resolvedProjects' -> ... -> property 'viteConfig' -- property 'test' closes the circle
    //   at VitestTestRunner.init (node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js)
    // This makes every mutant report as "survived" (score ~0%), regardless of coverageAnalysis
    // mode ("perTest" or "all") — confirmed by isolated repro on a single trivial file. It is an
    // upstream vitest-runner/vitest 5 incompatibility, not a real regression in this codebase.
    // Re-enable a real break threshold once vitest-runner supports vitest 5 (or vitest is pinned
    // back to a 4.x line for mutation testing) and a fresh score has been measured.
    break: null,
  },
};
