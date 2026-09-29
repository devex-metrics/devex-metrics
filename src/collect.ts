import { loadCache, loadRawCache, isWithinHours, saveCache, CURRENT_SCHEMA_VERSION } from "./cache.js";
import { slugifyDatasetKey } from "./dataset-key.js";
import { getOctokit } from "./github-client.js";
import {
  collectRepos,
  resolveOwnerType,
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
  buildClosedPRTimeline,
  buildOpenPRTimeline,
  countReviewerLoad,
  extractReviewerLogins,
  collectCopilotAgentMetrics,
  collectActiveRepos,
} from "./collectors/index.js";
import { sumWeeklyTrends, weekLabels } from "./collectors/trends.js";
import { filterRepos, describeFiltering } from "./collectors/repos.js";
import { loadConfig, describeConfig } from "./config.js";
import type { DevexConfig } from "./config.js";
import type { GraphQLPRNode } from "./collectors/index.js";
import type { OrgMetrics, RepoMetrics, TeamSummary, TrialSummary } from "./types.js";

interface ResolvedRepoRef {
  fullName: string;
  isPrivate?: boolean;
  pushedAt: string;
  isTeamRepo: boolean;
  defaultBranch: string;
  sizeKb?: number;
}

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

/** A single repo reference (owner/name) used to seed an explicit group collection. */
export interface GroupRepoRef {
  owner: string;
  name: string;
}

const DEFAULT_MAX_REPO_AGE_HOURS = 8;

/**
 * What changed since today's cached baseline, for an incremental collection.
 * A cached repo is reused only when it was collected today, its `pushedAt`
 * is unchanged, it is not in `active` and it had no open pull requests.
 */
interface DeltaPlan {
  /** UTC date (YYYY-MM-DD) the baseline must have been collected on. */
  today: string;
  /** Lower-cased `owner/repo` names with issue/PR activity since the baseline. */
  active: ReadonlySet<string>;
}

type CollectRunOptions = CollectOptions & { delta?: DeltaPlan };

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
  const incremental = !options.skipCache && config.collection.incremental;
  // Both optional scans may publish public repository facts, so refresh
  // discovery first instead of trusting the same-day cached visibility.
  // Incremental runs also need a fresh repository listing for the delta.
  if (
    !options.skipCache &&
    !incremental &&
    !config.collection.features.landscape &&
    !config.collection.features.publicDiscovery
  ) {
    const cached = loadCache(owner);
    if (cached) {
      console.log(`Using cached data for ${owner} (collected ${cached.collectedAt})`);
      return cached;
    }
  }

  console.log(`Collecting fresh metrics for ${owner} (${ownerType})…`);
  console.log(`  config: ${describeConfig({ ...config, owner, ownerType })}`);

  const discovered = await collectRepos(owner, ownerType);
  const filtered = filterRepos(discovered, config);
  console.log(`Found ${discovered.length} repositories`);
  console.log(`  ${describeFiltering(discovered.length, filtered)}`);

  let runOptions: CollectRunOptions = { ...options, config, maxRepoAgeHours: maxAgeHours };
  if (incremental) {
    // Discovery corrects a misconfigured owner type; the activity search
    // needs the same correction or it would scope to `org:<username>`.
    const delta = await planDelta(owner, await resolveOwnerType(owner, ownerType));
    // Without a trustworthy delta, reusing anything could hide changes.
    runOptions = delta ? { ...runOptions, delta } : { ...runOptions, skipCache: true };
  }

  return collectMetricsForRepoList(owner, owner, ownerType, filtered.repos, runOptions);
}

/**
 * Work out which repos changed since today's cached baseline. Returns
 * undefined when there is no baseline from today or the activity search
 * could not give a complete answer, meaning: collect everything.
 */
async function planDelta(
  owner: string,
  ownerType: "org" | "user"
): Promise<DeltaPlan | undefined> {
  const today = new Date().toISOString().slice(0, 10);
  const baseline = (loadRawCache(owner)?.repos ?? [])
    .map((r) => r.collectedAt)
    .filter((at): at is string => typeof at === "string" && at.startsWith(today))
    .sort();
  if (baseline.length === 0) {
    console.log(`Incremental: no baseline collected today (${today}) — collecting everything`);
    return undefined;
  }

  const since = baseline[0];
  const active = await collectActiveRepos(owner, ownerType, since);
  if (!active) {
    console.log("Incremental: activity since the baseline is unknown — collecting everything");
    return undefined;
  }
  console.log(
    `Incremental: baseline from ${since}; ${active.size} repo(s) with issue/PR activity since`
  );
  return { today, active };
}

/**
 * Whether a cached repo can stand in for a fresh collection in a delta run.
 * A repo with open PRs is always re-collected: submitting a review does not
 * reliably advance the PR's `updated_at`, so the activity search can miss it.
 */
function isUnchangedSinceBaseline(
  cached: RepoMetrics,
  pushedAt: string,
  delta: DeltaPlan
): boolean {
  return (
    cached.collectedAt?.startsWith(delta.today) === true &&
    Array.isArray(cached.weeklyTrends) &&
    pushedAt !== "" &&
    cached.pushedAt === pushedAt &&
    cached.pullRequests.open === 0 &&
    !delta.active.has(cached.fullName.toLowerCase())
  );
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
  const config = options.config ?? loadConfig();
  const maxAgeHours =
    options.maxRepoAgeHours ??
    config.collection.maxRepoAgeHours ??
    DEFAULT_MAX_REPO_AGE_HOURS;
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
  const repoList: ResolvedRepoRef[] = [];
  for (const { owner: repoOwner, name } of repos) {
    try {
      const { data } = await octokit.rest.repos.get({ owner: repoOwner, repo: name });
      repoList.push({
        fullName: data.full_name,
        isPrivate: data.private,
        pushedAt: data.pushed_at ?? "",
        isTeamRepo: false,
        defaultBranch: data.default_branch ?? "",
        sizeKb: data.size,
      });
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
    { ...options, config, maxRepoAgeHours: maxAgeHours }
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
  repoList: ResolvedRepoRef[],
  options: CollectRunOptions
): Promise<OrgMetrics> {
  const config = options.config ?? loadConfig();
  const maxAgeHours =
    options.maxRepoAgeHours ??
    config.collection.maxRepoAgeHours ??
    DEFAULT_MAX_REPO_AGE_HOURS;

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
  const reused = new Set<string>();
  let freshCount = 0;
  const { delta } = options;
  // Collects pre-fetched GraphQL PR nodes per repo for the trends collector.
  const prDataByRepo = new Map<string, GraphQLPRNode[]>();

  for (const { fullName, isPrivate, pushedAt, isTeamRepo, defaultBranch, sizeKb } of repoList) {
    // Reuse per-repo data if it is recent enough. The team flag comes from the
    // current config rather than the cache, so re-scoping a trial takes effect
    // without discarding collected data.
    if (!options.skipCache) {
      const cached = cachedRepoMap.get(fullName);
      const reusable =
        cached !== undefined &&
        (delta
          ? isUnchangedSinceBaseline(cached, pushedAt, delta)
          : isWithinHours(cached.collectedAt, maxAgeHours));
      if (cached && reusable) {
        console.log(`  → ${fullName} (${delta ? "unchanged" : "cached"})`);
        reused.add(fullName);
        // The default branch, like the team flag, comes from this run's
        // discovery rather than from whatever the cache was written with.
        repos.push({
          ...cached,
          isPrivate,
          isTeamRepo,
          defaultBranch: defaultBranch || cached.defaultBranch,
          sizeKb: sizeKb ?? cached.sizeKb,
        });
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
    // Abandonment, open-PR age and review-load concentration are derived from
    // nodes the GraphQL path already fetched; the REST fallback has no cheap
    // equivalent, so they stay absent there rather than costing extra calls.
    let closedPRTimeline: RepoMetrics["closedPRTimeline"];
    let openPRTimeline: RepoMetrics["openPRTimeline"];
    let reviewerLoad: RepoMetrics["reviewerLoad"];

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
      closedPRTimeline = buildClosedPRTimeline(graphqlData.prNodes);
      openPRTimeline = buildOpenPRTimeline(graphqlData.openPRNodes ?? []);
      reviewerLoad = countReviewerLoad(graphqlData.prNodes);
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
      isPrivate,
      pushedAt,
      isTeamRepo,
      defaultBranch: defaultBranch || undefined,
      sizeKb,
      collectedAt: new Date().toISOString(),
      issues,
      pullRequests: prCounts,
      pullRequestDetails: prDetails,
      mergedPRTimeline,
      closedPRTimeline,
      openPRTimeline,
      reviewerLoad,
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
  if (delta) {
    // Unchanged repos keep today's per-repo trends (same week window); only
    // the changed ones are re-counted, and the org series is their sum.
    const changed = repos.filter((r) => !reused.has(r.fullName));
    console.log(
      `Incremental: ${changed.length} of ${repos.length} repo(s) refreshed`
    );
    if (changed.length > 0) {
      const result = await collectWeeklyTrends(
        changed.map((r) => ({ owner: r.fullName.slice(0, r.fullName.indexOf("/")), name: r.name })),
        config.collection.historyWeeks,
        200,
        prDataByRepo
      );
      for (const repo of changed) {
        repo.weeklyTrends = result.repoTrends.get(repo.fullName) ?? [];
      }
    }
    weeklyTrends = sumWeeklyTrends(
      weekLabels(config.collection.historyWeeks),
      repos.map((r) => r.weeklyTrends ?? [])
    );
  } else if (freshCount > 0 || !weeklyTrends || missingRepoTrends) {
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

  saveCache(cacheKey, metrics);
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
