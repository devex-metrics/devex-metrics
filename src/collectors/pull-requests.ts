import { getOctokit } from "../github-client.js";
import type { PullRequestCounts, PullRequestDetail } from "../types.js";

/**
 * Count open, closed and merged pull requests for a repository.
 */
export async function collectPullRequestCounts(
  owner: string,
  repo: string
): Promise<PullRequestCounts> {
  const octokit = getOctokit();

  const [openResult, closedResult, mergedResult] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open`,
      per_page: 1,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:closed is:unmerged`,
      per_page: 1,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged`,
      per_page: 1,
    }),
  ]);

  return {
    open: openResult.data.total_count,
    closed: closedResult.data.total_count,
    merged: mergedResult.data.total_count,
  };
}

/**
 * Collect detailed metrics for the most recent merged PRs (up to `limit`).
 */
export async function collectPullRequestDetails(
  owner: string,
  repo: string,
  limit = 10
): Promise<PullRequestDetail[]> {
  const octokit = getOctokit();

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
