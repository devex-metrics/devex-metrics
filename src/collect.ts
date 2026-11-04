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
import { describeTransientError, isTransientCollectionError } from "./collectors/repo-graphql.js";
import { loadConfig, describeConfig } from "./config.js";
import type { DevexConfig } from "./config.js";
import type { GraphQLPRNode, GraphQLRepoData } from "./collectors/index.js";
import { loadLatest } from "./history.js";
import type {
  OrgMetrics,
  RepoCollectionState,
  RepoCollectionWarning,
  RepoMetrics,
  TeamSummary,
  TrialSummary,
} from "./types.js";

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
    if (cached && !cached.repos.some(needsRecollection)) {
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
 * True when a repo's stored metrics came out of a failure, so the next run should
 * try again rather than reuse them. A `capped` repo succeeded; retrying it within
 * the freshness window would only hit the same budget.
 */
function needsRecollection(repo: RepoMetrics): boolean {
  const state = repo.collectionWarning?.state;
  return state !== undefined && state !== "capped";
}

/** True when nothing was fetched for a repo this run: its data is old or a placeholder. */
function wasNotRefreshed(repo: RepoMetrics): boolean {
  const state = repo.collectionWarning?.state;
  return state === "stale" || state === "failed" || repo.collectionWarning?.notRefreshed === true;
}

/** Add a gap to a repo's warning, keeping the more serious state of the two. */
function addGap(
  current: RepoCollectionWarning | undefined,
  state: RepoCollectionState,
  detail: string
): RepoCollectionWarning {
  if (!current) return { state, detail };
  return {
    ...current,
    state: current.state === "capped" ? state : current.state,
    detail: `${current.detail} ${detail}`,
  };
}

/** Describe why a GraphQL crawl stopped short of the two-year cutoff. */
function truncationWarning(data: GraphQLRepoData): RepoCollectionWarning | undefined {
  const { truncation, prNodes } = data;
  if (!truncation) return undefined;
  if (truncation.reason === "page-cap") {
    return {
      state: "capped",
      detail:
        `Only the ${prNodes.length} most recently updated closed PRs were collected; older PRs ` +
        `in the two-year window are missing. Raise DEVEX_MAX_PR_PAGES to collect more.`,
    };
  }
  return {
    state: "partial",
    detail:
      `PR history stops after ${prNodes.length} PRs because of a ${truncation.category}. ` +
      `Lifetime PR and issue counts are complete; timelines, review and size metrics undercount.`,
    requestId: truncation.requestId,
  };
}

/**
 * The entry for a repo that could not be collected at all: its last known
 * metrics when there are any, otherwise a placeholder that says so.
 */
function unavailableRepoEntry(
  ref: ResolvedRepoRef,
  repoName: string,
  previous: RepoMetrics | undefined,
  err: unknown
): RepoMetrics {
  const reason = describeTransientError(err);
  if (previous && previous.collectionWarning?.state !== "failed") {
    const asOf = previous.collectedAt?.slice(0, 10) ?? "an earlier run";
    const leanRestData = previous.collectionWarning?.state === "rest-fallback";
    return {
      ...previous,
      isPrivate: ref.isPrivate,
      pushedAt: ref.pushedAt,
      isTeamRepo: ref.isTeamRepo,
      defaultBranch: ref.defaultBranch || previous.defaultBranch,
      sizeKb: ref.sizeKb ?? previous.sizeKb,
      collectionWarning: {
        // Stays rest-fallback so its lean PRs still stay out of the event stream.
        state: leanRestData ? "rest-fallback" : "stale",
        notRefreshed: true,
        detail: `Not refreshed because of a ${reason}; showing metrics from ${asOf}.`,
      },
    };
  }
  return {
    name: repoName,
    fullName: ref.fullName,
    isPrivate: ref.isPrivate,
    pushedAt: ref.pushedAt,
    isTeamRepo: ref.isTeamRepo,
    defaultBranch: ref.defaultBranch || undefined,
    sizeKb: ref.sizeKb,
    issues: { open: 0, closed: 0 },
    pullRequests: { open: 0, closed: 0, merged: 0 },
    pullRequestDetails: [],
    weeklyTrends: [],
    committerCount: 0,
    reviewerCount: 0,
    contributorCount: 0,
    dependentCount: 0,
    collectionWarning: {
      state: "failed",
      detail: `No data: collection failed because of a ${reason} and no earlier metrics exist. Its zeros are placeholders.`,
    },
  };
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
    if (cached && !cached.repos.some(needsRecollection)) {
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
  let unavailableCount = 0;
  let lastUnavailableError: unknown;
  // Read only when a repo fails: the scheduled run starts with no local cache,
  // so the history store is usually where its last known metrics live.
  let lastSnapshot: Map<string, RepoMetrics> | undefined;
  const previousMetrics = (fullName: string): RepoMetrics | undefined => {
    if (options.skipCache) return undefined;
    lastSnapshot ??= new Map(
      (config.history.enabled ? (loadLatest(config.history.dir, owner)?.repos ?? []) : []).map(
        (r): [string, RepoMetrics] => [r.fullName, r]
      )
    );
    return cachedRepoMap.get(fullName) ?? lastSnapshot.get(fullName);
  };

  for (const ref of repoList) {
    const { fullName, isPrivate, pushedAt, isTeamRepo, defaultBranch, sizeKb } = ref;
    // Reuse per-repo data if it is recent enough. The team flag comes from the
    // current config rather than the cache, so re-scoping a trial takes effect
    // without discarding collected data.
    if (!options.skipCache) {
      const cached = cachedRepoMap.get(fullName);
      const reusable =
        cached !== undefined &&
        !needsRecollection(cached) &&
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

    // One repository GitHub cannot serve must not cost the rest of the dataset.
    // Anything but a transient failure (auth, validation, a bug) still ends the run.
    try {
      repos.push(await collectFreshRepo(ref, repoOwner, repoName, config, prDataByRepo));
    } catch (err: unknown) {
      if (!isTransientCollectionError(err)) throw err;
      unavailableCount++;
      lastUnavailableError = err;
      const entry = unavailableRepoEntry(ref, repoName, previousMetrics(fullName), err);
      console.warn(`  ⚠ ${fullName}: ${entry.collectionWarning?.detail}`);
      repos.push(entry);
    }
  }

  if (repos.length > 0 && unavailableCount === repos.length) {
    // Nothing succeeded, so this is a GitHub outage rather than one awkward
    // repository. Fail the run and leave the last good data in place.
    throw new Error(
      `All ${repos.length} repositories failed to collect (last error: ` +
        `${describeTransientError(lastUnavailableError)})`,
      { cause: lastUnavailableError }
    );
  }

  const recordTrendFailures = (failed: ReadonlySet<string>): void => {
    for (const repo of repos) {
      if (!failed.has(repo.fullName)) continue;
      repo.weeklyTrends = [];
      repo.collectionWarning = addGap(repo.collectionWarning, "partial", "Weekly trends could not be collected.");
    }
  };
  // The REST fallback's trend walk is bounded; everything else keeps its window.
  const toTrendRepo = (r: RepoMetrics): { owner: string; name: string; maxPRPages?: number } => {
    const trendRepo = { owner: r.fullName.slice(0, r.fullName.indexOf("/")), name: r.name };
    return r.collectionWarning?.state === "rest-fallback"
      ? { ...trendRepo, maxPRPages: Math.max(1, config.collection.maxPRPages) }
      : trendRepo;
  };

  // Reuse cached weekly trends if every repo came from cache and all repos
  // already have per-repo weeklyTrends (i.e. cache was built with this version).
  let weeklyTrends = loadRawCache(cacheKey)?.weeklyTrends;
  const missingRepoTrends = repos.some((r) => !Array.isArray(r.weeklyTrends));
  if (delta) {
    // Unchanged repos keep today's per-repo trends (same week window); only
    // the changed ones are re-counted, and the org series is their sum.
    const changed = repos.filter((r) => !reused.has(r.fullName) && !wasNotRefreshed(r));
    console.log(
      `Incremental: ${changed.length} of ${repos.length} repo(s) refreshed`
    );
    if (changed.length > 0) {
      const result = await collectWeeklyTrends(
        changed.map(toTrendRepo),
        config.collection.historyWeeks,
        200,
        prDataByRepo
      );
      for (const repo of changed) {
        repo.weeklyTrends = result.repoTrends.get(repo.fullName) ?? [];
      }
      recordTrendFailures(result.failedRepos);
    }
    weeklyTrends = sumWeeklyTrends(
      weekLabels(config.collection.historyWeeks),
      repos.map((r) => r.weeklyTrends ?? [])
    );
  } else if (freshCount > 0 || !weeklyTrends || missingRepoTrends) {
    console.log(`Collecting weekly trends… (${freshCount} repos refreshed)`);
    // A repo that just failed would only fail again, and its last known trends
    // are still the best figures available for it.
    const notRefreshed = repos.filter(wasNotRefreshed);
    const refreshed = repos.filter((r) => !wasNotRefreshed(r));
    const result = await collectWeeklyTrends(
      refreshed.map(toTrendRepo),
      config.collection.historyWeeks,
      200,
      prDataByRepo
    );
    weeklyTrends =
      notRefreshed.length > 0
        ? sumWeeklyTrends(weekLabels(config.collection.historyWeeks), [
            result.orgTrends,
            ...notRefreshed.map((r) => r.weeklyTrends ?? []),
          ])
        : result.orgTrends;
    for (const repo of refreshed) {
      repo.weeklyTrends = result.repoTrends.get(repo.fullName) ?? [];
    }
    recordTrendFailures(result.failedRepos);
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

  const incomplete = repos.filter((r) => r.collectionWarning);
  if (incomplete.length > 0) {
    console.warn(
      `  ⚠ ${incomplete.length} of ${repos.length} repositories have incomplete metrics: ` +
        incomplete.map((r) => `${r.fullName} (${r.collectionWarning?.state})`).join(", ")
    );
  }

  saveCache(cacheKey, metrics);
  return metrics;
}

/**
 * Collect one repository: GraphQL first, then the REST fallback when GraphQL is
 * unavailable. A repository served only in part carries a `collectionWarning`
 * saying what is missing. Throws when even the fallback fails.
 */
async function collectFreshRepo(
  ref: ResolvedRepoRef,
  repoOwner: string,
  repoName: string,
  config: DevexConfig,
  prDataByRepo: Map<string, GraphQLPRNode[]>
): Promise<RepoMetrics> {
  const { fullName, isPrivate, pushedAt, isTeamRepo, defaultBranch, sizeKb } = ref;
  const maxPRPages = Math.max(1, config.collection.maxPRPages);
  const { minPageSize, adaptivePageSize } = config.collection.backfill;

  // Try the GraphQL path first (1-2 calls vs ~100 REST calls per repo).
  const graphql = await collectRepoGraphQL(repoOwner, repoName, maxPRPages, {
    minPageSize,
    adaptive: adaptivePageSize,
  });

  let issues, prCounts, prDetails, mergedPRTimeline, contributors, dependentCount;
  // Abandonment, open-PR age and review-load concentration are derived from
  // nodes the GraphQL path already fetched; the REST fallback has no cheap
  // equivalent, so they stay absent there rather than costing extra calls.
  let closedPRTimeline: RepoMetrics["closedPRTimeline"];
  let openPRTimeline: RepoMetrics["openPRTimeline"];
  let reviewerLoad: RepoMetrics["reviewerLoad"];
  let collectionWarning: RepoCollectionWarning | undefined;

  if (graphql !== null && !("unavailable" in graphql)) {
    // Fast path: derive most data from the pre-fetched GraphQL result.
    collectionWarning = truncationWarning(graphql);
    issues = {
      open: graphql.openIssueCount,
      closed: graphql.closedIssueCount,
    };
    prCounts = buildPullRequestCounts(graphql);
    mergedPRTimeline = buildMergedPRTimeline(graphql.prNodes);
    prDetails = await collectPullRequestDetailsFromNodes(
      repoOwner,
      repoName,
      graphql.prNodes
    );
    closedPRTimeline = buildClosedPRTimeline(graphql.prNodes);
    openPRTimeline = buildOpenPRTimeline(graphql.openPRNodes ?? []);
    reviewerLoad = countReviewerLoad(graphql.prNodes);
    const reviewerLogins = extractReviewerLogins(graphql.prNodes);
    [contributors, dependentCount] = await Promise.all([
      collectContributors(repoOwner, repoName, reviewerLogins),
      config.collection.features.dependents
        ? collectDependentCount(repoOwner, repoName)
        : Promise.resolve(0),
    ]);
    // Store PR nodes for the trends collector (avoids pulls.get detail fetches).
    prDataByRepo.set(fullName, graphql.prNodes);
  } else {
    // Fallback: REST path (null = not found/forbidden, otherwise GraphQL kept failing).
    [issues, prCounts, prDetails, mergedPRTimeline, contributors, dependentCount] =
      await Promise.all([
        collectIssueCounts(repoOwner, repoName),
        collectPullRequestCounts(repoOwner, repoName),
        collectPullRequestDetails(repoOwner, repoName),
        collectMergedPRTimeline(repoOwner, repoName, maxPRPages),
        collectContributors(repoOwner, repoName),
        config.collection.features.dependents
          ? collectDependentCount(repoOwner, repoName)
          : Promise.resolve(0),
      ]);
    if (graphql !== null) {
      collectionWarning = {
        state: "rest-fallback",
        detail:
          `GraphQL unavailable (${graphql.category}), so the REST fallback was used: ` +
          `counts are complete, the merged-PR timeline covers at most ${maxPRPages * 100} closed PRs, ` +
          `and line counts, review timings, abandoned PRs and open-PR ages are missing or sampled. ` +
          `Its PRs are left out of the event history until GraphQL succeeds.`,
        requestId: graphql.requestId,
      };
    }
  }

  // Fetch issue lead times for PRs that reference issues
  let issueLeadTimes: RepoMetrics["issueLeadTimes"];
  try {
    issueLeadTimes = await collectIssueLeadTimes(
      repoOwner,
      repoName,
      mergedPRTimeline,
    );
  } catch (err: unknown) {
    // One issue lookup among hundreds should not discard the PR data above.
    if (!isTransientCollectionError(err)) throw err;
    collectionWarning = addGap(
      collectionWarning,
      "partial",
      `Issue lead times are missing because of a ${describeTransientError(err)}.`
    );
  }

  const copilotAdoption = computeCopilotAdoption(mergedPRTimeline, prDetails);

  // Collect Copilot agent metrics (heavy, per-repo; uses its own cache).
  let copilotAgentMetrics: RepoMetrics["copilotAgentMetrics"];
  if (config.collection.features.copilotAgent) {
    try {
      copilotAgentMetrics = (await collectCopilotAgentMetrics(repoOwner, repoName)) ?? undefined;
    } catch (err: unknown) {
      if (!isTransientCollectionError(err)) throw err;
      collectionWarning = addGap(
        collectionWarning,
        "partial",
        `Copilot agent metrics are missing because of a ${describeTransientError(err)}.`
      );
    }
  }

  return {
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
    collectionWarning,
  };
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
