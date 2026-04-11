import { collect } from "./collect.js";
import { generateReport } from "./report.js";
import * as fs from "node:fs";
import * as path from "node:path";

export { collect } from "./collect.js";

/**
 * CLI entry-point.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node dist/index.js <owner> [org|user]
 */
async function main(): Promise<void> {
  const owner = process.argv[2];
  const ownerType = (process.argv[3] ?? "org") as "org" | "user";

  if (!owner) {
    console.error("Usage: devex-metrics <owner> [org|user]");
    process.exit(1);
  }

  const metrics = await collect(owner, ownerType);
  const report = generateReport(metrics);
  const reportPath = path.resolve(process.cwd(), "data", `${owner}-report.md`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to ${reportPath}`);

  // Also write JSON
  const jsonPath = path.resolve(process.cwd(), "data", `${owner}.json`);
  console.log(`JSON data cached at ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
