import { collect } from "./collect.js";
import { saveFixture } from "./cache.js";

/**
 * Fetch fresh metrics from GitHub (bypassing any local cache) and save
 * the result as a fixture file that can be committed to the repo.
 *
 * All worktrees that have this file will automatically use it for local
 * development without needing API access.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node dist/save-fixture.js <owner> [org|user]
 *
 * After running:
 *   git add data/<owner>.fixture.json
 *   git commit -m "chore: update <owner> fixture data"
 */
async function main(): Promise<void> {
  const owner = process.argv[2];
  const ownerType = (process.argv[3] ?? "org") as "org" | "user";

  if (!owner) {
    console.error("Usage: save-fixture <owner> [org|user]");
    process.exit(1);
  }

  console.log(`Fetching fresh metrics for ${owner} (bypassing cache)…`);
  const metrics = await collect(owner, ownerType, { skipCache: true });

  saveFixture(owner, metrics);

  console.log(`\n✓ Fixture saved to data/${owner}.fixture.json`);
  console.log(`  Commit this file to share data across all worktrees:\n`);
  console.log(`  git add data/${owner}.fixture.json`);
  console.log(`  git commit -m "chore: update ${owner} fixture data"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
