#!/usr/bin/env node
/**
 * Seed the history store from the fixture snapshots already in git history.
 *
 * Before the history store existed, the collect workflow committed a full
 * snapshot to the default branch on most days. Each of those commits is a
 * daily observation — including the rolling-window metrics (90-day committer
 * and reviewer counts, 30-day agent metrics) that the live collector cannot
 * reconstruct retroactively. This replays them into the store.
 *
 * Usage:
 *   node scripts/backfill-history.mjs <fixture-path> <history-dir> [--dry-run]
 *
 * Example:
 *   node scripts/backfill-history.mjs data/rajbos.fixture.json .metrics-data/data
 *
 * Safe to re-run: appendRun() replaces a day's rollup rows rather than
 * duplicating them, and never re-appends a pull request it has already seen.
 */

import { execFileSync } from "node:child_process";
import { appendRun } from "../dist/history.js";

const [, , fixturePath, historyDir, ...flags] = process.argv;

if (!fixturePath || !historyDir) {
  console.error(
    "Usage: node scripts/backfill-history.mjs <fixture-path> <history-dir> [--dry-run]"
  );
  process.exit(1);
}

const dryRun = flags.includes("--dry-run");

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
}

const log = git(["log", "--format=%H %ad", "--date=short", "--reverse", "--", fixturePath])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const space = line.indexOf(" ");
    return { sha: line.slice(0, space), date: line.slice(space + 1) };
  });

if (log.length === 0) {
  console.error(`No commits touch ${fixturePath} — nothing to backfill.`);
  process.exit(1);
}

console.log(`Found ${log.length} snapshot commits for ${fixturePath}`);
console.log(`  ${log[0].date} → ${log[log.length - 1].date}`);
if (dryRun) console.log("(dry run — nothing will be written)\n");

// One observation per day: if several commits share a date, the last wins.
const byDate = new Map();
for (const entry of log) byDate.set(entry.date, entry);

let written = 0;
let skipped = 0;
let events = 0;

for (const { sha, date } of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
  let snapshot;
  try {
    snapshot = JSON.parse(git(["show", `${sha}:${fixturePath}`]));
  } catch (err) {
    console.warn(`  ⚠ ${date} (${sha.slice(0, 7)}): could not read snapshot — ${err.message}`);
    skipped++;
    continue;
  }

  if (!snapshot?.owner || !Array.isArray(snapshot.repos)) {
    console.warn(`  ⚠ ${date} (${sha.slice(0, 7)}): snapshot has no repos — skipping`);
    skipped++;
    continue;
  }

  if (dryRun) {
    console.log(`  ${date}  ${snapshot.repos.length} repos (would write)`);
    written++;
    continue;
  }

  const result = appendRun(historyDir, snapshot, date);
  events += result.eventsAppended;
  written++;
  console.log(
    `  ${date}  ${snapshot.repos.length} repos → ` +
      `${result.rollupRowsWritten} rollup rows, ${result.eventsAppended} new events`
  );
}

console.log(
  `\nBackfill complete: ${written} day(s) written, ${skipped} skipped, ${events} PR events recorded.`
);
