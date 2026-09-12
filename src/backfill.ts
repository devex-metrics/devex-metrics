/**
 * Progressive historical backfill.
 *
 * The daily collection is bounded by a two-year cutoff so a scheduled run stays
 * cheap. That leaves everything older uncollected — not lost, merely never
 * requested. This module walks each repository from its first pull request
 * forward, a bounded number of pages per run, until the whole history is in the
 * event stream. Once a repository reports no further pages it is marked
 * complete and never costs anything again.
 *
 * The work is spread across runs on purpose: a large organisation is thousands
 * of pages, which would blow the GraphQL rate limit if attempted at once, and
 * there is no hurry — the history is not going anywhere.
 */

import { fetchHistoricalPRPage } from "./collectors/repo-graphql.js";
import { parseRevertRef } from "./collectors/pull-requests.js";
import type { HistoricalPRNode } from "./collectors/repo-graphql.js";
import {
  appendEventRows,
  loadBackfillState,
  saveBackfillState,
  HISTORY_SCHEMA_VERSION,
} from "./history.js";
import type { BackfillState, EventRow, RepoWatermark } from "./history.js";
import { round } from "./stats.js";
import type { BackfillConfig } from "./config.js";

/** A repository to crawl, as `owner/repo`. */
export interface BackfillTarget {
  fullName: string;
}

/** What one backfill run achieved. */
export interface BackfillResult {
  /** Repositories that had pages fetched this run. */
  reposTouched: number;
  /** Repositories that finished their crawl this run. */
  reposCompleted: number;
  /** Repositories already complete before this run. */
  reposAlreadyComplete: number;
  /** Pages fetched, against the run's budget. */
  pagesFetched: number;
  /** Event rows appended. */
  eventsAppended: number;
  /** True when every target repository is now fully crawled. */
  allComplete: boolean;
}

/** Detect AI authorship from a login alone (the lean crawl has no commit data). */
function aiTypeFromLogin(
  login: string
): "copilot" | "claude" | "codex" | undefined {
  const l = login.toLowerCase();
  if (l === "copilot" || l === "copilot[bot]" || l.startsWith("copilot-swe")) {
    return "copilot";
  }
  if (l.startsWith("claude")) return "claude";
  if (l.startsWith("codex")) return "codex";
  return undefined;
}

function isBotLogin(login: string, typename?: string): boolean {
  return typename === "Bot" || login.toLowerCase().endsWith("[bot]");
}

/** Convert one historical PR node into an event row. */
export function toEventRow(
  scope: string,
  repo: string,
  node: HistoricalPRNode
): EventRow {
  const login = node.author?.login ?? "unknown";
  const merged = node.state === "MERGED" && node.mergedAt !== null;

  const reviewTimes = node.reviews.nodes
    .map((r) => r.submittedAt)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .sort();
  const approvalTimes = node.reviews.nodes
    .filter((r) => r.state === "APPROVED")
    .map((r) => r.submittedAt)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .sort();
  const changesRequested = node.reviews.nodes.filter(
    (r) => r.state === "CHANGES_REQUESTED"
  ).length;
  const reviewers = [
    ...new Set(
      node.reviews.nodes
        .map((r) => r.author?.login)
        .filter((l): l is string => typeof l === "string" && l.length > 0)
    ),
  ];

  const row: EventRow = {
    v: HISTORY_SCHEMA_VERSION,
    scope,
    repo,
    number: node.number,
    state: merged ? "merged" : "closed",
    author: login,
    isBot: isBotLogin(login, node.author?.__typename),
    createdAt: node.createdAt,
    linesAdded: node.additions,
    linesDeleted: node.deletions,
  };

  const aiType = aiTypeFromLogin(login);
  if (aiType) row.aiAuthorType = aiType;
  if (node.closedAt) row.closedAt = node.closedAt;
  if (merged && node.mergedAt) {
    row.mergedAt = node.mergedAt;
    const hours =
      (new Date(node.mergedAt).getTime() - new Date(node.createdAt).getTime()) /
      3_600_000;
    if (Number.isFinite(hours) && hours >= 0) row.timeToMergeHours = round(hours);
  }
  if (node.reviews.totalCount > 0) row.reviewCount = node.reviews.totalCount;
  if (reviewTimes.length > 0) row.firstReviewAt = reviewTimes[0];
  if (approvalTimes.length > 0) row.firstApprovalAt = approvalTimes[0];
  // Only recorded when at least one review carried a state, so a row written
  // before the field existed is absent rather than a misleading zero.
  if (node.reviews.nodes.some((r) => r.state !== undefined)) {
    row.changesRequestedCount = changesRequested;
  }
  if (reviewers.length > 0) row.reviewers = reviewers;
  const reverts = parseRevertRef(node.body);
  if (reverts !== undefined) row.revertsPR = reverts;

  return row;
}

function emptyWatermark(): RepoWatermark {
  return {
    cursor: null,
    complete: false,
    pagesFetched: 0,
    prsSeen: 0,
    updatedAt: new Date().toISOString(),
  };
}

/** Advance a watermark with what one page returned. */
function advance(
  mark: RepoWatermark,
  nodes: readonly HistoricalPRNode[],
  endCursor: string | null,
  hasNextPage: boolean
): RepoWatermark {
  let oldest = mark.oldestCreatedAt;
  let newest = mark.newestCreatedAt;
  for (const node of nodes) {
    if (!oldest || node.createdAt < oldest) oldest = node.createdAt;
    if (!newest || node.createdAt > newest) newest = node.createdAt;
  }
  return {
    // Keep the last cursor when GitHub returns none, so a resumed run does not
    // silently restart the repository from its first pull request.
    cursor: endCursor ?? mark.cursor,
    complete: !hasNextPage,
    pagesFetched: mark.pagesFetched + 1,
    prsSeen: mark.prsSeen + nodes.length,
    oldestCreatedAt: oldest,
    newestCreatedAt: newest,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Crawl history for `targets`, spending at most `config.pagesPerRun` pages.
 *
 * Repositories are visited in order and each may take up to
 * `config.maxPagesPerRepo` pages per run, so one very large repository cannot
 * starve the rest of the organisation.
 */
export async function runBackfill(
  historyDir: string,
  scope: string,
  targets: readonly BackfillTarget[],
  config: BackfillConfig
): Promise<BackfillResult> {
  const state: BackfillState = loadBackfillState(historyDir, scope);

  const result: BackfillResult = {
    reposTouched: 0,
    reposCompleted: 0,
    reposAlreadyComplete: 0,
    pagesFetched: 0,
    eventsAppended: 0,
    allComplete: false,
  };

  let budget = config.pagesPerRun;

  for (const { fullName } of targets) {
    const mark = state.repos[fullName] ?? emptyWatermark();
    if (mark.complete) {
      state.repos[fullName] = mark;
      result.reposAlreadyComplete++;
      continue;
    }
    if (budget <= 0) {
      // Out of budget — leave the watermark untouched so the next run resumes here.
      state.repos[fullName] = mark;
      continue;
    }

    const slashIndex = fullName.indexOf("/");
    if (slashIndex <= 0 || slashIndex === fullName.length - 1) {
      console.warn(`  ⚠ backfill: skipping malformed repo name ${fullName}`);
      continue;
    }
    const owner = fullName.slice(0, slashIndex);
    const repo = fullName.slice(slashIndex + 1);

    let current = mark;
    let pagesThisRepo = 0;
    let touched = false;

    while (
      budget > 0 &&
      pagesThisRepo < config.maxPagesPerRepo &&
      !current.complete
    ) {
      const page = await fetchHistoricalPRPage(owner, repo, current.cursor);
      budget--;
      pagesThisRepo++;

      if (page === null) {
        // Inaccessible or persistently failing — retry on a later run.
        break;
      }

      touched = true;
      result.pagesFetched++;

      if (page.nodes.length > 0) {
        const rows = page.nodes.map((node) => toEventRow(scope, fullName, node));
        result.eventsAppended += appendEventRows(historyDir, scope, rows).appended;
      }

      current = advance(current, page.nodes, page.endCursor, page.hasNextPage);

      if (current.complete) {
        result.reposCompleted++;
        console.log(
          `  ✓ ${fullName} fully crawled — ${current.prsSeen} PRs back to ` +
            `${current.oldestCreatedAt?.slice(0, 10) ?? "unknown"}`
        );
        break;
      }
    }

    if (touched) {
      result.reposTouched++;
      if (!current.complete) {
        console.log(
          `  → ${fullName} at ${current.prsSeen} PRs ` +
            `(from ${current.oldestCreatedAt?.slice(0, 10) ?? "unknown"}); more next run`
        );
      }
    }
    state.repos[fullName] = current;
  }

  saveBackfillState(historyDir, state);

  result.allComplete = targets.every((t) => state.repos[t.fullName]?.complete === true);
  return result;
}

/** One-line summary of a backfill run. */
export function describeBackfill(
  result: BackfillResult,
  config: BackfillConfig
): string {
  if (result.allComplete) {
    return `History complete — every repository crawled to its first pull request.`;
  }
  return (
    `Backfill: ${result.pagesFetched}/${config.pagesPerRun} pages spent, ` +
    `${result.eventsAppended} PRs recorded, ` +
    `${result.reposCompleted} repo(s) finished this run, ` +
    `${result.reposAlreadyComplete} already complete. Continues next run.`
  );
}
