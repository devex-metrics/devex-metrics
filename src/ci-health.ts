/**
 * CI health, trickled in.
 *
 * Build success rate, how long a pipeline takes, how long it waits for a
 * runner and how often it needs a second attempt are among the most useful
 * things a team can know, and the most expensive to measure: the honest route
 * is per-commit check runs, which is one API call per commit for the life of
 * every repository.
 *
 * So this does what `src/backfill.ts` does for pull requests. Each repository
 * gets a watermark; each run spends a bounded number of pages against a shared
 * budget; a repository that reports no further pages is latched complete and
 * never costs anything again. The daily collection fetches no check runs at
 * all. With the default budget the whole feature is twenty REST calls a day,
 * and it is off unless a deployment turns it on.
 *
 * The store mirrors the event stream: `ci.ndjson` holds one row per workflow
 * run attempt — raw facts, never a computed rate — so a definition of
 * "flaky" that changes next quarter can be recomputed over everything already
 * collected.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  fetchWorkflowRunPage,
  type WorkflowRunFacts,
} from "./collectors/workflow-runs.js";
import { appendNdjson, readNdjson, scopePath, HISTORY_SCHEMA_VERSION } from "./history.js";
import { quantiles, round } from "./stats.js";
import type { CiHealthConfig } from "./config.js";
import type { CiRunSample } from "./types.js";

/** One workflow run attempt, as stored. Append-only, never rewritten. */
export interface CiRunRow {
  v: number;
  scope: string;
  /** Repository full name ("owner/repo"). */
  repo: string;
  /** Run id — the same across re-run attempts. */
  runId: number;
  /** Re-run attempt number. */
  attempt: number;
  /** Workflow name. */
  workflow: string;
  /** Branch the run was for. */
  branch: string;
  /** Commit the run was for. A re-run keeps the same SHA. */
  headSha: string;
  /** Triggering event. */
  event: string;
  /** success | failure | cancelled | skipped…; absent while still running. */
  conclusion?: string;
  /** When the run was queued. */
  createdAt: string;
  /** When a runner picked it up. Absent on older runs. */
  startedAt?: string;
  /** When the run finished. Absent while it is still going. */
  completedAt?: string;
}

/** How far the CI crawl has walked through one repository. */
export interface CiWatermark {
  /**
   * The `created:<=` date the pagination is pinned to. Without it, page 7
   * would mean something different tomorrow and a resumed crawl would skip
   * runs it never fetched.
   */
  anchor: string;
  /** Next page to fetch, 1-based. */
  page: number;
  /** True once GitHub reported a short page — the repository is caught up. */
  complete: boolean;
  /** Runs recorded across all runs of the crawl. */
  runsSeen: number;
  /** Creation date of the oldest run seen so far. */
  oldestCreatedAt?: string;
  /** Creation date of the newest run seen so far. */
  newestCreatedAt?: string;
  /** When this watermark last moved. */
  updatedAt: string;
}

/** The per-scope CI watermark file. */
export interface CiState {
  v: number;
  scope: string;
  repos: Record<string, CiWatermark>;
}

/** A repository to crawl, with the branch that counts as its trunk. */
export interface CiTarget {
  fullName: string;
  /** Default branch. A repository whose default branch is unknown is skipped. */
  defaultBranch?: string;
}

/** What one CI crawl achieved. */
export interface CiCrawlResult {
  reposTouched: number;
  reposCompleted: number;
  reposAlreadyComplete: number;
  /** Repositories skipped because their default branch was not known. */
  reposSkipped: number;
  pagesFetched: number;
  rowsAppended: number;
  allComplete: boolean;
}

/** Path of the CI run stream for a scope. */
export function ciRunsPath(dir: string, scope: string): string {
  return scopePath(dir, scope, "ci.ndjson");
}

/** Path of the CI watermark file for a scope. */
export function ciStatePath(dir: string, scope: string): string {
  return scopePath(dir, scope, "ci-state.json");
}

/** Read back the CI run stream for a scope. */
export function loadCiRuns(dir: string, scope: string): CiRunRow[] {
  return readNdjson<CiRunRow>(ciRunsPath(dir, scope));
}

/** Load the CI watermarks, returning an empty state when absent or unusable. */
export function loadCiState(dir: string, scope: string): CiState {
  const filePath = ciStatePath(dir, scope);
  if (!fs.existsSync(filePath)) {
    return { v: HISTORY_SCHEMA_VERSION, scope, repos: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CiState;
    if (parsed.v !== HISTORY_SCHEMA_VERSION || !parsed.repos) {
      return { v: HISTORY_SCHEMA_VERSION, scope, repos: {} };
    }
    return parsed;
  } catch {
    // A corrupt watermark costs a re-crawl, not data: rows dedupe on append.
    console.warn(`  ⚠ ci: unreadable watermark file at ${filePath}; starting over`);
    return { v: HISTORY_SCHEMA_VERSION, scope, repos: {} };
  }
}

/** Persist the CI watermarks. */
export function saveCiState(dir: string, state: CiState): void {
  const filePath = ciStatePath(dir, state.scope);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

/** Convert one workflow run into a stored row. */
export function toCiRunRow(
  scope: string,
  repo: string,
  run: WorkflowRunFacts
): CiRunRow {
  const row: CiRunRow = {
    v: HISTORY_SCHEMA_VERSION,
    scope,
    repo,
    runId: run.id,
    attempt: run.attempt,
    workflow: run.workflow,
    branch: run.branch,
    headSha: run.headSha,
    event: run.event,
    createdAt: run.createdAt,
  };
  if (run.conclusion) row.conclusion = run.conclusion;
  if (run.startedAt) row.startedAt = run.startedAt;
  // `updated_at` is when a completed run finished; while a run is still going
  // it is just the last heartbeat, which would look like a very fast build.
  if (run.status === "completed") row.completedAt = run.updatedAt;
  return row;
}

/** Append CI rows, skipping run attempts already in the stream. */
export function appendCiRuns(
  dir: string,
  scope: string,
  rows: readonly CiRunRow[]
): { appended: number; alreadyPresent: number } {
  const filePath = ciRunsPath(dir, scope);
  const existing = readNdjson<CiRunRow>(filePath);
  const seen = new Set(existing.map((r) => `${r.repo}#${r.runId}#${r.attempt}`));

  const fresh: CiRunRow[] = [];
  for (const row of rows) {
    const key = `${row.repo}#${row.runId}#${row.attempt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(row);
  }

  appendNdjson(filePath, fresh);
  return { appended: fresh.length, alreadyPresent: existing.length };
}

function emptyWatermark(anchor: string): CiWatermark {
  return {
    anchor,
    page: 1,
    complete: false,
    runsSeen: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Crawl CI history for `targets`, spending at most `config.pagesPerRun` pages.
 *
 * Repositories are visited in order and each may take up to
 * `config.maxPagesPerRepo` pages per run, so one repository with a decade of
 * builds cannot starve the rest of the organisation.
 */
export async function runCiCrawl(
  historyDir: string,
  scope: string,
  targets: readonly CiTarget[],
  config: CiHealthConfig,
  today = new Date().toISOString().slice(0, 10)
): Promise<CiCrawlResult> {
  const state = loadCiState(historyDir, scope);

  const result: CiCrawlResult = {
    reposTouched: 0,
    reposCompleted: 0,
    reposAlreadyComplete: 0,
    reposSkipped: 0,
    pagesFetched: 0,
    rowsAppended: 0,
    allComplete: false,
  };

  let budget = config.pagesPerRun;

  for (const target of targets) {
    const { fullName, defaultBranch } = target;
    const mark = state.repos[fullName] ?? emptyWatermark(today);

    if (mark.complete) {
      state.repos[fullName] = mark;
      result.reposAlreadyComplete++;
      continue;
    }
    if (!defaultBranch) {
      // Without a trunk there is no "default-branch build", and guessing one
      // would quietly measure a different thing per repository.
      result.reposSkipped++;
      continue;
    }
    if (budget <= 0) {
      state.repos[fullName] = mark;
      continue;
    }

    const slashIndex = fullName.indexOf("/");
    if (slashIndex <= 0 || slashIndex === fullName.length - 1) {
      console.warn(`  ⚠ ci: skipping malformed repo name ${fullName}`);
      continue;
    }
    const owner = fullName.slice(0, slashIndex);
    const repo = fullName.slice(slashIndex + 1);

    let current = mark;
    let pagesThisRepo = 0;
    let touched = false;

    while (budget > 0 && pagesThisRepo < config.maxPagesPerRepo && !current.complete) {
      const page = await fetchWorkflowRunPage(
        owner,
        repo,
        defaultBranch,
        current.anchor,
        current.page
      );
      budget--;
      pagesThisRepo++;

      if (page === null) break; // inaccessible or failing — retry a later run

      touched = true;
      result.pagesFetched++;

      if (page.runs.length > 0) {
        const rows = page.runs.map((run) => toCiRunRow(scope, fullName, run));
        result.rowsAppended += appendCiRuns(historyDir, scope, rows).appended;
      }

      current = advance(current, page.runs, page.hasMore);

      if (current.complete) {
        result.reposCompleted++;
        console.log(
          `  ✓ ${fullName} CI history complete — ${current.runsSeen} runs back to ` +
            `${current.oldestCreatedAt?.slice(0, 10) ?? "unknown"}`
        );
        break;
      }
    }

    if (touched) {
      result.reposTouched++;
      if (!current.complete) {
        console.log(
          `  → ${fullName} at ${current.runsSeen} CI runs ` +
            `(back to ${current.oldestCreatedAt?.slice(0, 10) ?? "unknown"}); more next run`
        );
      }
    }
    state.repos[fullName] = current;
  }

  saveCiState(historyDir, state);

  result.allComplete = targets.every(
    (t) => !t.defaultBranch || state.repos[t.fullName]?.complete === true
  );
  return result;
}

/** Advance a watermark with what one page returned. */
function advance(
  mark: CiWatermark,
  runs: readonly WorkflowRunFacts[],
  hasMore: boolean
): CiWatermark {
  let oldest = mark.oldestCreatedAt;
  let newest = mark.newestCreatedAt;
  for (const run of runs) {
    if (!oldest || run.createdAt < oldest) oldest = run.createdAt;
    if (!newest || run.createdAt > newest) newest = run.createdAt;
  }
  return {
    anchor: mark.anchor,
    page: mark.page + 1,
    complete: !hasMore,
    runsSeen: mark.runsSeen + runs.length,
    oldestCreatedAt: oldest,
    newestCreatedAt: newest,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * A repository that has finished its crawl still needs today's builds.
 *
 * Once complete, the watermark is reset to a fresh anchor so the next run
 * walks the newest page again — one page per repository per run, which is what
 * keeps the steady-state cost flat instead of growing with history.
 */
export function rearmCompleted(state: CiState, today: string): CiState {
  const repos: Record<string, CiWatermark> = {};
  for (const [name, mark] of Object.entries(state.repos)) {
    repos[name] =
      mark.complete && mark.anchor !== today
        ? { ...mark, anchor: today, page: 1, complete: false, updatedAt: new Date().toISOString() }
        : mark;
  }
  return { ...state, repos };
}

// ── Derivation ────────────────────────────────────────────────────────────────

/**
 * Reduce stored run attempts to one sample per run.
 *
 * A re-run appends a second row for the same run id. The last attempt is what
 * actually happened; the earlier ones are only evidence that it took more than
 * one try, which is exactly the flakiness signal — a run that failed and then
 * passed on the same commit, with no new code in between.
 *
 * Only completed runs on `branch` are kept, and only cancelled and skipped
 * conclusions are dropped: a cancelled build is a human changing their mind,
 * not a broken pipeline, and counting it as a failure would make every busy
 * repository look unhealthy.
 */
export function toCiSamples(
  rows: readonly CiRunRow[],
  repoName: (fullName: string) => string = (n) => n.slice(n.indexOf("/") + 1)
): CiRunSample[] {
  const byRun = new Map<string, CiRunRow[]>();
  for (const row of rows) {
    const key = `${row.repo}#${row.runId}`;
    const list = byRun.get(key);
    if (list) list.push(row);
    else byRun.set(key, [row]);
  }

  const samples: CiRunSample[] = [];
  for (const attempts of byRun.values()) {
    const latest = attempts.reduce((a, b) => (b.attempt > a.attempt ? b : a));
    if (!latest.completedAt || !latest.conclusion) continue;
    if (latest.conclusion === "cancelled" || latest.conclusion === "skipped") continue;

    const success = latest.conclusion === "success";
    const duration = minutesBetween(latest.startedAt ?? latest.createdAt, latest.completedAt);
    const queue = minutesBetween(latest.createdAt, latest.startedAt);

    samples.push({
      repo: repoName(latest.repo),
      workflow: latest.workflow,
      finishedAt: latest.completedAt,
      success,
      // A success that needed more than one attempt on the same commit is the
      // definition of flaky used here: it failed, nothing changed, it passed.
      flaky: success && latest.attempt > 1,
      durationMinutes: duration,
      queueMinutes: queue,
    });
  }

  return samples.sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : 1));
}

function minutesBetween(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return round(ms / 60_000);
}

/** An aggregate of CI samples, for the run log and the report. */
export interface CiHealthSummary {
  /** Completed runs behind the figures. */
  runs: number;
  /** Successful runs. */
  successes: number;
  /** Success rate as a percentage; undefined when nothing concluded. */
  successRate?: number;
  /** Wall-clock duration quantiles in minutes. */
  durationP50?: number;
  durationP75?: number;
  durationP90?: number;
  /** Runs behind the duration quantiles. */
  durationN: number;
  /** Queue delay quantiles in minutes — how long a run waited for a runner. */
  queueP50?: number;
  queueP90?: number;
  /** Runs behind the queue quantiles. */
  queueN: number;
  /** Runs that passed only after a re-run of the same commit. */
  flakyRuns: number;
  /** Those runs as a percentage of all completed runs. */
  flakyRate?: number;
}

/** Aggregate CI samples into the summary shown in the run log. */
export function summariseCiHealth(samples: readonly CiRunSample[]): CiHealthSummary {
  const durations = samples
    .map((s) => s.durationMinutes)
    .filter((n): n is number => typeof n === "number");
  const queues = samples
    .map((s) => s.queueMinutes)
    .filter((n): n is number => typeof n === "number");
  const successes = samples.filter((s) => s.success).length;
  const flaky = samples.filter((s) => s.flaky).length;

  const dq = quantiles(durations);
  const qq = quantiles(queues);

  return {
    runs: samples.length,
    successes,
    successRate: samples.length > 0 ? round((successes / samples.length) * 100, 1) : undefined,
    durationP50: durations.length > 0 ? round(dq.p50, 1) : undefined,
    durationP75: durations.length > 0 ? round(dq.p75, 1) : undefined,
    durationP90: durations.length > 0 ? round(dq.p90, 1) : undefined,
    durationN: durations.length,
    queueP50: queues.length > 0 ? round(qq.p50, 1) : undefined,
    queueP90: queues.length > 0 ? round(qq.p90, 1) : undefined,
    queueN: queues.length,
    flakyRuns: flaky,
    flakyRate: samples.length > 0 ? round((flaky / samples.length) * 100, 1) : undefined,
  };
}

/** One-line summary of a CI crawl, for the run log. */
export function describeCiCrawl(
  result: CiCrawlResult,
  config: CiHealthConfig
): string {
  const skipped =
    result.reposSkipped > 0
      ? ` ${result.reposSkipped} repo(s) skipped (no known default branch).`
      : "";
  if (result.allComplete && result.pagesFetched === 0) {
    return `CI history up to date — nothing to fetch this run.${skipped}`;
  }
  return (
    `CI crawl: ${result.pagesFetched}/${config.pagesPerRun} pages spent, ` +
    `${result.rowsAppended} run(s) recorded, ` +
    `${result.reposCompleted} repo(s) caught up this run, ` +
    `${result.reposAlreadyComplete} already caught up.${skipped}`
  );
}
