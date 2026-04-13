import { loadCache, loadRawCache, isWithinHours, saveCache, CURRENT_SCHEMA_VERSION } from "./cache.js";
import {
  collectRepos,
  collectIssueCounts,
  collectIssueLeadTimes,
  collectPullRequestCounts,
  collectPullRequestDetails,
  collectMergedPRTimeline,
  computeCopilotAdoption,
  collectContributors,
  collectDependentCount,
  collectWeeklyTrends,
} from "./collectors/index.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";

export interface CollectOptions {
  /** Skip all cached/fixture data and force a fresh API fetch. */
  skipCache?: boolean;
  /**
   * Maximum age in hours before a per-repo cache entry is considered stale
   * and re-fetched. Defaults to 8 hours. Only applies when skipCache is false.
   */
  maxRepoAgeHours?: number;
}

const DEFAULT_MAX_REPO_AGE_HOURS = 8;

/**
 * Collect metrics for every repo owned by `owner`.
 */
export async function collect(
  owner: string,
  ownerType: "org" | "user",
  options: CollectOptions = {}
): Promise<OrgMetrics> {
  const maxAgeHours = options.maxRepoAgeHours ?? DEFAULT_MAX_REPO_AGE_HOURS;

  if (!options.skipCache) {
    const cached = loadCache(owner);
    if (cached) {
      console.log(`Using cached data for ${owner} (collected ${cached.collectedAt})`);
      return cached;
    }
  }

  console.log(`Collecting fresh metrics for ${owner} (${ownerType})…`);

  // Build a lookup map from any existing (potentially stale) cache so we can
  // reuse per-repo data that is still within maxAgeHours.
  const cachedRepoMap = new Map<string, RepoMetrics>();
  if (!options.skipCache) {
    const raw = loadRawCache(owner);
    if (raw) {
      for (const repo of raw.repos) {
        cachedRepoMap.set(repo.fullName, repo);
      }
    }
  }

  const repoList = await collectRepos(owner, ownerType);
  console.log(`Found ${repoList.length} repositories`);

  const repos: RepoMetrics[] = [];
  let freshCount = 0;

  for (const { fullName, pushedAt } of repoList) {
    // Reuse per-repo data if it is recent enough.
    if (!options.skipCache) {
      const cached = cachedRepoMap.get(fullName);
      if (cached && isWithinHours(cached.collectedAt, maxAgeHours)) {
        console.log(`  → ${fullName} (cached)`);
        repos.push(cached);
        continue;
      }
    }

    console.log(`  → ${fullName}`);
    freshCount++;

    const slashIndex = fullName.indexOf("/");
    if (slashIndex <= 0 || slashIndex === fullName.length - 1) {
      console.warn(`  ⚠ Skipping repo with unexpected fullName format: ${fullName}`);
      continue;
    }
    const repoOwner = fullName.slice(0, slashIndex);
    const repoName = fullName.slice(slashIndex + 1);

    const [issues, prCounts, prDetails, mergedPRTimeline, contributors, dependentCount] =
      await Promise.all([
        collectIssueCounts(repoOwner, repoName),
        collectPullRequestCounts(repoOwner, repoName),
        collectPullRequestDetails(repoOwner, repoName),
        collectMergedPRTimeline(repoOwner, repoName),
        collectContributors(repoOwner, repoName),
        collectDependentCount(repoOwner, repoName),
      ]);

    // Fetch issue lead times for PRs that reference issues
    const issueLeadTimes = await collectIssueLeadTimes(
      repoOwner,
      repoName,
      mergedPRTimeline,
    );

    const copilotAdoption = computeCopilotAdoption(mergedPRTimeline, prDetails);

    repos.push({
      name: repoName,
      fullName,
      pushedAt,
      collectedAt: new Date().toISOString(),
      issues,
      pullRequests: prCounts,
      pullRequestDetails: prDetails,
      mergedPRTimeline,
      copilotAdoption,
      issueLeadTimes,
      committerCount: contributors.committerCount,
      reviewerCount: contributors.reviewerCount,
      dependentCount,
    });
  }

  // Reuse cached weekly trends if every repo came from cache.
  let weeklyTrends = loadRawCache(owner)?.weeklyTrends;
  if (freshCount > 0 || !weeklyTrends) {
    console.log(`Collecting weekly trends… (${freshCount} repos refreshed)`);
    const trendRepos = repos.map((r) => {
      const slash = r.fullName.indexOf("/");
      return { owner: r.fullName.slice(0, slash), name: r.name };
    });
    weeklyTrends = await collectWeeklyTrends(trendRepos);
  } else {
    console.log(`Reusing cached weekly trends (all ${repos.length} repos were fresh)`);
  }

  const metrics: OrgMetrics = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
