import { getOctokit } from "../github-client.js";
import { getCountFromLinkHeader } from "../link-header.js";
import type { IssueCounts, IssueLeadTime, MergedPRSummary } from "../types.js";

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

/**
 * Fetch creation dates for issues referenced by merged PRs and compute
 * lead-time metrics (issue creation → PR merge).
 *
 * Only fetches issues explicitly referenced via closing keywords
 * ("Fixes #N", "Closes #N") in the PR body. One API call per unique issue.
 */
export async function collectIssueLeadTimes(
  owner: string,
  repo: string,
  timeline: MergedPRSummary[],
): Promise<IssueLeadTime[]> {
  const octokit = await getOctokit();

  // Build a map: issueNumber → first (oldest) PR that closes it
  const issueToFirstPR = new Map<number, MergedPRSummary>();
  for (const entry of timeline) {
    for (const issueNum of entry.closesIssues) {
      const existing = issueToFirstPR.get(issueNum);
      if (!existing || entry.mergedAt < existing.mergedAt) {
        issueToFirstPR.set(issueNum, entry);
      }
    }
  }

  const results: IssueLeadTime[] = [];
  for (const [issueNumber, pr] of issueToFirstPR) {
    try {
      const { data: issue } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      const leadTimeHours = Math.max(
        0,
        (new Date(pr.mergedAt).getTime() - new Date(issue.created_at).getTime()) / 3_600_000,
      );

      results.push({
        issueNumber,
        issueCreatedAt: issue.created_at,
        prNumber: pr.number,
        prMergedAt: pr.mergedAt,
        leadTimeHours: Math.round(leadTimeHours * 100) / 100,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 403) continue;
      throw err;
    }
  }

  return results;
}
