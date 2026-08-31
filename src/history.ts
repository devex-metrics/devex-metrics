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
import { gini, quantiles, round } from "./stats.js";
import type { MergedPRSummary, OrgMetrics, RepoMetrics } from "./types.js";

/** Bump when the row shapes below change in a non-additive way. */
export const HISTORY_SCHEMA_VERSION = 1;

/** One repository on one day. `repo` is `"*"` for the org-level row. */
export interface RollupRow {
  v: number;
  date: string;
  /**
   * True when this row was derived from the event stream rather than observed
   * at collection time. Reconstructed rows carry only PR-derived fields; the
   * point-in-time ones (committers, reviewers, dependents, agent metrics) are
   * left at zero because no historical API can recover them. Never present a
   * reconstructed value as an observed one.
   */
  reconstructed?: boolean;
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

  // Fields below were added after the first rows were written. The stream is
  // append-only, so every one of them is optional and absent on older rows —
  // read them with a fallback, never as a zero.

  /** PR size p90 (lines changed) over the window. */
  sizeP90?: number;
  /** Merged PRs over the large-change threshold (400 lines) in the window. */
  largePRs30d?: number;
  /** Pull requests closed without merging in the window. */
  abandonedPRs30d?: number;
  /** Merged PRs in the window whose body reverts another pull request. */
  revertPRs30d?: number;
  /** Merged PRs in the window that received at least one review. */
  reviewedPRs30d?: number;
  /** Opened → first review, in hours. The leg that is usually the problem. */
  reviewWaitP50?: number;
  reviewWaitP90?: number;
  /** First review → first approval, in hours. */
  approvalWaitP50?: number;
  /** First approval → merge, in hours. */
  mergeWaitP50?: number;
  /** Median changes-requested reviews per merged PR — review rounds. */
  reviewRoundsP50?: number;
  /**
   * Gini coefficient of reviews per reviewer over the window: 0 when the load
   * is shared evenly, approaching 1 when one person reviews everything.
   */
  reviewGini?: number;
  /** Median age of pull requests still open on `date`, in hours. */
  openAgeP50?: number;
}

/** Merged PRs at or above this many lines changed count as large. */
export const LARGE_PR_LINES = 400;

/**
 * One closed pull request. Appended once and never rewritten.
 *
 * This is the durable record: aggregates are derived from it, so a metric whose
 * definition changes later can be recomputed across the whole history. Fields
 * here should be raw facts, not judgements — `firstReviewAt` rather than a
 * review-latency figure, so the definition of latency stays free to change.
 */
export interface EventRow {
  v: number;
  scope: string;
  repo: string;
  number: number;
  /** Whether the PR was merged or closed without merging. */
  state: "merged" | "closed";
  author: string;
  isBot: boolean;
  aiAuthorType?: "copilot" | "claude" | "codex";
  createdAt: string;
  /** Absent when the PR was closed without merging. */
  mergedAt?: string;
  /** When the PR was closed (equal to `mergedAt` for merged PRs). */
  closedAt?: string;
  /** Hours from created to merged. Absent when the PR was never merged. */
  timeToMergeHours?: number;
  linesAdded?: number;
  linesDeleted?: number;
  /** Number of reviews submitted on the PR. */
  reviewCount?: number;
  /**
   * When the first review was submitted. The raw fact behind review latency —
   * captured during the historical crawl so the metric can be built later
   * without crawling the whole history again.
   */
  firstReviewAt?: string;
  /** Distinct reviewer logins, for historical reviewer counts. */
  reviewers?: string[];
  /**
   * When the first approving review was submitted. Raw fact again: the split
   * between "waiting for a review" and "waiting for a merge" is derived from
   * this and `firstReviewAt`, never stored pre-computed.
   */
  firstApprovalAt?: string;
  /** Reviews that requested changes — one per round trip through review. */
  changesRequestedCount?: number;
  /** The pull request this one reverts, when its body carries the reference. */
  revertsPR?: number;
}

/**
 * The subset of a pull request the window aggregates are derived from.
 *
 * Both an `EventRow` and a `MergedPRSummary` satisfy it, so the observed and
 * the reconstructed path compute every derived figure through the same code
 * and cannot drift apart.
 */
interface PRFacts {
  createdAt: string;
  mergedAt?: string;
  linesAdded?: number;
  linesDeleted?: number;
  firstReviewAt?: string;
  firstApprovalAt?: string;
  changesRequestedCount?: number;
  revertsPR?: number;
  reviewers?: string[];
}

/** Hours between two ISO timestamps, or undefined when either is unusable. */
function hoursBetween(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return ms / 3_600_000;
}

/** The optional half of a rollup row: everything derived from raw PR facts. */
type RollupExtras = Pick<
  RollupRow,
  | "sizeP90"
  | "largePRs30d"
  | "abandonedPRs30d"
  | "revertPRs30d"
  | "reviewedPRs30d"
  | "reviewWaitP50"
  | "reviewWaitP90"
  | "approvalWaitP50"
  | "mergeWaitP50"
  | "reviewRoundsP50"
  | "reviewGini"
>;

/**
 * Derive one window's aggregates from the raw per-PR facts.
 *
 * Every figure here is recomputable from the event stream, which is the point:
 * a definition that changes later can be applied to the whole history rather
 * than only to the days collected after the change.
 */
export function deriveRollupExtras(
  prs: readonly PRFacts[],
  abandoned: number
): RollupExtras {
  const sizes: number[] = [];
  const reviewWaits: number[] = [];
  const approvalWaits: number[] = [];
  const mergeWaits: number[] = [];
  const rounds: number[] = [];
  const reviewsBy = new Map<string, number>();
  let large = 0;
  let reverts = 0;
  let reviewed = 0;

  for (const pr of prs) {
    const size = (pr.linesAdded ?? 0) + (pr.linesDeleted ?? 0);
    if (size > 0) {
      sizes.push(size);
      if (size >= LARGE_PR_LINES) large++;
    }
    if (pr.revertsPR !== undefined) reverts++;
    if (pr.firstReviewAt) reviewed++;

    const toReview = hoursBetween(pr.createdAt, pr.firstReviewAt);
    if (toReview !== undefined) reviewWaits.push(toReview);
    const toApproval = hoursBetween(pr.firstReviewAt, pr.firstApprovalAt);
    if (toApproval !== undefined) approvalWaits.push(toApproval);
    const toMerge = hoursBetween(pr.firstApprovalAt, pr.mergedAt);
    if (toMerge !== undefined) mergeWaits.push(toMerge);

    if (pr.changesRequestedCount !== undefined) rounds.push(pr.changesRequestedCount);
    for (const reviewer of pr.reviewers ?? []) {
      reviewsBy.set(reviewer, (reviewsBy.get(reviewer) ?? 0) + 1);
    }
  }

  const sq = quantiles(sizes);
  const rw = quantiles(reviewWaits);
  return {
    sizeP90: round(sq.p90),
    largePRs30d: large,
    abandonedPRs30d: abandoned,
    revertPRs30d: reverts,
    reviewedPRs30d: reviewed,
    reviewWaitP50: round(rw.p50),
    reviewWaitP90: round(rw.p90),
    approvalWaitP50: round(quantiles(approvalWaits).p50),
    mergeWaitP50: round(quantiles(mergeWaits).p50),
    reviewRoundsP50: round(quantiles(rounds).p50),
    reviewGini: round(gini([...reviewsBy.values()]), 3),
  };
}

/** Median age in hours of the pull requests still open on `date`. */
function openAgeMedian(repo: RepoMetrics, date: string): number | undefined {
  const open = repo.openPRTimeline;
  if (!open || open.length === 0) return undefined;
  const at = new Date(`${date}T23:59:59Z`).getTime();
  const ages = open
    .map((pr) => (at - new Date(pr.createdAt).getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  if (ages.length === 0) return undefined;
  return round(quantiles(ages).p50);
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
function mergedPRs(repo: RepoMetrics): MergedPRSummary[] {
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
  const orgPRs: MergedPRSummary[] = [];
  let orgAbandoned = 0;
  let orgAI = 0;
  let orgHuman = 0;

  for (const repo of metrics.repos) {
    const recent = mergedPRs(repo).filter(
      (pr) => new Date(pr.mergedAt).getTime() >= cutoff
    );
    const abandoned = (repo.closedPRTimeline ?? []).filter(
      (pr) => new Date(pr.closedAt).getTime() >= cutoff
    ).length;
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
      ...deriveRollupExtras(recent, abandoned),
      openAgeP50: openAgeMedian(repo, date),
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
    orgPRs.push(...recent);
    orgAbandoned += abandoned;
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
    ...deriveRollupExtras(orgPRs, orgAbandoned),
    openAgeP50: orgOpenAgeMedian(metrics.repos, date),
  });

  return rows;
}

/** Median age in hours of every open pull request across the organisation. */
function orgOpenAgeMedian(repos: readonly RepoMetrics[], date: string): number | undefined {
  const at = new Date(`${date}T23:59:59Z`).getTime();
  const ages: number[] = [];
  for (const repo of repos) {
    for (const pr of repo.openPRTimeline ?? []) {
      const hours = (at - new Date(pr.createdAt).getTime()) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0) ages.push(hours);
    }
  }
  return ages.length > 0 ? round(quantiles(ages).p50) : undefined;
}

/**
 * Build the event rows for one collection run.
 *
 * Both outcomes are recorded: a merged pull request and one closed without
 * merging are the numerator and the denominator of the same question, and the
 * abandoned ones were fetched by the same query.
 */
export function buildEventRows(metrics: OrgMetrics): EventRow[] {
  const rows: EventRow[] = [];
  for (const repo of metrics.repos) {
    for (const pr of mergedPRs(repo)) {
      rows.push({
        v: HISTORY_SCHEMA_VERSION,
        scope: metrics.owner,
        repo: repo.fullName,
        number: pr.number,
        state: "merged",
        author: pr.author,
        isBot: pr.isBotAuthor,
        aiAuthorType: pr.aiAuthorType,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        closedAt: pr.mergedAt,
        timeToMergeHours: round(pr.timeToMergeHours),
        linesAdded: pr.linesAdded,
        linesDeleted: pr.linesDeleted,
        reviewCount: pr.reviewCount,
        firstReviewAt: pr.firstReviewAt,
        firstApprovalAt: pr.firstApprovalAt,
        changesRequestedCount: pr.changesRequestedCount,
        revertsPR: pr.revertsPR,
      });
    }
    for (const pr of repo.closedPRTimeline ?? []) {
      rows.push({
        v: HISTORY_SCHEMA_VERSION,
        scope: metrics.owner,
        repo: repo.fullName,
        number: pr.number,
        state: "closed",
        author: pr.author,
        isBot: pr.isBotAuthor,
        aiAuthorType: pr.aiAuthorType,
        createdAt: pr.createdAt,
        closedAt: pr.closedAt,
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

  const appended = appendEventRows(dir, scope, buildEventRows(metrics));

  fs.mkdirSync(path.dirname(latestPath(dir, scope)), { recursive: true });
  fs.writeFileSync(latestPath(dir, scope), JSON.stringify(metrics, null, 2));

  return {
    rollupRowsWritten: newRollup.length,
    rollupRowsReplaced: existingRollup.length - keptRollup.length,
    eventsAppended: appended.appended,
    eventsAlreadyPresent: appended.alreadyPresent,
  };
}

/** What `appendEventRows` wrote. */
export interface AppendEventsResult {
  appended: number;
  alreadyPresent: number;
}

/**
 * Append event rows, skipping any pull request already in the stream.
 *
 * Deduplication is by `repo#number`, so a PR seen by both the daily collection
 * and the historical crawl is stored once. The first writer wins: the daily
 * path carries richer AI-authorship detection, so it is never overwritten by a
 * leaner historical row for the same PR.
 */
export function appendEventRows(
  dir: string,
  scope: string,
  rows: readonly EventRow[]
): AppendEventsResult {
  const eventsFile = eventsPath(dir, scope);
  const existing = readNdjson<EventRow>(eventsFile);
  const seen = new Set(existing.map((e) => `${e.repo}#${e.number}`));

  const fresh: EventRow[] = [];
  for (const row of rows) {
    const key = `${row.repo}#${row.number}`;
    if (seen.has(key)) continue;
    seen.add(key); // guard against duplicates within `rows` itself
    fresh.push(row);
  }

  if (fresh.length > 0) {
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.appendFileSync(eventsFile, `${fresh.map((r) => JSON.stringify(r)).join("\n")}\n`);
  }

  return { appended: fresh.length, alreadyPresent: existing.length };
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

// ── Backfill watermarks ───────────────────────────────────────────────────────

/** How far the historical crawl has walked through one repository. */
export interface RepoWatermark {
  /** GraphQL cursor to resume from. Null means "start at the first PR". */
  cursor: string | null;
  /** True once GitHub reported no further pages — the repo is fully crawled. */
  complete: boolean;
  /** Pages fetched across all runs, for cost reporting. */
  pagesFetched: number;
  /** Pull requests seen across all runs. */
  prsSeen: number;
  /** Creation date of the oldest PR seen so far. */
  oldestCreatedAt?: string;
  /** Creation date of the newest PR seen so far. */
  newestCreatedAt?: string;
  /** When this watermark was last advanced. */
  updatedAt: string;
}

/** The per-scope watermark file. */
export interface BackfillState {
  v: number;
  scope: string;
  repos: Record<string, RepoWatermark>;
}

/** Path of the backfill watermark file for a scope. */
export function backfillPath(dir: string, scope: string): string {
  return path.join(scopeDir(dir, scope), "backfill.json");
}

/** Load the backfill watermarks, returning an empty state when absent. */
export function loadBackfillState(dir: string, scope: string): BackfillState {
  const filePath = backfillPath(dir, scope);
  if (!fs.existsSync(filePath)) {
    return { v: HISTORY_SCHEMA_VERSION, scope, repos: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as BackfillState;
    if (parsed.v !== HISTORY_SCHEMA_VERSION || !parsed.repos) {
      return { v: HISTORY_SCHEMA_VERSION, scope, repos: {} };
    }
    return parsed;
  } catch {
    // A corrupt watermark file costs a re-crawl, not data: events dedupe.
    console.warn(`  ⚠ backfill: unreadable watermark file at ${filePath}; starting over`);
    return { v: HISTORY_SCHEMA_VERSION, scope, repos: {} };
  }
}

/** Persist the backfill watermarks. */
export function saveBackfillState(dir: string, state: BackfillState): void {
  const filePath = backfillPath(dir, state.scope);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

// ── Rollup recomputation ──────────────────────────────────────────────────────

/** ISO week label ("YYYY-Www") for a Date. */
function isoWeekOf(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The Sunday that ends the ISO week containing `date`, as YYYY-MM-DD. */
function isoWeekEnd(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (7 - dow));
  return d.toISOString().slice(0, 10);
}

/**
 * Rebuild rollup rows for the whole history from the event stream.
 *
 * Observed rows are collected daily; reconstructed rows are emitted weekly,
 * because daily granularity across years of history would multiply the file by
 * the number of repositories for no analytical gain — and the store already
 * compacts observed rows to weekly after 90 days.
 *
 * Each row uses the same trailing-30-day window as an observed row, evaluated
 * at that week's end, so the two are directly comparable. A repository with no
 * merged pull requests in a window produces no row.
 *
 * Only PR-derived fields are populated. Committer, reviewer, dependent and
 * agent figures stay at zero: no GitHub API can report what they were on a past
 * date, so inventing them would be worse than leaving them empty.
 */
/**
 * Whether an event row represents a merged pull request.
 *
 * The event stream is append-only and never rewritten, so rows written by an
 * older build outlive the schema that produced them. `state` was added after
 * the first rows were written, and a row that predates it is merged exactly
 * when it carries a merge timestamp — treating a missing field as "not merged"
 * would silently discard the whole early history.
 */
export function isMergedEvent(event: EventRow): boolean {
  if (event.state === "merged") return true;
  if (event.state === undefined) return typeof event.mergedAt === "string";
  return false;
}

export function recomputeRollupFromEvents(
  events: readonly EventRow[],
  scope: string,
  now = Date.now()
): RollupRow[] {
  const merged = events.filter((e) => isMergedEvent(e) && e.mergedAt);
  if (merged.length === 0) return [];

  let oldest = Infinity;
  for (const e of merged) {
    const t = new Date(e.mergedAt as string).getTime();
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  if (!Number.isFinite(oldest)) return [];

  // One evaluation point per ISO week from the first merge to now.
  const weekEnds: string[] = [];
  const seenWeeks = new Set<string>();
  for (let t = oldest; t <= now; t += 7 * 24 * 60 * 60 * 1000) {
    const label = isoWeekOf(new Date(t));
    if (seenWeeks.has(label)) continue;
    seenWeeks.add(label);
    weekEnds.push(isoWeekEnd(new Date(t)));
  }

  // Bucket merges by repo once, so each week is a filter rather than a scan.
  const byRepo = new Map<string, EventRow[]>();
  for (const e of merged) {
    const list = byRepo.get(e.repo);
    if (list) list.push(e);
    else byRepo.set(e.repo, [e]);
  }

  // Pull requests closed without merging, bucketed the same way. A repository
  // with abandonments but no merges in a window still produces no row: the
  // window's other figures would all be empty, and an empty row reads as a
  // collapse in delivery rather than as an absence of data.
  const closedByRepo = new Map<string, EventRow[]>();
  for (const e of events) {
    if (isMergedEvent(e) || !e.closedAt) continue;
    const list = closedByRepo.get(e.repo);
    if (list) list.push(e);
    else closedByRepo.set(e.repo, [e]);
  }

  const rows: RollupRow[] = [];
  const WINDOW = 30 * 24 * 60 * 60 * 1000;

  for (const date of weekEnds) {
    const end = new Date(`${date}T23:59:59Z`).getTime();
    const start = end - WINDOW;

    const orgCycles: number[] = [];
    const orgSizes: number[] = [];
    const orgPRs: EventRow[] = [];
    let orgAbandoned = 0;
    let orgAI = 0;
    let orgHuman = 0;
    let orgCount = 0;

    for (const [repo, prs] of byRepo) {
      const inWindow = prs.filter((e) => {
        const t = new Date(e.mergedAt as string).getTime();
        return t >= start && t <= end;
      });
      if (inWindow.length === 0) continue;

      const cycles = inWindow
        .map((e) => e.timeToMergeHours ?? 0)
        .filter((h) => h > 0);
      const sizes = inWindow
        .map((e) => (e.linesAdded ?? 0) + (e.linesDeleted ?? 0))
        .filter((n) => n > 0);
      const ai = inWindow.filter((e) => e.aiAuthorType !== undefined).length;
      const human = inWindow.filter(
        (e) => !e.isBot && e.aiAuthorType === undefined
      ).length;

      const abandoned = (closedByRepo.get(repo) ?? []).filter((e) => {
        const t = new Date(e.closedAt as string).getTime();
        return t >= start && t <= end;
      }).length;

      const cq = quantiles(cycles);
      const sq = quantiles(sizes);

      rows.push({
        v: HISTORY_SCHEMA_VERSION,
        reconstructed: true,
        date,
        scope,
        repo,
        isTeamRepo: false,
        openIssues: 0,
        closedIssues: 0,
        openPRs: 0,
        mergedPRs: 0,
        closedPRs: 0,
        committers: 0,
        reviewers: 0,
        contributors: 0,
        dependents: 0,
        mergedPRs30d: inWindow.length,
        cycleP50: round(cq.p50),
        cycleP75: round(cq.p75),
        cycleP90: round(cq.p90),
        sizeP50: round(sq.p50),
        sizeP75: round(sq.p75),
        aiPRs30d: ai,
        humanPRs30d: human,
        agentTasks: 0,
        agentCredits: 0,
        ...deriveRollupExtras(inWindow, abandoned),
      });

      orgCycles.push(...cycles);
      orgSizes.push(...sizes);
      orgPRs.push(...inWindow);
      orgAbandoned += abandoned;
      orgAI += ai;
      orgHuman += human;
      orgCount += inWindow.length;
    }

    if (orgCount === 0) continue;
    const ocq = quantiles(orgCycles);
    const osq = quantiles(orgSizes);
    rows.push({
      v: HISTORY_SCHEMA_VERSION,
      reconstructed: true,
      date,
      scope,
      repo: "*",
      isTeamRepo: false,
      openIssues: 0,
      closedIssues: 0,
      openPRs: 0,
      mergedPRs: 0,
      closedPRs: 0,
      committers: 0,
      reviewers: 0,
      contributors: 0,
      dependents: 0,
      mergedPRs30d: orgCount,
      cycleP50: round(ocq.p50),
      cycleP75: round(ocq.p75),
      cycleP90: round(ocq.p90),
      sizeP50: round(osq.p50),
      sizeP75: round(osq.p75),
      aiPRs30d: orgAI,
      humanPRs30d: orgHuman,
      agentTasks: 0,
      agentCredits: 0,
      ...deriveRollupExtras(orgPRs, orgAbandoned),
    });
  }

  return rows;
}

/**
 * Merge reconstructed rows into the stored rollup, keeping observed data.
 *
 * An observed row always wins for its (date, repo): it carries the
 * point-in-time fields that cannot be recovered. Reconstructed rows only fill
 * dates that were never collected — which is to say, everything before this
 * deployment started running.
 */
export function mergeReconstructed(
  stored: readonly RollupRow[],
  reconstructed: readonly RollupRow[]
): RollupRow[] {
  const observed = new Set(
    stored.filter((r) => !r.reconstructed).map((r) => `${r.date}|${r.repo}`)
  );
  const kept = stored.filter((r) => !r.reconstructed);
  const filled = reconstructed.filter((r) => !observed.has(`${r.date}|${r.repo}`));
  return [...kept, ...filled].sort((a, b) =>
    a.date === b.date ? a.repo.localeCompare(b.repo) : a.date.localeCompare(b.date)
  );
}
