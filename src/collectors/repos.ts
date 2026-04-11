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
  return repos;
}
