import { getOctokit } from "../github-client.js";
import { getCountFromLinkHeader } from "../link-header.js";
import type { IssueCounts } from "../types.js";

/**
 * Count open and closed issues for a repository.
 *
 * Uses the list-issues endpoint with `per_page=1` and parses the Link header
 * to derive totals. The GitHub issues API returns only issues (not pull
 * requests) for the authenticated user context, so no PR subtraction is
 * needed. Math.max(0, …) guards against any edge-case negative values.
 */
export async function collectIssueCounts(
  owner: string,
  repo: string
): Promise<IssueCounts> {
  const octokit = await getOctokit();

  try {
    const [openAll, closedAll] = await Promise.all([
      octokit.rest.issues.listForRepo({ owner, repo, state: "open", per_page: 1 }),
      octokit.rest.issues.listForRepo({ owner, repo, state: "closed", per_page: 1 }),
    ]);

    return {
      open: Math.max(0, getCountFromLinkHeader(openAll)),
      closed: Math.max(0, getCountFromLinkHeader(closedAll)),
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
