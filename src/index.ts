import { collect } from "./collect.js";
import { generateReport } from "./report.js";
import { loadConfig, assertUsable, describeConfig } from "./config.js";
import { appendRun } from "./history.js";
import * as fs from "node:fs";
import * as path from "node:path";

export { collect } from "./collect.js";

/**
 * CLI entry-point.
 *
 * Configuration comes from GitHub Actions variables (see docs/CONFIGURATION.md);
 * the owner and owner type may also be passed positionally, which overrides
 * `DEVEX_OWNER` / `DEVEX_OWNER_TYPE` for one-off local runs.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node dist/index.js [owner] [org|user]
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (process.argv[2]) config.owner = process.argv[2];
  const argType = process.argv[3];
  if (argType === "org" || argType === "user") config.ownerType = argType;
  assertUsable(config);

  console.log(`devex-metrics · ${describeConfig(config)}`);

  const metrics = await collect(config.owner, config.ownerType, { config });

  const dataDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const report = generateReport(metrics);
  const reportPath = path.join(dataDir, `${config.owner}-report.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to ${reportPath}`);

  if (config.history.enabled) {
    const historyDir = path.resolve(process.cwd(), config.history.dir);
    const result = appendRun(historyDir, metrics);
    console.log(
      `History updated in ${historyDir}: ` +
        `${result.rollupRowsWritten} rollup rows ` +
        `(${result.rollupRowsReplaced} replaced), ` +
        `${result.eventsAppended} new PR events ` +
        `(${result.eventsAlreadyPresent} already recorded)`
    );
  } else {
    console.log("History store disabled (DEVEX_HISTORY_ENABLED=false)");
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
