import { getOctokit } from "../github-client.js";
import type { IssueCounts, IssueLeadTime, MergedPRSummary } from "../types.js";

/**
 * Count open and closed issues for a repository (REST fallback).
 *
 * Used only when the primary GraphQL path in `collectRepoGraphQL` returns
 * null (e.g. the repo can't be queried via GraphQL). Uses the Search API,
 * which returns `total_count` directly and explicitly filters out PRs via
 * `type:issue`.
 *
 * The previous implementation derived totals from the `Link` header on
 * `issues.listForRepo` with `per_page=1`, but GitHub has migrated the issues
 * endpoint to cursor-based pagination, so the `Link` header no longer
 * exposes a `rel="last"` page number. That made every repo report at most
 * 1 open + 1 closed issue.
 */
export async function collectIssueCounts(
  owner: string,
  repo: string
): Promise<IssueCounts> {
  const octokit = await getOctokit();

  try {
    const [openRes, closedRes] = await Promise.all([
      octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} type:issue state:open`,
        per_page: 1,
        advanced_search: "true",
      }),
      octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} type:issue state:closed`,
        per_page: 1,
        advanced_search: "true",
      }),
    ]);

    return {
      open: Math.max(0, openRes.data.total_count),
      closed: Math.max(0, closedRes.data.total_count),
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 403 || status === 422) {
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
