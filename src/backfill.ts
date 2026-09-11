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
import type { HistoricalPRNode, HistoricalPageFailure } from "./collectors/repo-graphql.js";
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
  /**
   * Repositories still incomplete purely because this run's page budget
   * (organisation-wide `pagesPerRun` or per-repository `maxPagesPerRepo`)
   * was reached — an ordinary, expected state, not a failure. More pages
   * remain and will be fetched on a later run.
   */
  reposIncomplete: number;
  /**
   * Repositories where this run stopped early because a transient/generic
   * GraphQL error outlasted the bounded retries. Their watermark is left
   * exactly where it was after the last successfully appended page, so they
   * resume from there next run rather than being marked complete or reset.
   */
  reposDeferred: number;
  /**
   * Repositories skipped this run because they were inaccessible (403), not
   * found (404), or disappeared/were renamed/archived mid-crawl. Their
   * watermark is likewise left untouched.
   */
  reposSkipped: number;
  /** Repositories that began crawling for the first time this run (no prior cursor). */
  reposStarted: number;
  /** Repositories that continued this run from a cursor saved by an earlier run. */
  reposResumed: number;
  /** Pages fetched, against the run's budget. */
  pagesFetched: number;
  /** Event rows appended. */
  eventsAppended: number;
  /** Event rows seen again (already recorded) — safe, expected on a resumed/repeated page. */
  duplicateEventsIgnored: number;
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
    reposIncomplete: 0,
    reposDeferred: 0,
    reposSkipped: 0,
    reposStarted: 0,
    reposResumed: 0,
    pagesFetched: 0,
    eventsAppended: 0,
    duplicateEventsIgnored: 0,
    allComplete: false,
  };

  let budget = config.pagesPerRun;

  // The `finally` below persists whatever progress has accumulated in
  // `state.repos` regardless of how the loop exits — including an unexpected
  // exception thrown for a later repository. That way a genuinely fatal
  // error (auth failure, GraphQL validation error, a local filesystem
  // failure) still terminates the run by propagating out of runBackfill,
  // but never costs the durably-appended progress already made on earlier
  // repositories in the same run.
  try {
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
        result.reposIncomplete++;
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
      let outcome: "completed" | "deferred" | "skipped" | "incomplete" = "incomplete";
      // Captured before this run touches the watermark, so a later "recovered"
      // log line reflects the repository's state coming into this run, not
      // whatever this run itself just changed it to.
      const isResume = mark.cursor !== null;
      const hadPriorFailure = (mark.consecutiveFailedRuns ?? 0) > 0;

      if (config.maxPagesPerRepo > 0) {
        console.log(
          `  → ${fullName} ${isResume ? "resuming from saved cursor" : "starting fresh"}`
        );
      }

      try {
        while (
          budget > 0 &&
          pagesThisRepo < config.maxPagesPerRepo &&
          !current.complete
        ) {
          // `fetchHistoricalPRPage` resolves a recognized, repository-local,
          // recoverable condition to `{ ok: false }` instead of throwing (see
          // HistoricalPageOutcome), so recovering from it below is a plain
          // branch, not a broad try/catch. Anything else it throws — auth
          // failures, GraphQL validation/schema errors, or an unexpected
          // programming error — is not one of those recognized conditions
          // and is re-thrown by the surrounding catch, unhandled.
          const pageOutcome = await fetchHistoricalPRPage(owner, repo, current.cursor);
          budget--;
          pagesThisRepo++;

          if (!pageOutcome.ok) {
            // `current` still holds the last cursor whose events were durably
            // appended, so this repository resumes from exactly that point
            // next run — never advanced past an unrecorded page, never reset.
            // Diagnostics are attached alongside it (never consulted to make
            // cursor/completion decisions) so the next run's operator can see
            // why, without the cursor itself ever moving.
            outcome = pageOutcome.failure.kind === "transient" ? "deferred" : "skipped";
            current = {
              ...current,
              deferredAt: new Date().toISOString(),
              lastErrorCategory: pageOutcome.failure.category,
              lastRequestId: pageOutcome.failure.requestId,
              consecutiveFailedRuns: (current.consecutiveFailedRuns ?? 0) + 1,
            };
            state.repos[fullName] = current;
            saveBackfillState(historyDir, state);
            logRepoDeferredOrSkipped(fullName, outcome, pageOutcome.failure);
            break;
          }

          const page = pageOutcome.page;
          touched = true;
          result.pagesFetched++;

          if (page.nodes.length > 0) {
            const rows = page.nodes.map((node) => toEventRow(scope, fullName, node));
            const appendResult = appendEventRows(historyDir, scope, rows);
            result.eventsAppended += appendResult.appended;
            result.duplicateEventsIgnored += rows.length - appendResult.appended;
          }

          // Cursor only moves forward once this page's events are durably
          // appended — fetch, then append, then advance, in that order. The
          // watermark (including this new cursor) is then persisted before
          // the next page is requested, so a process that ends here — killed,
          // crashed, or simply out of time — never loses more than the page
          // it is currently mid-fetch on, and never re-requests a page whose
          // events already made it to durable history.
          current = advance(current, page.nodes, page.endCursor, page.hasNextPage);
          state.repos[fullName] = current;
          saveBackfillState(historyDir, state);

          if (current.complete) {
            outcome = "completed";
            result.reposCompleted++;
            console.log(
              `  ✓ ${fullName} fully crawled — ${current.prsSeen} PRs back to ` +
                `${current.oldestCreatedAt?.slice(0, 10) ?? "unknown"}`
            );
            break;
          }
        }
      } catch (err) {
        // Unrecognized failure: not one of fetchHistoricalPRPage's classified
        // repository-local outcomes, so it is treated as global/programming
        // and must terminate the whole run — but `current`/`touched` for
        // this repository, and every already-processed repository before it,
        // are still recorded here so the `finally` below can save them.
        state.repos[fullName] = current;
        if (touched) result.reposTouched++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `  ✗ backfill: unrecoverable error while crawling ${fullName} after ${pagesThisRepo} ` +
            `page(s) this run (${message}); aborting run`
        );
        throw err;
      }

      if (outcome === "deferred") result.reposDeferred++;
      else if (outcome === "skipped") result.reposSkipped++;
      else if (outcome === "incomplete") {
        result.reposIncomplete++;
        if (touched) {
          console.log(
            `  → ${fullName} at ${current.prsSeen} PRs ` +
              `(from ${current.oldestCreatedAt?.slice(0, 10) ?? "unknown"}); more next run`
          );
        }
      }
      if (touched) {
        result.reposTouched++;
        if (isResume) result.reposResumed++;
        else result.reposStarted++;
        if (hadPriorFailure && (outcome === "completed" || outcome === "incomplete")) {
          // This repository failed on a previous run but this run fetched at
          // least one page successfully — the diagnostic fields above have
          // already been cleared by `advance()`, so this is purely a log line.
          console.log(`  ✓ ${fullName} recovered — advancing again after a prior failed run`);
        }
      }
      state.repos[fullName] = current;
    }
  } finally {
    saveBackfillState(historyDir, state);
  }

  result.allComplete = targets.every((t) => state.repos[t.fullName]?.complete === true);
  return result;
}

/**
 * Emit the single, consolidated warning for a repository the run could not
 * make progress on this time — never anything more than the repository name,
 * a concise error category, attempt count, and GitHub's support request id;
 * no tokens, headers, or raw payloads.
 */
function logRepoDeferredOrSkipped(
  fullName: string,
  outcome: "deferred" | "skipped",
  failure: HistoricalPageFailure
): void {
  const attemptsNote =
    failure.attempts !== undefined
      ? ` after ${failure.attempts} failed attempt${failure.attempts === 1 ? "" : "s"}`
      : "";
  const requestNote = failure.requestId ? `, request ${failure.requestId}` : "";
  console.warn(
    `  ⚠ backfill: ${fullName} ${outcome}${attemptsNote} ` +
      `(${failure.category}${requestNote}). ` +
      `Progress preserved; repository will resume next run.`
  );
}

/** One-line summary of a backfill run. */
export function describeBackfill(
  result: BackfillResult,
  config: BackfillConfig
): string {
  if (result.allComplete) {
    return `History complete — every repository crawled to its first pull request.`;
  }
  const duplicateNote =
    result.duplicateEventsIgnored > 0 ? `, ${result.duplicateEventsIgnored} duplicate events ignored` : "";
  return (
    `Backfill: ${result.pagesFetched}/${config.pagesPerRun} pages spent, ` +
    `${result.eventsAppended} events appended${duplicateNote}, ` +
    `${result.reposStarted} started, ${result.reposResumed} resumed, ` +
    `${result.reposCompleted} repositories completed, ` +
    `${result.reposIncomplete} incomplete, ` +
    `${result.reposDeferred} deferred, ` +
    `${result.reposSkipped} skipped ` +
    `(${result.reposAlreadyComplete} already complete). Continues next run.`
  );
}

