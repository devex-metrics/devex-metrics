import { collect } from "./collect.js";
import { generateReport } from "./report.js";
import { loadConfig, assertUsable, describeConfig } from "./config.js";
import {
  appendRun,
  loadEvents,
  loadRollup,
  mergeReconstructed,
  recomputeRollupFromEvents,
  rollupPath,
} from "./history.js";
import { runBackfill, describeBackfill } from "./backfill.js";
import * as fsp from "node:fs";
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

  if (!config.history.enabled) {
    console.log("History store disabled (DEVEX_HISTORY_ENABLED=false)");
    return;
  }

  const historyDir = path.resolve(process.cwd(), config.history.dir);
  const result = appendRun(historyDir, metrics);
  console.log(
    `History updated in ${historyDir}: ` +
      `${result.rollupRowsWritten} rollup rows ` +
      `(${result.rollupRowsReplaced} replaced), ` +
      `${result.eventsAppended} new PR events ` +
      `(${result.eventsAlreadyPresent} already recorded)`
  );

  const backfill = config.collection.backfill;
  if (!backfill.enabled) {
    console.log("Historical backfill disabled (DEVEX_BACKFILL_ENABLED=false)");
    return;
  }

  console.log(
    `\nWalking history backwards (budget: ${backfill.pagesPerRun} pages)…`
  );
  const targets = metrics.repos.map((r) => ({ fullName: r.fullName }));
  const backfillResult = await runBackfill(
    historyDir,
    config.owner,
    targets,
    backfill
  );
  console.log(describeBackfill(backfillResult, backfill));

  if (backfill.recomputeRollups && backfillResult.eventsAppended > 0) {
    rebuildHistoricalRollups(historyDir, config.owner);
  }
}

/**
 * Rebuild the reconstructed portion of the rollup from the event stream.
 *
 * Observed rows are preserved untouched — they carry the point-in-time fields
 * that no API can recover. Only dates that were never collected get filled in.
 */
function rebuildHistoricalRollups(historyDir: string, scope: string): void {
  const events = loadEvents(historyDir, scope);
  if (events.length === 0) return;

  const stored = loadRollup(historyDir, scope);
  const reconstructed = recomputeRollupFromEvents(events, scope);
  const merged = mergeReconstructed(stored, reconstructed);

  const observedCount = merged.filter((r) => !r.reconstructed).length;
  const filledCount = merged.length - observedCount;
  const oldest = merged[0]?.date;

  fsp.writeFileSync(
    rollupPath(historyDir, scope),
    merged.map((r) => JSON.stringify(r)).join("\n") + (merged.length > 0 ? "\n" : "")
  );
  console.log(
    `Rollup rebuilt: ${observedCount} observed + ${filledCount} reconstructed row(s)` +
      (oldest ? `, now reaching back to ${oldest}` : "")
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
