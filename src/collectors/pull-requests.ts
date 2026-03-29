import { getOctokit } from "../github-client.js";
import { getCountFromLinkHeader } from "../link-header.js";
import type { PullRequestCounts, PullRequestDetail } from "../types.js";

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
}

/**
 * Collect detailed metrics for the most recent merged PRs (up to `limit`).
 */
export async function collectPullRequestDetails(
  owner: string,
  repo: string,
  limit = 10
): Promise<PullRequestDetail[]> {
  const octokit = await getOctokit();

  // Get recent merged PRs
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: limit,
  });

  const mergedPrs = prs.filter((pr) => pr.merged_at !== null);

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

      details.push({
        number: pr.number,
        title: pr.title,
        state: pr.merged_at ? "merged" : "closed",
        linesAdded: detail.additions,
        linesDeleted: detail.deletions,
        commentCount: detail.comments + detail.review_comments,
        commitCount: detail.commits,
        actionsMinutes: Math.round(actionsMinutes * 100) / 100,
      });
    } catch {
      // Skip PRs we cannot fetch details for
    }
  }
  return details;
}
