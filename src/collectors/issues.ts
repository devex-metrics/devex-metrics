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

  try {
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
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 403) {
      if (status === 403) {
        console.warn(`  ⚠ issues: skipping ${owner}/${repo}: access denied (403) — token may need SAML SSO authorization`);
      }
      return { open: 0, closed: 0 };
    }
    throw err;
  }
}
