import { getOctokit } from "../github-client.js";
import { getCountFromLinkHeader } from "../link-header.js";
import type { IssueCounts } from "../types.js";

/**
 * Count open and closed issues for a repository.
 *
 * Uses the list-issues and list-pull-requests endpoints with `per_page=1`
 * and parses the Link header to derive totals.  Because the issues endpoint
 * includes pull requests in its results, the PR counts are subtracted to
 * produce issue-only numbers.
 */
export async function collectIssueCounts(
  owner: string,
  repo: string
): Promise<IssueCounts> {
  const octokit = await getOctokit();

  const [openAll, closedAll, openPrs, closedPrs] = await Promise.all([
    octokit.rest.issues.listForRepo({ owner, repo, state: "open", per_page: 1 }),
    octokit.rest.issues.listForRepo({ owner, repo, state: "closed", per_page: 1 }),
    octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 1 }),
    octokit.rest.pulls.list({ owner, repo, state: "closed", per_page: 1 }),
  ]);

  return {
    open: getCountFromLinkHeader(openAll) - getCountFromLinkHeader(openPrs),
    closed: getCountFromLinkHeader(closedAll) - getCountFromLinkHeader(closedPrs),
  };
}
