import { getOctokit } from "../github-client.js";
import { getCountFromLinkHeader } from "../link-header.js";
import type {
  PullRequestCounts,
  PullRequestDetail,
  MergedPRSummary,
  CopilotAdoption,
} from "../types.js";

const COPILOT_LOGIN = "copilot[bot]";

/**
 * Extract issue numbers from a PR body that use closing keywords.
 * Matches: Fixes #123, closes #45, Resolves #9, etc.
 */
export function parseIssueRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  const pattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    nums.add(Number(m[1]));
  }
  return [...nums];
}

function isBotLogin(login: string): boolean {
  return login.endsWith("[bot]");
}

function hoursBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000);
}

/**
 * Count open, closed and merged pull requests for a repository.
 *
 * Uses the list-pull-requests endpoint.  Open PRs are counted via the
 * Link header; closed PRs are paginated so we can separate merged from
 * unmerged.
 */
export async function collectPullRequestCounts(
  owner: string,
  repo: string
): Promise<PullRequestCounts> {
  const octokit = await getOctokit();

  try {
    // Open count via Link header (single request)
    const openRes = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 1,
    });
    const open = getCountFromLinkHeader(openRes);

    // Paginate closed PRs to distinguish merged from unmerged
    const closedPrs = await octokit.paginate(octokit.rest.pulls.list, {
      owner,
      repo,
      state: "closed",
      per_page: 100,
    });
    let merged = 0;
    let closed = 0;
    for (const pr of closedPrs) {
      if (pr.merged_at) merged++;
      else closed++;
    }

    return { open, closed, merged };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 403) {
      if (status === 403) {
        console.warn(`  ⚠ pull-requests: skipping ${owner}/${repo}: access denied (403) — token may need SAML SSO authorization`);
      }
      return { open: 0, closed: 0, merged: 0 };
    }
    throw err;
  }
}

/**
 * Collect detailed metrics for the most recent merged PRs (up to `limit`).
 * Includes Copilot authorship/review detection.
 */
export async function collectPullRequestDetails(
  owner: string,
  repo: string,
  limit = 10
): Promise<PullRequestDetail[]> {
  const octokit = await getOctokit();

  // Get recent merged PRs
  let prs: Awaited<ReturnType<typeof octokit.rest.pulls.list>>["data"] = [];
  try {
    const res = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: limit,
    });
    prs = res.data;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 403 || status === 404) {
      if (status === 403) {
        console.warn(`  ⚠ pr-details: skipping ${owner}/${repo}: access denied (403) — token may need SAML SSO authorization`);
      }
      return [];
    }
    throw err;
  }

  const mergedPrs = prs
    .filter((pr) => pr.merged_at !== null)
    .sort((a, b) => (b.merged_at! > a.merged_at! ? 1 : -1));

  const details: PullRequestDetail[] = [];
  for (const pr of mergedPrs) {
    try {
      const { data: detail } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pr.number,
      });

      // Estimate actions minutes from check-suite run durations
      let actionsMinutes = 0;
      try {
        const { data: checkRuns } =
          await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: detail.head.sha,
            per_page: 100,
          });
        for (const run of checkRuns.check_runs) {
          if (run.started_at && run.completed_at) {
            const start = new Date(run.started_at).getTime();
            const end = new Date(run.completed_at).getTime();
            actionsMinutes += (end - start) / 60000;
          }
        }
      } catch {
        // Check runs may not be accessible; leave as 0
      }

      // Detect Copilot review
      let hasCopilotReview = false;
      try {
        const { data: reviews } = await octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        });
        hasCopilotReview = reviews.some(
          (r) => r.user?.login?.toLowerCase() === COPILOT_LOGIN,
        );
      } catch {
        // Reviews may not be accessible
      }

      const authorLogin = pr.user?.login ?? "unknown";
      const isCopilotAuthored = authorLogin.toLowerCase() === COPILOT_LOGIN;

      details.push({
        number: pr.number,
        title: pr.title,
        state: pr.merged_at ? "merged" : "closed",
        createdAt: pr.created_at,
        author: authorLogin,
        isCopilotAuthored,
        hasCopilotReview,
        linesAdded: detail.additions,
        linesDeleted: detail.deletions,
        commentCount: detail.comments + detail.review_comments,
        commitCount: detail.commits,
        actionsMinutes: Math.round(actionsMinutes * 100) / 100,
        timeToMergeHours: pr.merged_at
          ? Math.round(hoursBetween(pr.created_at, pr.merged_at) * 100) / 100
          : undefined,
        mergedAt: pr.merged_at ?? undefined,
      });
    } catch {
      // Skip PRs we cannot fetch details for
    }
  }
  return details;
}

/**
 * Collect an enriched timeline of merged PRs going back up to ~13 months.
 * Paginates through closed PRs (up to maxPages×100 entries) using only the
 * cheap pulls.list call — no per-PR detail fetches.
 *
 * Each entry includes author, timing, and issue-reference metadata extracted
 * from the list response, which is enough for cycle-time charts, actor
 * breakdowns, and Copilot adoption KPIs without extra API calls.
 */
export async function collectMergedPRTimeline(
  owner: string,
  repo: string,
  maxPages = 10
): Promise<MergedPRSummary[]> {
  const octokit = await getOctokit();
  const timeline: MergedPRSummary[] = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
      });
      for (const pr of res.data) {
        if (!pr.merged_at) continue;
        const authorLogin = pr.user?.login ?? "unknown";
        timeline.push({
          number: pr.number,
          createdAt: pr.created_at,
          mergedAt: pr.merged_at,
          author: authorLogin,
          isBotAuthor: pr.user?.type === "Bot" || isBotLogin(authorLogin),
          isCopilotAuthored: authorLogin.toLowerCase() === COPILOT_LOGIN,
          timeToMergeHours:
            Math.round(hoursBetween(pr.created_at, pr.merged_at) * 100) / 100,
          closesIssues: parseIssueRefs(pr.body),
        });
      }
      if (res.data.length < 100) break; // reached the last page
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 403 || status === 404) break;
      throw err;
    }
  }
  return timeline.sort((a, b) => (b.mergedAt > a.mergedAt ? 1 : -1));
}

/**
 * Compute Copilot adoption metrics from the merged PR timeline and details.
 */
export function computeCopilotAdoption(
  timeline: MergedPRSummary[],
  details: PullRequestDetail[],
): CopilotAdoption {
  return {
    copilotAuthoredPRs: timeline.filter((p) => p.isCopilotAuthored).length,
    copilotReviewedPRs: details.filter((p) => p.hasCopilotReview).length,
    totalMergedPRs: timeline.length,
    totalDetailedPRs: details.length,
  };
}
