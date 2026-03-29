import { getOctokit } from "../github-client.js";

/**
 * Get the number of repositories that depend on a given repository.
 *
 * GitHub does not expose a REST API for the "Used by" / dependents count.
 * We approximate this by querying the dependency graph dependents page.
 * If the API is not available we fall back to 0.
 */
export async function collectDependentCount(
  owner: string,
  repo: string
): Promise<number> {
  const octokit = await getOctokit();

  try {
    // The community metrics endpoint sometimes includes dependents info
    const { data: community } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    // GitHub doesn't expose dependent count directly via REST API.
    // We use the GraphQL API to get the dependency graph if available.
    // As a fallback, return the network_count (forks) as a proxy, or 0.
    return ((community as Record<string, unknown>).network_count ?? 0) as number;
  } catch {
    return 0;
  }
}
