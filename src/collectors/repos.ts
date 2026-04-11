import { getOctokit } from "../github-client.js";

/**
 * Fetch all repos for an org or user.
 * Returns basic repo info used by downstream collectors.
 */
export async function collectRepos(
  owner: string,
  ownerType: "org" | "user"
): Promise<{ name: string; fullName: string; pushedAt: string }[]> {
  const octokit = await getOctokit();
  const repos: { name: string; fullName: string; pushedAt: string }[] = [];

  if (ownerType === "org") {
    for await (const response of octokit.paginate.iterator(
      octokit.rest.repos.listForOrg,
      { org: owner, per_page: 100, type: "all" }
    )) {
      for (const repo of response.data) {
        repos.push({
          name: repo.name,
          fullName: repo.full_name,
          pushedAt: repo.pushed_at ?? "",
        });
      }
    }
  } else {
    // GET /users/{username}/repos only returns repos where the user is an
    // explicit per-repo collaborator — it misses org repos accessible purely
    // via org membership (even public ones). When the token belongs to the
    // same user we're collecting for, use GET /user/repos instead, which
    // includes repos reachable through org membership.
    let useAuthEndpoint = false;
    try {
      const { data: authUser } = await octokit.rest.users.getAuthenticated();
      useAuthEndpoint = authUser.login.toLowerCase() === owner.toLowerCase();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 401 && status !== 403) {
        // Unexpected error — log and fall back gracefully
        console.warn(`  ⚠ repos: could not determine authenticated user, falling back to public list: ${String(err)}`);
      }
      // 401/403 means the token has no user context (e.g. GitHub App) — silent fallback
    }

    if (useAuthEndpoint) {
      for await (const response of octokit.paginate.iterator(
        octokit.rest.repos.listForAuthenticatedUser,
        { per_page: 100, type: "all" }
      )) {
        for (const repo of response.data) {
          repos.push({
            name: repo.name,
            fullName: repo.full_name,
            pushedAt: repo.pushed_at ?? "",
          });
        }
      }
    } else {
      for await (const response of octokit.paginate.iterator(
        octokit.rest.repos.listForUser,
        { username: owner, per_page: 100, type: "all" }
      )) {
        for (const repo of response.data) {
          repos.push({
            name: repo.name,
            fullName: repo.full_name,
            pushedAt: repo.pushed_at ?? "",
          });
        }
      }
    }
  }
  return repos;
}
