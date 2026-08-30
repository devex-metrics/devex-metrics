import { collect } from "./collect.js";
import { loadFixture, saveFixture } from "./cache.js";
import { loadConfig, assertUsable } from "./config.js";

/**
 * Collect metrics and save as a fixture file for local development.
 *
 * By default, skips collection if the fixture was already collected today.
 * Set FORCE_REFRESH=true or pass --force to always fetch fresh data.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node dist/save-fixture.js <owner> [org|user] [--force]
 *
 * After running:
 *   git add data/<owner>.fixture.json
 *   git commit -m "chore: update <owner> fixture data"
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (process.argv[2]) config.owner = process.argv[2];
  const argType = process.argv[3];
  if (argType === "org" || argType === "user") config.ownerType = argType;
  assertUsable(config);
  const owner = config.owner;
  const ownerType = config.ownerType;

  const forceRefresh =
    process.env.FORCE_REFRESH === "true" ||
    process.argv.includes("--force");

  if (!forceRefresh) {
    const existing = loadFixture(owner);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (existing?.collectedAt?.slice(0, 10) === todayStr) {
      console.log(
        `Fixture for ${owner} is already from today (${existing.collectedAt}). Skipping refresh.\n` +
        `Use --force or set FORCE_REFRESH=true to collect anyway.`
      );
      return;
    }
  }

  console.log(
    forceRefresh
      ? `Fetching fresh metrics for ${owner} (forced)…`
      : `Fetching fresh metrics for ${owner} (no fixture for today yet)…`
  );
  const metrics = await collect(owner, ownerType, { skipCache: true, config });

  saveFixture(owner, metrics);

  console.log(`\n  Commit this file to share data across all worktrees:\n`);
  console.log(`  git add data/${owner}.fixture.json`);
  console.log(`  git commit -m "chore: update ${owner} fixture data"`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
