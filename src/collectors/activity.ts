import { getOctokit } from "../github-client.js";

/** The Search API never returns more than this many results for one query. */
const SEARCH_RESULT_CAP = 1000;
const PER_PAGE = 100;

/**
 * Find the repositories owned by `owner` whose issues or pull requests were
 * updated (opened, closed, merged, commented, relabelled…) at or after
 * `since`.
 *
 * Pushes are not covered here — callers compare `pushedAt` for that. Nor are
 * reviews: submitting one does not reliably advance the PR's `updated_at`, so
 * callers must not treat a repo with open PRs as unchanged on this alone.
 *
 * Returns lower-cased `owner/repo` names, or `null` when the answer is
 * incomplete (the Search API was unavailable, timed out, or the activity
 * exceeds its 1000-result window), so the caller can fall back to a full
 * collection instead of trusting a partial list.
 */
export async function collectActiveRepos(
  owner: string,
  ownerType: "org" | "user",
  since: string
): Promise<Set<string> | null> {
  const octokit = await getOctokit();
  const scope = `${ownerType === "org" ? "org" : "user"}:${owner}`;
  const updated = `updated:>=${since.replace(/\.\d{3}Z$/, "Z")}`;
  const active = new Set<string>();

  try {
    for (const kind of ["is:issue", "is:pr"]) {
      const q = `${scope} ${kind} ${updated}`;
      for (let page = 1; page * PER_PAGE <= SEARCH_RESULT_CAP; page++) {
        const { data } = await octokit.rest.search.issuesAndPullRequests({
          q,
          per_page: PER_PAGE,
          page,
          sort: "updated",
          order: "desc",
          advanced_search: "true",
        });
        if (data.incomplete_results || data.total_count > SEARCH_RESULT_CAP) {
          console.warn(
            `  ⚠ activity: search for "${q}" is incomplete ` +
              `(${data.total_count} results) — cannot compute a delta`
          );
          return null;
        }
        for (const item of data.items) {
          const name = repoFromUrl(item.repository_url);
          if (name) active.add(name);
        }
        if (data.items.length < PER_PAGE) break;
      }
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    console.warn(
      `  ⚠ activity: search failed (status ${status ?? "unknown"}) — cannot compute a delta`
    );
    return null;
  }

  return active;
}

/** "https://api.github.com/repos/o/r" → "o/r" (lower-cased). */
function repoFromUrl(url: string | undefined): string | null {
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(url ?? "");
  return match ? match[1].toLowerCase() : null;
}
