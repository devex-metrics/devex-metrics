import { getOctokit } from "../github-client.js";
import type { IssueCounts } from "../types.js";

/**
 * Count open and closed issues for a repository.
 * Uses the search API for efficient counting without paginating all issues.
 */
export async function collectIssueCounts(
  owner: string,
  repo: string
): Promise<IssueCounts> {
  const octokit = await getOctokit();

  // Use the search API to get counts efficiently
  const [openResult, closedResult] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue is:open`,
      per_page: 1,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue is:closed`,
      per_page: 1,
    }),
  ]);

  return {
    open: openResult.data.total_count,
    closed: closedResult.data.total_count,
  };
}
