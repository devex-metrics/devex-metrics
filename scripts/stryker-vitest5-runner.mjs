// @ts-check
// Local Stryker plugin: the stock "vitest" test runner, patched for vitest 5.
//
// @stryker-mutator/vitest-runner@10.0.0 narrows each mutant run to the tests
// covering that mutant by setting `testNamePattern` to the tests' names joined
// with a plain space ("suite test"). Vitest 5 matches that pattern against
// `fullTestName`, which joins the suite chain with " > " ("suite > test"), so
// every test inside a `describe` block is skipped on every mutant run. No
// test fails, every mutant "survives", and the reported score collapses to 0%.
//
// This wrapper rewrites the pattern just before each run so a space in it also
// accepts vitest 5's " > " separator. It can be deleted (and stryker.config.mjs
// pointed back at "@stryker-mutator/vitest-runner") once the upstream runner
// builds names that vitest 5 matches.
import { declareFactoryPlugin, PluginKind } from "@stryker-mutator/api/plugin";
import {
  strykerPlugins as upstreamPlugins,
  strykerValidationSchema,
} from "@stryker-mutator/vitest-runner";

const upstream = upstreamPlugins.find(
  (p) => p.kind === PluginKind.TestRunner && p.name === "vitest",
);
if (!upstream || !("factory" in upstream)) {
  throw new Error("@stryker-mutator/vitest-runner no longer exposes its 'vitest' factory plugin");
}
const upstreamFactory = upstream.factory;

/**
 * Let every literal space in a test-name pattern also match " > ".
 * @param {RegExp} pattern
 */
export function acceptSuiteSeparator(pattern) {
  return new RegExp(pattern.source.replace(/ /g, "(?: | > )"), pattern.flags);
}

/**
 * @param {import("@stryker-mutator/api/plugin").Injector} injector
 */
function createVitest5TestRunner(injector) {
  const runner = upstreamFactory(injector);
  const init = runner.init.bind(runner);
  runner.init = async () => {
    await init();
    const ctx = runner.ctx;
    const start = ctx.start.bind(ctx);
    ctx.start = (/** @type {string[] | undefined} */ files) => {
      for (const project of ctx.projects) {
        const pattern = project.config.testNamePattern;
        if (pattern instanceof RegExp) {
          project.config.testNamePattern = acceptSuiteSeparator(pattern);
        }
      }
      return start(files);
    };
  };
  return runner;
}
createVitest5TestRunner.inject = upstreamFactory.inject;

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.TestRunner, "vitest", createVitest5TestRunner),
];
export { strykerValidationSchema };
