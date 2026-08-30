/**
 * Append-only history store.
 *
 * Every collection run appends one rollup row per repository (plus one
 * org-level row) and one event row per newly seen merged pull request. The
 * store lives on the orphan `metrics-data` branch, checked out into a
 * side directory by the workflow, so nothing ever lands on the default branch.
 *
 * Layout, per scope:
 *
 *   <dir>/<scope>/rollup.ndjson   one line per repo per day (idempotent per day)
 *   <dir>/<scope>/events.ndjson   one line per merged PR, appended once
 *   <dir>/<scope>/latest.json     the newest full snapshot, overwritten
 *
 * The event stream matters more than the rollup: it holds the raw per-PR facts,
 * so a metric whose definition changes later can be recomputed across the whole
 * history instead of being lost.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { quantiles, round } from "./stats.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";

/** Bump when the row shapes below change in a non-additive way. */
export const HISTORY_SCHEMA_VERSION = 1;

/** One repository on one day. `repo` is `"*"` for the org-level row. */
export interface RollupRow {
  v: number;
  date: string;
  scope: string;
  repo: string;
  isTeamRepo: boolean;
  openIssues: number;
  closedIssues: number;
  openPRs: number;
  mergedPRs: number;
  closedPRs: number;
  committers: number;
  reviewers: number;
  contributors: number;
  dependents: number;
  /** Merged PRs in the 30 days before `date`. */
  mergedPRs30d: number;
  /** Cycle-time quantiles in hours over those 30 days. */
  cycleP50: number;
  cycleP75: number;
  cycleP90: number;
  /** PR size quantiles (lines changed) over those 30 days. */
  sizeP50: number;
  sizeP75: number;
  /** AI-authored merged PRs in the same window, and the human denominator. */
  aiPRs30d: number;
  humanPRs30d: number;
  agentTasks: number;
  agentCredits: number;
}

/** One merged pull request. Appended once and never rewritten. */
export interface EventRow {
  v: number;
  scope: string;
  repo: string;
  number: number;
  author: string;
  isBot: boolean;
  aiAuthorType?: "copilot" | "claude" | "codex";
  createdAt: string;
  mergedAt: string;
  timeToMergeHours: number;
  linesAdded?: number;
  linesDeleted?: number;
}

function scopeDir(dir: string, scope: string): string {
  // Scope names come from configuration, not user input, but a stray slash
  // would silently write outside the store.
  return path.join(dir, scope.replace(/[/\\]/g, "-"));
}

/** Read an NDJSON file, skipping blank and unparseable lines. */
export function readNdjson<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const rows: T[] = [];
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // A truncated final line can survive an interrupted run; skip it rather
      // than failing the whole collection.
      console.warn(`  ⚠ history: skipping unparseable line in ${filePath}`);
    }
  }
  return rows;
}

function writeNdjson(filePath: string, rows: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(filePath, rows.length > 0 ? `${body}\n` : "");
}

/** Path of the rollup stream for a scope. */
export function rollupPath(dir: string, scope: string): string {
  return path.join(scopeDir(dir, scope), "rollup.ndjson");
}

/** Path of the event stream for a scope. */
export function eventsPath(dir: string, scope: string): string {
  return path.join(scopeDir(dir, scope), "events.ndjson");
}

/** Path of the newest full snapshot for a scope. */
export function latestPath(dir: string, scope: string): string {
  return path.join(scopeDir(dir, scope), "latest.json");
}

/** Merged PRs from a repo's timeline, newest-first sources included. */
function mergedPRs(repo: RepoMetrics) {
  if (repo.mergedPRTimeline && repo.mergedPRTimeline.length > 0) {
    return repo.mergedPRTimeline;
  }
  return repo.pullRequestDetails
    .filter((pr) => !!pr.mergedAt)
    .map((pr) => ({
      number: pr.number,
      createdAt: pr.createdAt,
      mergedAt: pr.mergedAt as string,
      author: pr.author,
      isBotAuthor: false,
      isCopilotAuthored: pr.isCopilotAuthored,
      aiAuthorType: pr.aiAuthorType,
      timeToMergeHours: pr.timeToMergeHours ?? 0,
      closesIssues: [] as number[],
      linesAdded: pr.linesAdded,
      linesDeleted: pr.linesDeleted,
    }));
}

/** Build the rollup rows for one collection run. */
export function buildRollupRows(metrics: OrgMetrics, date: string): RollupRow[] {
  const cutoff = new Date(`${date}T00:00:00Z`).getTime() - 30 * 24 * 60 * 60 * 1000;
  const rows: RollupRow[] = [];

  const org = {
    openIssues: 0,
    closedIssues: 0,
    openPRs: 0,
    mergedPRs: 0,
    closedPRs: 0,
    committers: 0,
    reviewers: 0,
    contributors: 0,
    dependents: 0,
    agentTasks: 0,
    agentCredits: 0,
  };
  const orgCycles: number[] = [];
  const orgSizes: number[] = [];
  let orgAI = 0;
  let orgHuman = 0;

  for (const repo of metrics.repos) {
    const recent = mergedPRs(repo).filter(
      (pr) => new Date(pr.mergedAt).getTime() >= cutoff
    );
    const cycles = recent.map((pr) => pr.timeToMergeHours).filter((h) => h > 0);
    const sizes = recent
      .map((pr) => (pr.linesAdded ?? 0) + (pr.linesDeleted ?? 0))
      .filter((n) => n > 0);
    const ai = recent.filter((pr) => pr.isCopilotAuthored).length;
    const human = recent.filter((pr) => !pr.isBotAuthor && !pr.isCopilotAuthored).length;

    const cq = quantiles(cycles);
    const sq = quantiles(sizes);

    rows.push({
      v: HISTORY_SCHEMA_VERSION,
      date,
      scope: metrics.owner,
      repo: repo.fullName,
      isTeamRepo: repo.isTeamRepo === true,
      openIssues: Math.max(0, repo.issues.open),
      closedIssues: Math.max(0, repo.issues.closed),
      openPRs: repo.pullRequests.open,
      mergedPRs: repo.pullRequests.merged,
      closedPRs: repo.pullRequests.closed,
      committers: repo.committerCount,
      reviewers: repo.reviewerCount,
      contributors: repo.contributorCount,
      dependents: repo.dependentCount,
      mergedPRs30d: recent.length,
      cycleP50: round(cq.p50),
      cycleP75: round(cq.p75),
      cycleP90: round(cq.p90),
      sizeP50: round(sq.p50),
      sizeP75: round(sq.p75),
      aiPRs30d: ai,
      humanPRs30d: human,
      agentTasks: repo.copilotAgentMetrics?.totalTasks ?? 0,
      agentCredits: round(repo.copilotAgentMetrics?.totalCreditsUsed ?? 0),
    });

    org.openIssues += Math.max(0, repo.issues.open);
    org.closedIssues += Math.max(0, repo.issues.closed);
    org.openPRs += repo.pullRequests.open;
    org.mergedPRs += repo.pullRequests.merged;
    org.closedPRs += repo.pullRequests.closed;
    org.committers += repo.committerCount;
    org.reviewers += repo.reviewerCount;
    org.contributors += repo.contributorCount;
    org.dependents += repo.dependentCount;
    org.agentTasks += repo.copilotAgentMetrics?.totalTasks ?? 0;
    org.agentCredits += repo.copilotAgentMetrics?.totalCreditsUsed ?? 0;
    orgCycles.push(...cycles);
    orgSizes.push(...sizes);
    orgAI += ai;
    orgHuman += human;
  }

  const ocq = quantiles(orgCycles);
  const osq = quantiles(orgSizes);
  rows.push({
    v: HISTORY_SCHEMA_VERSION,
    date,
    scope: metrics.owner,
    repo: "*",
    isTeamRepo: false,
    ...org,
    agentCredits: round(org.agentCredits),
    mergedPRs30d: orgCycles.length > 0 ? orgCycles.length : 0,
    cycleP50: round(ocq.p50),
    cycleP75: round(ocq.p75),
    cycleP90: round(ocq.p90),
    sizeP50: round(osq.p50),
    sizeP75: round(osq.p75),
    aiPRs30d: orgAI,
    humanPRs30d: orgHuman,
  });

  return rows;
}

/** Build the event rows for one collection run. */
export function buildEventRows(metrics: OrgMetrics): EventRow[] {
  const rows: EventRow[] = [];
  for (const repo of metrics.repos) {
    for (const pr of mergedPRs(repo)) {
      rows.push({
        v: HISTORY_SCHEMA_VERSION,
        scope: metrics.owner,
        repo: repo.fullName,
        number: pr.number,
        author: pr.author,
        isBot: pr.isBotAuthor,
        aiAuthorType: pr.aiAuthorType,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        timeToMergeHours: round(pr.timeToMergeHours),
        linesAdded: pr.linesAdded,
        linesDeleted: pr.linesDeleted,
      });
    }
  }
  return rows;
}

/** What `appendRun` wrote, for the run log. */
export interface AppendResult {
  rollupRowsWritten: number;
  rollupRowsReplaced: number;
  eventsAppended: number;
  eventsAlreadyPresent: number;
}

/**
 * Append one collection run to the store.
 *
 * Re-running on the same day replaces that day's rollup rows rather than
 * duplicating them, and events already in the stream are never re-appended, so
 * the whole operation is safe to repeat.
 */
export function appendRun(
  dir: string,
  metrics: OrgMetrics,
  date = metrics.collectedAt.slice(0, 10)
): AppendResult {
  const scope = metrics.owner;

  const rollupFile = rollupPath(dir, scope);
  const existingRollup = readNdjson<RollupRow>(rollupFile);
  const keptRollup = existingRollup.filter((row) => row.date !== date);
  const newRollup = buildRollupRows(metrics, date);
  // Keep the file ordered by date so a reader can stream it without sorting.
  const mergedRollup = [...keptRollup, ...newRollup].sort((a, b) =>
    a.date === b.date ? a.repo.localeCompare(b.repo) : a.date.localeCompare(b.date)
  );
  writeNdjson(rollupFile, mergedRollup);

  const eventsFile = eventsPath(dir, scope);
  const existingEvents = readNdjson<EventRow>(eventsFile);
  const seen = new Set(existingEvents.map((e) => `${e.repo}#${e.number}`));
  const fresh = buildEventRows(metrics).filter((e) => !seen.has(`${e.repo}#${e.number}`));
  if (fresh.length > 0) {
    const body = fresh.map((r) => JSON.stringify(r)).join("\n");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.appendFileSync(eventsFile, `${body}\n`);
  }

  fs.mkdirSync(path.dirname(latestPath(dir, scope)), { recursive: true });
  fs.writeFileSync(latestPath(dir, scope), JSON.stringify(metrics, null, 2));

  return {
    rollupRowsWritten: newRollup.length,
    rollupRowsReplaced: existingRollup.length - keptRollup.length,
    eventsAppended: fresh.length,
    eventsAlreadyPresent: seen.size,
  };
}

/** Read back the rollup stream for a scope. */
export function loadRollup(dir: string, scope: string): RollupRow[] {
  return readNdjson<RollupRow>(rollupPath(dir, scope));
}

/** Read back the event stream for a scope. */
export function loadEvents(dir: string, scope: string): EventRow[] {
  return readNdjson<EventRow>(eventsPath(dir, scope));
}

/** Read back the newest snapshot for a scope, or null when absent. */
export function loadLatest(dir: string, scope: string): OrgMetrics | null {
  const filePath = latestPath(dir, scope);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OrgMetrics;
  } catch {
    return null;
  }
}

/**
 * Compact rollup rows older than `keepDailyDays` to one row per repo per ISO
 * week, keeping the newest row in each week. Daily granularity is only useful
 * while a trial is running; older data is read as a trend.
 */
export function compactRollup(rows: readonly RollupRow[], keepDailyDays = 90, now = Date.now()): RollupRow[] {
  const cutoff = now - keepDailyDays * 24 * 60 * 60 * 1000;
  const weekly = new Map<string, RollupRow>();
  const recent: RollupRow[] = [];

  for (const row of rows) {
    if (new Date(`${row.date}T00:00:00Z`).getTime() >= cutoff) {
      recent.push(row);
      continue;
    }
    const key = `${row.repo}|${isoWeek(row.date)}`;
    const held = weekly.get(key);
    if (!held || row.date > held.date) weekly.set(key, row);
  }

  return [...weekly.values(), ...recent].sort((a, b) =>
    a.date === b.date ? a.repo.localeCompare(b.repo) : a.date.localeCompare(b.date)
  );
}

/** ISO week label ("YYYY-Www") for a YYYY-MM-DD date string. */
function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
