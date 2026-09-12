import { loadCache, loadRawCache, isWithinHours, saveCache, CURRENT_SCHEMA_VERSION } from "./cache.js";
import { slugifyDatasetKey } from "./dataset-key.js";
import { getOctokit } from "./github-client.js";
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
  collectRepoGraphQL,
  buildPullRequestCounts,
  buildMergedPRTimeline,
  collectPullRequestDetailsFromNodes,
  extractReviewerLogins,
  collectCopilotAgentMetrics,
} from "./collectors/index.js";
import type { GraphQLPRNode } from "./collectors/index.js";
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

/** A single repo reference (owner/name) used to seed an explicit group collection. */
export interface GroupRepoRef {
  owner: string;
  name: string;
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

  return collectMetricsForRepoList(owner, owner, ownerType, repoList, options);
}

/**
 * Collect metrics for an explicit, named list of repos (e.g. discovered from
 * a local folder of git checkouts) rather than a full org/user listing.
 *
 * The resulting data is stored under its own local cache key (derived from
 * `groupName`), completely separate from any owner-based dataset, so running
 * a group collection never overwrites existing data.
 */
export async function collectGroup(
  groupName: string,
  repos: GroupRepoRef[],
  options: CollectOptions = {}
): Promise<OrgMetrics> {
  const cacheKey = slugifyDatasetKey(groupName);

  if (!options.skipCache) {
    const cached = loadCache(cacheKey);
    if (cached) {
      console.log(`Using cached data for group "${groupName}" (collected ${cached.collectedAt})`);
      return cached;
    }
  }

  console.log(`Collecting fresh metrics for group "${groupName}" (${repos.length} repos)…`);

  const octokit = await getOctokit();
  const repoList: { fullName: string; pushedAt: string }[] = [];
  for (const { owner: repoOwner, name } of repos) {
    try {
      const { data } = await octokit.rest.repos.get({ owner: repoOwner, repo: name });
      repoList.push({ fullName: data.full_name, pushedAt: data.pushed_at ?? "" });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      console.warn(
        `  ⚠ Skipping ${repoOwner}/${name}: could not fetch repo metadata (status ${status ?? "unknown"})`
      );
    }
  }

  // Pick the most common owner among the discovered repos for the dataset's
  // "owner" field (used for the org/user link in the report and dashboard).
  const ownerCounts = new Map<string, number>();
  for (const r of repoList) {
    const slash = r.fullName.indexOf("/");
    if (slash <= 0) continue;
    const o = r.fullName.slice(0, slash);
    ownerCounts.set(o, (ownerCounts.get(o) ?? 0) + 1);
  }
  const primaryOwner =
    [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? groupName;

  const metrics = await collectMetricsForRepoList(
    cacheKey,
    primaryOwner,
    "org",
    repoList,
    options
  );
  metrics.groupName = groupName;
  saveCache(cacheKey, metrics);
  return metrics;
}

/**
 * Shared collection loop: given a resolved list of repos (fullName +
 * pushedAt), fetch per-repo metrics (reusing cached entries that are still
 * fresh), aggregate weekly trends, assemble the `OrgMetrics` result and
 * persist it under `cacheKey`.
 */
async function collectMetricsForRepoList(
  cacheKey: string,
  owner: string,
  ownerType: "org" | "user",
  repoList: { fullName: string; pushedAt: string }[],
  options: CollectOptions
): Promise<OrgMetrics> {
  const maxAgeHours = options.maxRepoAgeHours ?? DEFAULT_MAX_REPO_AGE_HOURS;

  // Build a lookup map from any existing (potentially stale) cache so we can
  // reuse per-repo data that is still within maxAgeHours.
  const cachedRepoMap = new Map<string, RepoMetrics>();
  if (!options.skipCache) {
    const raw = loadRawCache(cacheKey);
    if (raw) {
      for (const repo of raw.repos) {
        cachedRepoMap.set(repo.fullName, repo);
      }
    }
  }

  const repos: RepoMetrics[] = [];
  let freshCount = 0;
  // Collects pre-fetched GraphQL PR nodes per repo for the trends collector.
  const prDataByRepo = new Map<string, GraphQLPRNode[]>();

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

    // Try the GraphQL path first (1-2 calls vs ~100 REST calls per repo).
    const graphqlData = await collectRepoGraphQL(repoOwner, repoName);

    let issues, prCounts, prDetails, mergedPRTimeline, contributors, dependentCount;

    if (graphqlData !== null) {
      // Fast path: derive most data from the pre-fetched GraphQL result.
      issues = {
        open: graphqlData.openIssueCount,
        closed: graphqlData.closedIssueCount,
      };
      prCounts = buildPullRequestCounts(graphqlData);
      mergedPRTimeline = buildMergedPRTimeline(graphqlData.prNodes);
      prDetails = await collectPullRequestDetailsFromNodes(
        repoOwner,
        repoName,
        graphqlData.prNodes
      );
      const reviewerLogins = extractReviewerLogins(graphqlData.prNodes);
      [contributors, dependentCount] = await Promise.all([
        collectContributors(repoOwner, repoName, reviewerLogins),
        collectDependentCount(repoOwner, repoName),
      ]);
      // Store PR nodes for the trends collector (avoids pulls.get detail fetches).
      prDataByRepo.set(fullName, graphqlData.prNodes);
    } else {
      // Fallback: full REST path (GraphQL returned null = not found/forbidden).
      [issues, prCounts, prDetails, mergedPRTimeline, contributors, dependentCount] =
        await Promise.all([
          collectIssueCounts(repoOwner, repoName),
          collectPullRequestCounts(repoOwner, repoName),
          collectPullRequestDetails(repoOwner, repoName),
          collectMergedPRTimeline(repoOwner, repoName),
          collectContributors(repoOwner, repoName),
          collectDependentCount(repoOwner, repoName),
        ]);
    }

    // Fetch issue lead times for PRs that reference issues
    const issueLeadTimes = await collectIssueLeadTimes(
      repoOwner,
      repoName,
      mergedPRTimeline,
    );

    const copilotAdoption = computeCopilotAdoption(mergedPRTimeline, prDetails);

    // Collect Copilot agent metrics (heavy, per-repo; uses its own cache).
    const copilotAgentMetrics =
      (await collectCopilotAgentMetrics(repoOwner, repoName)) ?? undefined;

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
      contributorCount: contributors.contributorCount,
      dependentCount,
      copilotAgentMetrics,
    });
  }

  // Reuse cached weekly trends if every repo came from cache and all repos
  // already have per-repo weeklyTrends (i.e. cache was built with this version).
  let weeklyTrends = loadRawCache(cacheKey)?.weeklyTrends;
  const missingRepoTrends = repos.some((r) => !Array.isArray(r.weeklyTrends));
  if (freshCount > 0 || !weeklyTrends || missingRepoTrends) {
    console.log(`Collecting weekly trends… (${freshCount} repos refreshed)`);
    const trendRepos = repos.map((r) => {
      const slash = r.fullName.indexOf("/");
      return { owner: r.fullName.slice(0, slash), name: r.name };
    });
    const result = await collectWeeklyTrends(trendRepos, 104, 200, prDataByRepo);
    weeklyTrends = result.orgTrends;
    for (const repo of repos) {
      repo.weeklyTrends = result.repoTrends.get(repo.fullName) ?? [];
    }
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

  saveCache(cacheKey, metrics);
  return metrics;
}
