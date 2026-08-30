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
  collectRepoGraphQL,
  buildPullRequestCounts,
  buildMergedPRTimeline,
  collectPullRequestDetailsFromNodes,
  extractReviewerLogins,
  collectCopilotAgentMetrics,
} from "./collectors/index.js";
import { filterRepos, describeFiltering } from "./collectors/repos.js";
import { loadConfig, describeConfig } from "./config.js";
import type { DevexConfig } from "./config.js";
import type { GraphQLPRNode } from "./collectors/index.js";
import type { OrgMetrics, RepoMetrics, TeamSummary, TrialSummary } from "./types.js";

export interface CollectOptions {
  /** Skip all cached/fixture data and force a fresh API fetch. */
  skipCache?: boolean;
  /**
   * Maximum age in hours before a per-repo cache entry is considered stale
   * and re-fetched. Defaults to the configured value (8 hours). Only applies
   * when skipCache is false.
   */
  maxRepoAgeHours?: number;
  /**
   * Deployment configuration. Defaults to `loadConfig()`, which reads the
   * GitHub Actions variables; pass an explicit config in tests.
   */
  config?: DevexConfig;
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
  const config = options.config ?? loadConfig();
  const maxAgeHours =
    options.maxRepoAgeHours ??
    config.collection.maxRepoAgeHours ??
    DEFAULT_MAX_REPO_AGE_HOURS;

  if (!options.skipCache) {
    const cached = loadCache(owner);
    if (cached) {
      console.log(`Using cached data for ${owner} (collected ${cached.collectedAt})`);
      return cached;
    }
  }

  console.log(`Collecting fresh metrics for ${owner} (${ownerType})…`);
  console.log(`  config: ${describeConfig({ ...config, owner, ownerType })}`);

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

  const discovered = await collectRepos(owner, ownerType);
  const filtered = filterRepos(discovered, config);
  const repoList = filtered.repos;
  console.log(`Found ${discovered.length} repositories`);
  console.log(`  ${describeFiltering(discovered.length, filtered)}`);

  const repos: RepoMetrics[] = [];
  let freshCount = 0;
  // Collects pre-fetched GraphQL PR nodes per repo for the trends collector.
  const prDataByRepo = new Map<string, GraphQLPRNode[]>();

  for (const { fullName, pushedAt, isTeamRepo } of repoList) {
    // Reuse per-repo data if it is recent enough. The team flag comes from the
    // current config rather than the cache, so re-scoping a trial takes effect
    // without discarding collected data.
    if (!options.skipCache) {
      const cached = cachedRepoMap.get(fullName);
      if (cached && isWithinHours(cached.collectedAt, maxAgeHours)) {
        console.log(`  → ${fullName} (cached)`);
        repos.push({ ...cached, isTeamRepo });
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
        config.collection.features.dependents
          ? collectDependentCount(repoOwner, repoName)
          : Promise.resolve(0),
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
          config.collection.features.dependents
            ? collectDependentCount(repoOwner, repoName)
            : Promise.resolve(0),
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
    const copilotAgentMetrics = config.collection.features.copilotAgent
      ? ((await collectCopilotAgentMetrics(repoOwner, repoName)) ?? undefined)
      : undefined;

    repos.push({
      name: repoName,
      fullName,
      pushedAt,
      isTeamRepo,
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
  let weeklyTrends = loadRawCache(owner)?.weeklyTrends;
  const missingRepoTrends = repos.some((r) => !Array.isArray(r.weeklyTrends));
  if (freshCount > 0 || !weeklyTrends || missingRepoTrends) {
    console.log(`Collecting weekly trends… (${freshCount} repos refreshed)`);
    const trendRepos = repos.map((r) => {
      const slash = r.fullName.indexOf("/");
      return { owner: r.fullName.slice(0, slash), name: r.name };
    });
    const result = await collectWeeklyTrends(
      trendRepos,
      config.collection.historyWeeks,
      200,
      prDataByRepo
    );
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
    dataSource: "fresh",
    team: toTeamSummary(config, repos),
    trial: toTrialSummary(config),
  };

  saveCache(owner, metrics);
  return metrics;
}

/** Copy the configured team into the dataset, resolved to real repo names. */
function toTeamSummary(
  config: DevexConfig,
  repos: readonly RepoMetrics[]
): TeamSummary | undefined {
  if (!config.team) return undefined;
  return {
    id: config.team.id,
    name: config.team.name,
    repos: repos.filter((r) => r.isTeamRepo).map((r) => r.fullName),
    discoverAll: config.team.discoverAll,
  };
}

/** Copy the configured trial into the dataset. */
function toTrialSummary(config: DevexConfig): TrialSummary | undefined {
  if (!config.trial) return undefined;
  return {
    title: config.trial.title,
    hypothesis: config.trial.hypothesis,
    interventionStart: config.trial.interventionStart,
    baselineFrom: config.trial.baselineFrom,
    baselineTo: config.trial.baselineTo,
    milestones: config.trial.milestones,
  };
}
