import { loadCache, saveCache } from "./cache.js";
import {
  collectRepos,
  collectIssueCounts,
  collectPullRequestCounts,
  collectPullRequestDetails,
  collectContributors,
  collectDependentCount,
  collectWeeklyTrends,
} from "./collectors/index.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";

export interface CollectOptions {
  /** Skip all cached/fixture data and force a fresh API fetch. */
  skipCache?: boolean;
}

/**
 * Collect metrics for every repo owned by `owner`.
 */
export async function collect(
  owner: string,
  ownerType: "org" | "user",
  options: CollectOptions = {}
): Promise<OrgMetrics> {
  if (!options.skipCache) {
    const cached = loadCache(owner);
    if (cached) {
      console.log(`Using cached data for ${owner} (collected ${cached.collectedAt})`);
      return cached;
    }
  }

  console.log(`Collecting fresh metrics for ${owner} (${ownerType})…`);

  const repoList = await collectRepos(owner, ownerType);
  console.log(`Found ${repoList.length} repositories`);

  const repos: RepoMetrics[] = [];

  for (const { fullName, pushedAt } of repoList) {
    console.log(`  → ${fullName}`);

    // fullName is "repoOwner/repoName" – repos may belong to a different org/user
    // than the top-level owner (e.g. org repos returned for a user query).
    const slashIndex = fullName.indexOf("/");
    if (slashIndex <= 0 || slashIndex === fullName.length - 1) {
      console.warn(`  ⚠ Skipping repo with unexpected fullName format: ${fullName}`);
      continue;
    }
    const repoOwner = fullName.slice(0, slashIndex);
    const repoName = fullName.slice(slashIndex + 1);

    const [issues, prCounts, prDetails, contributors, dependentCount] =
      await Promise.all([
        collectIssueCounts(repoOwner, repoName),
        collectPullRequestCounts(repoOwner, repoName),
        collectPullRequestDetails(repoOwner, repoName),
        collectContributors(repoOwner, repoName),
        collectDependentCount(repoOwner, repoName),
      ]);

    repos.push({
      name: repoName,
      fullName,
      pushedAt,
      issues,
      pullRequests: prCounts,
      pullRequestDetails: prDetails,
      committerCount: contributors.committerCount,
      reviewerCount: contributors.reviewerCount,
      dependentCount,
    });
  }

  console.log("Collecting weekly trends…");
  const trendRepos = repos.map((r) => {
    const slash = r.fullName.indexOf("/");
    return { owner: r.fullName.slice(0, slash), name: r.name };
  });
  const weeklyTrends = await collectWeeklyTrends(trendRepos);

  const metrics: OrgMetrics = {
    owner,
    ownerType,
    collectedAt: new Date().toISOString(),
    repoCount: repos.length,
    repos,
    weeklyTrends,
  };

  saveCache(owner, metrics);
  return metrics;
}
