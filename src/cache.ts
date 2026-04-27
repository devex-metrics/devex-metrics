import * as fs from "node:fs";
import * as path from "node:path";
import type { CacheEnvelope, OrgMetrics } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");

/**
 * Current cache schema version. Bump this whenever `OrgMetrics` gains a new
 * required field so that cached/fixture data missing the field is automatically
 * invalidated and re-collected.
 *
 * Version history:
 *   1 — initial versioning; adds mergedPRDates per repo
 *   3 — fix Copilot authorship detection to also match the Copilot coding
 *       agent login "Copilot" (type "Bot"); previous cache has incorrect
 *       isCopilotAuthored: false for copilot-swe-agent PRs
 *   4 — add contributorCount (unique union of committers + reviewers) to RepoMetrics
 */
export const CURRENT_SCHEMA_VERSION = 4;

function cacheFilePath(owner: string): string {
  return path.join(DATA_DIR, `${owner}.json`);
}

function fixtureFilePath(owner: string): string {
  return path.join(DATA_DIR, `${owner}.fixture.json`);
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Load committed fixture data for `owner` (no date restriction).
 * Fixture files are checked-in to the repo for use across worktrees
 * without needing live API access.
 */
export function loadFixture(owner: string): OrgMetrics | null {
  const filePath = fixtureFilePath(owner);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as OrgMetrics;
    if (!data.owner || !Array.isArray(data.repos) || data.weeklyTrends === undefined) {
      return null;
    }
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.log(
        `Fixture for ${owner} has schema version ${data.schemaVersion ?? "none"} ` +
        `(current: ${CURRENT_SCHEMA_VERSION}). Ignoring stale fixture.`
      );
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Persist `data` as a fixture file (no date envelope) that can be
 * committed to the repo and reused across worktrees without API calls.
 */
export function saveFixture(owner: string, data: OrgMetrics): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = fixtureFilePath(owner);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Fixture saved to: ${filePath}`);
}

/**
 * Return true if `timestamp` is defined and was within the last `hours` hours.
 */
export function isWithinHours(timestamp: string | undefined, hours: number): boolean {
  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() < hours * 60 * 60 * 1000;
}

/**
 * Load the raw cached data for `owner` regardless of date, for use in
 * per-repo freshness checks. Returns null if no file exists or is unreadable.
 * Fixture files take precedence over the daily cache.
 */
export function loadRawCache(owner: string): OrgMetrics | null {
  // Fixture first (already date-independent)
  const fixture = loadFixture(owner);
  if (fixture) return fixture;

  const filePath = cacheFilePath(owner);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const envelope: CacheEnvelope = JSON.parse(raw);
    const data = envelope.data ?? null;
    if (data?.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Return cached data if it was collected today, otherwise null.
 * Fixture files (committed to the repo) take precedence and have no
 * date restriction — they are intended for local development.
 */
export function loadCache(owner: string): OrgMetrics | null {
  const fixture = loadFixture(owner);
  if (fixture) {
    console.log(`Using fixture data for ${owner} (collected ${fixture.collectedAt})`);
    return fixture;
  }

  const filePath = cacheFilePath(owner);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const envelope: CacheEnvelope = JSON.parse(raw);
    if (
      envelope.date === todayDateString() &&
      envelope.data.weeklyTrends !== undefined &&
      envelope.data.schemaVersion === CURRENT_SCHEMA_VERSION
    ) {
      return envelope.data;
    }
    return null; // stale cache, missing weeklyTrends, or schema version mismatch
  } catch {
    return null;
  }
}

/**
 * Persist collected data with today's date stamp.
 */
export function saveCache(owner: string, data: OrgMetrics): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const envelope: CacheEnvelope = {
    date: todayDateString(),
    data,
  };
  fs.writeFileSync(cacheFilePath(owner), JSON.stringify(envelope, null, 2));
}
