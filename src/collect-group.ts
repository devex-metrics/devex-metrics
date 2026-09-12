import { collectGroup } from "./collect.js";
import { discoverLocalRepos } from "./local-repo-discovery.js";
import { generateReport } from "./report.js";
import { slugifyDatasetKey } from "./dataset-key.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * CLI entry-point for collecting metrics for a locally-defined "group": an
 * explicit list of repos discovered from a folder of local git checkouts,
 * rather than a full org/user listing.
 *
 * The collected data is stored under its own local cache key
 * (`data/<slug>.json`), completely separate from any owner-based dataset —
 * running this never overwrites existing data.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node dist/collect-group.js <groupName> <folderPath>
 */
async function main(): Promise<void> {
  const groupName = process.argv[2];
  const folderPath = process.argv[3];

  if (!groupName || !folderPath) {
    console.error("Usage: collect-group <groupName> <folderPath>");
    process.exit(1);
  }

  const resolvedFolder = path.resolve(folderPath);
  if (!fs.existsSync(resolvedFolder) || !fs.statSync(resolvedFolder).isDirectory()) {
    console.error(`Folder not found: ${resolvedFolder}`);
    process.exit(1);
  }

  const discovered = discoverLocalRepos(resolvedFolder);
  if (discovered.length === 0) {
    console.error(`No GitHub-backed git repositories found under ${resolvedFolder}`);
    process.exit(1);
  }

  console.log(`Discovered ${discovered.length} repo(s) in ${resolvedFolder}:`);
  for (const repo of discovered) {
    console.log(`  → ${repo.owner}/${repo.name} (${repo.localPath})`);
  }

  const metrics = await collectGroup(groupName, discovered);
  const slug = slugifyDatasetKey(groupName);

  const report = generateReport(metrics);
  const reportPath = path.resolve(process.cwd(), "data", `${slug}-report.md`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to ${reportPath}`);
  console.log(`JSON data cached at data/${slug}.json`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
