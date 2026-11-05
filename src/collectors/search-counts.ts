import { getOctokit } from "../github-client.js";

/** The totals from {@link countSearchMatches}, in the order the queries were given. */
export interface SearchCounts {
  /** One total per query; zero when GitHub would not answer for the repository. */
  counts: number[];
  /** True when a total may be low, because search timed out or could not see the repository. */
  incomplete: boolean;
}

/**
 * True for the 422 Search returns when a `repo:` scope names a repository it
 * cannot see. Every other 422 means the query itself is wrong, which is a bug.
 */
function isUnsearchableRepoError(err: unknown): boolean {
  const { status, message, response } = err as {
    status?: number;
    message?: string;
    response?: { data?: unknown };
  };
  return status === 422 && /cannot be searched/i.test(`${message} ${JSON.stringify(response?.data)}`);
}

/**
 * Count Search API matches inside one repository, at one request per query.
 *
 * `incomplete` rather than a bare number: search can answer 200 with a partial
 * total when it times out, and a total nobody can vouch for must not be
 * presented as a complete count.
 */
export async function countSearchMatches(
  owner: string,
  repo: string,
  label: string,
  qualifiers: readonly string[]
): Promise<SearchCounts> {
  const octokit = await getOctokit();
  try {
    const responses = await Promise.all(
      qualifiers.map((q) =>
        octokit.rest.search.issuesAndPullRequests({
          q: `repo:${owner}/${repo} ${q}`,
          per_page: 1,
          advanced_search: "true",
        })
      )
    );
    return {
      counts: responses.map(({ data }) => Math.max(0, data.total_count)),
      incomplete: responses.some(({ data }) => data.incomplete_results === true),
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404 && status !== 403 && !isUnsearchableRepoError(err)) throw err;
    if (status === 403) {
      console.warn(`  ⚠ ${label}: skipping ${owner}/${repo}: access denied (403) — token may need SAML SSO authorization`);
    }
    return { counts: qualifiers.map(() => 0), incomplete: true };
  }
}
