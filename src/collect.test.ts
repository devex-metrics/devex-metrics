import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("./cache.js", () => ({
  loadCache: vi.fn(),
  loadRawCache: vi.fn(),
  isWithinHours: vi.fn(),
  saveCache: vi.fn(),
  CURRENT_SCHEMA_VERSION: 2,
}));

vi.mock("./collectors/index.js", () => ({
  collectRepos: vi.fn(),
  resolveOwnerType: vi.fn(),
  collectIssueCounts: vi.fn(),
  collectIssueLeadTimes: vi.fn(),
  collectPullRequestCounts: vi.fn(),
  collectPullRequestDetails: vi.fn(),
  collectMergedPRTimeline: vi.fn(),
  computeCopilotAdoption: vi.fn(),
  collectContributors: vi.fn(),
  collectDependentCount: vi.fn(),
  collectWeeklyTrends: vi.fn(),
  collectRepoGraphQL: vi.fn(),
  buildPullRequestCounts: vi.fn(),
  buildMergedPRTimeline: vi.fn(),
  collectPullRequestDetailsFromNodes: vi.fn(),
  buildClosedPRTimeline: vi.fn(),
  buildOpenPRTimeline: vi.fn(),
  countReviewerLoad: vi.fn(),
  extractReviewerLogins: vi.fn(),
  collectCopilotAgentMetrics: vi.fn(),
  collectActiveRepos: vi.fn(),
}));

import { collect, collectGroup } from "./collect.js";
import { setOctokit, resetOctokit } from "./github-client.js";
import { loadCache, loadRawCache, isWithinHours, saveCache } from "./cache.js";
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
import type { GraphQLRepoData } from "./collectors/index.js";
import { weekLabels } from "./collectors/trends.js";
import { latestPath } from "./history.js";
import type { OrgMetrics, RepoMetrics, WeeklyTrendPoint } from "./types.js";
import { defaultConfig } from "./config.js";

function setupDefaultMocks() {
  vi.mocked(loadCache).mockReturnValue(null);
  vi.mocked(loadRawCache).mockReturnValue(null);
  vi.mocked(isWithinHours).mockReturnValue(false);
  vi.mocked(saveCache).mockReturnValue(undefined);
  vi.mocked(collectRepos).mockResolvedValue([]);
  vi.mocked(resolveOwnerType).mockImplementation(async (_owner, type) => type);
  // GraphQL path returns null by default → triggers REST fallback
  vi.mocked(collectRepoGraphQL).mockResolvedValue(null);
  vi.mocked(collectIssueCounts).mockResolvedValue({ open: 0, closed: 0 });
  vi.mocked(collectPullRequestCounts).mockResolvedValue({ open: 0, closed: 0, merged: 0 });
  vi.mocked(collectPullRequestDetails).mockResolvedValue([]);
  vi.mocked(collectMergedPRTimeline).mockResolvedValue([]);
  vi.mocked(collectIssueLeadTimes).mockResolvedValue([]);
  vi.mocked(computeCopilotAdoption).mockReturnValue({
    copilotAuthoredPRs: 0, copilotReviewedPRs: 0, totalMergedPRs: 0, totalDetailedPRs: 0,
  });
  vi.mocked(collectContributors).mockResolvedValue({ committerCount: 0, reviewerCount: 0, contributorCount: 0 });
  vi.mocked(collectDependentCount).mockResolvedValue(0);
  vi.mocked(collectWeeklyTrends).mockResolvedValue({ orgTrends: [], repoTrends: new Map(), failedRepos: new Set(), truncatedRepos: new Set() });
  vi.mocked(buildClosedPRTimeline).mockReturnValue([]);
  vi.mocked(buildOpenPRTimeline).mockReturnValue([]);
  vi.mocked(countReviewerLoad).mockReturnValue([]);
  vi.mocked(buildPullRequestCounts).mockReturnValue({ open: 0, closed: 0, merged: 0 });
  vi.mocked(buildMergedPRTimeline).mockReturnValue([]);
  vi.mocked(collectPullRequestDetailsFromNodes).mockResolvedValue([]);
  vi.mocked(extractReviewerLogins).mockReturnValue(new Set());
  vi.mocked(collectCopilotAgentMetrics).mockResolvedValue(null);
}

describe("collect when a repository keeps failing", () => {
  const gateway = () => Object.assign(new Error("Gateway timeout"), { status: 504 });
  const unavailable = { unavailable: true as const, category: "repeated HTTP 502/504 gateway error" };
  const graphqlData = (extra: Partial<GraphQLRepoData> = {}): GraphQLRepoData => ({
    isFork: false,
    openIssueCount: 1,
    closedIssueCount: 2,
    openPRCount: 3,
    closedPRCount: 4,
    mergedPRCount: 5,
    prNodes: [],
    openPRNodes: [],
    ...extra,
  });
  const previous = (extra: Partial<RepoMetrics> = {}): RepoMetrics => ({
    name: "big",
    fullName: "org/big",
    collectedAt: "2026-10-01T00:00:00Z",
    issues: { open: 9, closed: 9 },
    pullRequests: { open: 9, closed: 9, merged: 9 },
    pullRequestDetails: [],
    weeklyTrends: [{ week: "2026-W40", prsOpened: 7, prsMerged: 7, issuesOpened: 0, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 }],
    committerCount: 9,
    reviewerCount: 9,
    contributorCount: 9,
    dependentCount: 0,
    ...extra,
  });
  const twoRepos = [
    { name: "big", fullName: "org/big", pushedAt: "" },
    { name: "small", fullName: "org/small", pushedAt: "" },
  ];
  /** GraphQL and REST both fail for org/big; org/small is healthy. */
  const failBigEverywhere = () => {
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(collectRepoGraphQL).mockImplementation(async (_owner, repo) =>
      repo === "big" ? unavailable : graphqlData()
    );
    vi.mocked(collectIssueCounts).mockRejectedValue(gateway());
  };

  beforeEach(() => {
    setupDefaultMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("falls back to REST and flags the repository when GraphQL is unavailable", async () => {
    const config = defaultConfig();
    config.collection.maxPRPages = 3;
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue({ ...unavailable, requestId: "ABC:123" });
    vi.mocked(collectPullRequestCounts).mockResolvedValue({ open: 1, closed: 2, merged: 3 });

    const result = await collect("org", "org", { config });

    expect(result.repos[0].pullRequests).toEqual({ open: 1, closed: 2, merged: 3 });
    expect(result.repos[0].collectionWarning).toMatchObject({ state: "rest-fallback", requestId: "ABC:123" });
    expect(result.repos[0].collectionWarning?.detail).toContain("502/504");
    expect(collectMergedPRTimeline).toHaveBeenCalledWith("org", "big", 3);
    // The fallback's trend walk is bounded by the same budget.
    expect(vi.mocked(collectWeeklyTrends).mock.calls[0][0]).toEqual([{ owner: "org", name: "big", maxPages: 3 }]);
  });

  it("marks REST data as lean even when GraphQL only reported not found or forbidden", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(null);

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning?.state).toBe("rest-fallback");
    expect(result.repos[0].collectionWarning?.detail).toContain("no data");
    expect(result.repos[0].collectionWarning?.detail).toContain("counts are complete");
    expect(vi.mocked(collectWeeklyTrends).mock.calls[0][0][0].maxPages).toBeGreaterThan(0);
  });

  it("does not call counts complete when search could not answer in full", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(unavailable);
    vi.mocked(collectPullRequestCounts).mockResolvedValue({ open: 1, closed: 2, merged: 3, incomplete: true });

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning?.detail).toContain("may undercount");
    expect(result.repos[0].collectionWarning?.detail).not.toContain("counts are complete");
  });

  it("still ends the run when a fatal REST failure lands after a transient one", async () => {
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(unavailable);
    vi.mocked(collectIssueCounts).mockRejectedValue(gateway());
    vi.mocked(collectContributors).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw Object.assign(new Error("Bad credentials"), { status: 401 });
    });

    await expect(collect("org", "org")).rejects.toMatchObject({ status: 401 });
    expect(saveCache).not.toHaveBeenCalled();
  });

  it("still ends the run when a fatal failure lands after a transient one on the GraphQL path", async () => {
    const config = defaultConfig();
    config.collection.features.dependents = true;
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData());
    vi.mocked(collectContributors).mockRejectedValue(gateway());
    vi.mocked(collectDependentCount).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new TypeError("boom");
    });

    await expect(collect("org", "org", { config })).rejects.toThrow("boom");
  });

  it("does not recover from a history snapshot of another schema version", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-collect-"));
    try {
      const config = defaultConfig();
      config.history.dir = dir;
      const snapshot: OrgMetrics = {
        schemaVersion: 1,
        owner: "org",
        ownerType: "org",
        collectedAt: "2026-10-01T00:00:00Z",
        repoCount: 1,
        repos: [previous()],
      };
      fs.mkdirSync(path.dirname(latestPath(dir, "org")), { recursive: true });
      fs.writeFileSync(latestPath(dir, "org"), JSON.stringify(snapshot));
      failBigEverywhere();

      const result = await collect("org", "org", { config });

      expect(result.repos[0].collectionWarning?.state).toBe("failed");
      expect(result.repos[0].pullRequests.merged).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the last known metrics when a forced recollection fails", async () => {
    failBigEverywhere();
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous()],
    });

    const result = await collect("org", "org", { skipCache: true });

    expect(result.repos[0].pullRequests.merged).toBe(9);
    expect(result.repos[0].collectionWarning).toMatchObject({ state: "stale", notRefreshed: true });
  });

  it("keeps the last known metrics when an incremental run has no baseline to reuse", async () => {
    const config = defaultConfig();
    config.collection.incremental = true;
    failBigEverywhere();
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous()],
    });

    const result = await collect("org", "org", { config });

    expect(result.repos[0].pullRequests.merged).toBe(9);
    expect(result.repos[0].collectionWarning?.state).toBe("stale");
  });

  it("looks past a cached placeholder to real metrics in the history store", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-collect-"));
    try {
      const config = defaultConfig();
      config.history.dir = dir;
      const snapshot: OrgMetrics = {
        schemaVersion: 2,
        owner: "org",
        ownerType: "org",
        collectedAt: "2026-10-01T00:00:00Z",
        repoCount: 1,
        repos: [previous()],
      };
      fs.mkdirSync(path.dirname(latestPath(dir, "org")), { recursive: true });
      fs.writeFileSync(latestPath(dir, "org"), JSON.stringify(snapshot));
      failBigEverywhere();
      vi.mocked(loadRawCache).mockReturnValue({
        ...snapshot,
        repos: [previous({ collectionWarning: { state: "failed", detail: "none" } })],
      });

      const result = await collect("org", "org", { config });

      expect(result.repos[0].pullRequests.merged).toBe(9);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bounds the trend walk of a capped repository reused from the cache", async () => {
    const config = defaultConfig();
    config.collection.maxPRPages = 3;
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData());
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous({ collectionWarning: { state: "capped", detail: "capped" } })],
    });

    await collect("org", "org", { config });

    expect(vi.mocked(collectWeeklyTrends).mock.calls[0][0]).toEqual([
      { owner: "org", name: "big", maxPages: 3 },
      { owner: "org", name: "small" },
    ]);
  });

  it("flags weekly trends that stopped at their page bound, keeping the counts", async () => {
    const trends = [{ week: "2026-W40", prsOpened: 7, prsMerged: 7, issuesOpened: 0, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 }];
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData({ truncation: { reason: "page-cap" } }));
    vi.mocked(collectWeeklyTrends).mockResolvedValue({
      orgTrends: trends,
      repoTrends: new Map([["org/big", trends]]),
      failedRepos: new Set(),
      truncatedRepos: new Set(["org/big"]),
    });

    const result = await collect("org", "org");

    expect(result.repos[0].weeklyTrends).toEqual(trends);
    expect(result.repos[0].collectionWarning?.state).toBe("capped");
    expect(result.repos[0].collectionWarning?.detail).toContain("Weekly trends stop");
  });

  it("passes the configured budget and page sizing to the GraphQL crawl", async () => {
    const config = defaultConfig();
    config.collection.maxPRPages = 4;
    config.collection.backfill.minPageSize = 20;
    config.collection.backfill.adaptivePageSize = false;
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);

    await collect("org", "org", { config });

    expect(collectRepoGraphQL).toHaveBeenCalledWith("org", "big", 4, { minPageSize: 20, adaptive: false });
  });

  it("keeps collecting the other repositories when REST fails too", async () => {
    failBigEverywhere();

    const result = await collect("org", "org");

    expect(result.repos.map((r) => r.fullName)).toEqual(["org/big", "org/small"]);
    const [big, small] = result.repos;
    expect(big.collectionWarning?.state).toBe("failed");
    expect(big.collectedAt).toBeUndefined();
    expect(small.collectionWarning).toBeUndefined();
    expect(small.pullRequests).toBeDefined();
    expect(saveCache).toHaveBeenCalled();
  });

  it("does not spend trend requests on a repository that just failed", async () => {
    failBigEverywhere();

    await collect("org", "org");

    expect(vi.mocked(collectWeeklyTrends).mock.calls[0][0]).toEqual([{ owner: "org", name: "small" }]);
  });

  it("shows the last known metrics from the cache, flagged as not refreshed", async () => {
    failBigEverywhere();
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous()],
    });

    const result = await collect("org", "org");

    const big = result.repos[0];
    expect(big.pullRequests.merged).toBe(9);
    expect(big.collectedAt).toBe("2026-10-01T00:00:00Z");
    expect(big.weeklyTrends).toEqual(previous().weeklyTrends);
    expect(big.collectionWarning).toMatchObject({ state: "stale", notRefreshed: true });
    expect(big.collectionWarning?.detail).toContain("2026-10-01");
  });

  it("falls back to the history store when there is no local cache, as on a scheduled run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-collect-"));
    try {
      const config = defaultConfig();
      config.history.dir = dir;
      const snapshot: OrgMetrics = {
        schemaVersion: 2,
        owner: "org",
        ownerType: "org",
        collectedAt: "2026-10-01T00:00:00Z",
        repoCount: 1,
        repos: [previous()],
      };
      fs.mkdirSync(path.dirname(latestPath(dir, "org")), { recursive: true });
      fs.writeFileSync(latestPath(dir, "org"), JSON.stringify(snapshot));
      failBigEverywhere();

      const result = await collect("org", "org", { config });

      expect(result.repos[0].pullRequests.merged).toBe(9);
      expect(result.repos[0].collectionWarning?.state).toBe("stale");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a repository on rest-fallback when its last known data came from REST", async () => {
    failBigEverywhere();
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous({ collectionWarning: { state: "rest-fallback", detail: "lean" } })],
    });

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning).toMatchObject({ state: "rest-fallback", notRefreshed: true });
    expect(vi.mocked(collectWeeklyTrends).mock.calls[0][0]).toEqual([{ owner: "org", name: "small" }]);
  });

  it("does not treat an earlier placeholder as known metrics", async () => {
    failBigEverywhere();
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous({ collectionWarning: { state: "failed", detail: "none" } })],
    });

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning?.state).toBe("failed");
    expect(result.repos[0].pullRequests.merged).toBe(0);
  });

  it("still ends the run on a non-transient error such as bad credentials", async () => {
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(collectRepoGraphQL).mockRejectedValue(
      Object.assign(new Error("Bad credentials"), { status: 401 })
    );

    await expect(collect("org", "org")).rejects.toMatchObject({ status: 401 });
    expect(saveCache).not.toHaveBeenCalled();
  });

  it("still ends the run on a programming error", async () => {
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(collectRepoGraphQL).mockRejectedValue(new TypeError("boom"));

    await expect(collect("org", "org")).rejects.toThrow("boom");
  });

  it("fails the run when every repository fails, leaving the last good data in place", async () => {
    vi.mocked(collectRepos).mockResolvedValue(twoRepos);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(unavailable);
    vi.mocked(collectIssueCounts).mockRejectedValue(gateway());

    await expect(collect("org", "org")).rejects.toThrow(/All 2 repositories failed/);
    expect(saveCache).not.toHaveBeenCalled();
  });

  it("flags pages lost part-way through the GraphQL crawl, keeping what was fetched", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(
      graphqlData({ truncation: { reason: "transient", category: "repeated HTTP 502/504 gateway error", requestId: "R1" } })
    );
    vi.mocked(buildPullRequestCounts).mockReturnValue({ open: 3, closed: 4, merged: 5 });

    const result = await collect("org", "org");

    expect(result.repos[0].pullRequests.merged).toBe(5);
    expect(result.repos[0].collectionWarning).toMatchObject({ state: "partial", requestId: "R1" });
    expect(collectIssueCounts).not.toHaveBeenCalled();
  });

  it("flags a repository that used up its PR budget as capped", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData({ truncation: { reason: "page-cap" } }));

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning?.state).toBe("capped");
    expect(result.repos[0].collectionWarning?.detail).toContain("DEVEX_MAX_PR_PAGES");
  });

  it("keeps the PR data when only an issue lead-time lookup fails", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData({ truncation: { reason: "page-cap" } }));
    vi.mocked(buildPullRequestCounts).mockReturnValue({ open: 3, closed: 4, merged: 5 });
    vi.mocked(collectIssueLeadTimes).mockRejectedValue(gateway());

    const result = await collect("org", "org");

    expect(result.repos[0].pullRequests.merged).toBe(5);
    // A gap caused by a failure outranks the expected page cap, so it is retried.
    expect(result.repos[0].collectionWarning?.state).toBe("partial");
    expect(result.repos[0].collectionWarning?.detail).toContain("lead times");
    expect(result.repos[0].collectionWarning?.detail).toContain("DEVEX_MAX_PR_PAGES");
  });

  it("keeps the PR data when only Copilot agent metrics fail", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData());
    vi.mocked(collectCopilotAgentMetrics).mockRejectedValue(gateway());

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning?.detail).toContain("Copilot agent");
  });

  it("flags a repository whose weekly trends failed", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData());
    vi.mocked(collectWeeklyTrends).mockResolvedValue({
      orgTrends: [],
      repoTrends: new Map(),
      failedRepos: new Set(["org/big"]),
      truncatedRepos: new Set(),
    });

    const result = await collect("org", "org");

    expect(result.repos[0].collectionWarning).toMatchObject({ state: "partial" });
    expect(result.repos[0].collectionWarning?.detail).toContain("Weekly trends");
  });

  it("retries a flagged repository instead of reusing it within the freshness window", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData());
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous({ collectionWarning: { state: "rest-fallback", detail: "lean" } })],
    });

    const result = await collect("org", "org");

    expect(collectRepoGraphQL).toHaveBeenCalledTimes(1);
    expect(result.repos[0].collectionWarning).toBeUndefined();
  });

  it("reuses a capped repository within the freshness window: it succeeded", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous({ collectionWarning: { state: "capped", detail: "capped" } })],
    });

    const result = await collect("org", "org");

    expect(collectRepoGraphQL).not.toHaveBeenCalled();
    expect(result.repos[0].collectionWarning?.state).toBe("capped");
  });

  it("does not serve today's cached dataset while it holds a repository to retry", async () => {
    vi.mocked(collectRepos).mockResolvedValue([twoRepos[0]]);
    vi.mocked(collectRepoGraphQL).mockResolvedValue(graphqlData());
    vi.mocked(loadCache).mockReturnValue({
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-10-01T00:00:00Z",
      repoCount: 1,
      repos: [previous({ collectionWarning: { state: "partial", detail: "gap" } })],
    });

    await collect("org", "org");

    expect(collectRepos).toHaveBeenCalled();
  });
});

describe("collect", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns cached data immediately without calling collectRepos", async () => {
    const cached: OrgMetrics = {
      owner: "cached-org",
      ownerType: "org",
      collectedAt: "2026-01-01T00:00:00Z",
      repoCount: 3,
      repos: [],
    };
    vi.mocked(loadCache).mockReturnValue(cached);

    const result = await collect("cached-org", "org");

    expect(result).toBe(cached);
    expect(collectRepos).not.toHaveBeenCalled();
  });

  it("skips repos with a malformed fullName and logs a warning", async () => {
    setupDefaultMocks();
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "bad", fullName: "bad", pushedAt: "" },           // no slash
      { name: "good", fullName: "owner/good", pushedAt: "" },   // valid
    ]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collect("owner", "org");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bad"));
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].name).toBe("good");
    warnSpy.mockRestore();
  });

  it("bypasses cache when skipCache is true even if loadCache would return data", async () => {
    setupDefaultMocks();
    const stale: OrgMetrics = {
      owner: "skip-org",
      ownerType: "org",
      collectedAt: "2026-01-01T00:00:00Z",
      repoCount: 99,
      repos: [],
    };
    vi.mocked(loadCache).mockReturnValue(stale);

    const result = await collect("skip-org", "org", { skipCache: true });

    expect(collectRepos).toHaveBeenCalled();
    expect(result.repoCount).toBe(0); // fresh data – no repos from mock
  });

  it.each(["landscape", "publicDiscovery"] as const)(
    "refreshes visibility discovery when %s is enabled but reuses safe per-repo cached metrics",
    async (feature) => {
      setupDefaultMocks();
      const config = defaultConfig();
      config.collection.features[feature] = true;
      const previouslyPublic = {
        name: "r",
        fullName: "org/r",
        isPrivate: false,
        issues: { open: 0, closed: 0 },
        pullRequests: { open: 0, closed: 0, merged: 0 },
        pullRequestDetails: [],
        weeklyTrends: [],
        committerCount: 0,
        reviewerCount: 0,
        contributorCount: 0,
        dependentCount: 0,
      };
      vi.mocked(loadCache).mockReturnValue({
        owner: "org",
        ownerType: "org",
        collectedAt: "2026-09-25T10:00:00Z",
        repoCount: 1,
        repos: [previouslyPublic],
      });
      vi.mocked(loadRawCache).mockReturnValue({
        owner: "org",
        ownerType: "org",
        collectedAt: "2026-09-25T10:00:00Z",
        repoCount: 1,
        repos: [previouslyPublic],
        weeklyTrends: [],
      });
      vi.mocked(isWithinHours).mockReturnValue(true);
      vi.mocked(collectRepos).mockResolvedValue([
        { name: "r", fullName: "org/r", pushedAt: "", isPrivate: true },
      ]);
      const result = await collect("org", "org", { config });
      expect(loadCache).not.toHaveBeenCalled();
      expect(collectRepos).toHaveBeenCalledTimes(1);
      expect(collectRepoGraphQL).not.toHaveBeenCalled();
      expect(result.repos[0].isPrivate).toBe(true);
    }
  );

  it("saves collected metrics to cache after a fresh collection", async () => {
    setupDefaultMocks();

    await collect("fresh-org", "org");

    expect(saveCache).toHaveBeenCalledWith(
      "fresh-org",
      expect.objectContaining({ owner: "fresh-org", schemaVersion: 2 })
    );
  });

  it("recollects trends when cached repos are missing per-repo weeklyTrends", async () => {
    setupDefaultMocks();
    // Simulate raw cache with org-level trends but no per-repo weeklyTrends
    const rawCache: OrgMetrics = {
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-01-01T00:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "r",
          fullName: "org/r",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 0 },
          pullRequestDetails: [],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
          // weeklyTrends intentionally absent (old cache format)
        },
      ],
      weeklyTrends: [
        { week: "2026-W01", prsOpened: 1, prsMerged: 0, issuesOpened: 0, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 },
      ],
    };
    vi.mocked(loadRawCache).mockReturnValue(rawCache);
    // All repos are "within hours" so none are re-fetched
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(collectRepos).mockResolvedValue([{ name: "r", fullName: "org/r", pushedAt: "" }]);
    vi.mocked(collectWeeklyTrends).mockResolvedValue({
      orgTrends: [{ week: "2026-W01", prsOpened: 1, prsMerged: 0, issuesOpened: 2, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 }],
      repoTrends: new Map([["org/r", [{ week: "2026-W01", prsOpened: 1, prsMerged: 0, issuesOpened: 2, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 }]]]),
      failedRepos: new Set(), truncatedRepos: new Set(),
    });

    const result = await collect("org", "org");

    // Trends should have been recollected due to missing per-repo weeklyTrends
    expect(collectWeeklyTrends).toHaveBeenCalled();
    // Repo should now have weeklyTrends populated
    expect(result.repos[0].weeklyTrends).toBeDefined();
    expect(result.repos[0].weeklyTrends).toHaveLength(1);
  });

  it("calls collectWeeklyTrends with 104 weeks to support multi-year trend history", async () => {
    setupDefaultMocks();
    vi.mocked(collectRepos).mockResolvedValue([{ name: "r", fullName: "owner/r", pushedAt: "" }]);

    await collect("owner", "org");

    expect(collectWeeklyTrends).toHaveBeenCalledWith(
      expect.any(Array),
      104,
      expect.any(Number),
      expect.any(Map)
    );
  });

  it("skips trend recollection when all repos already have per-repo weeklyTrends", async () => {
    setupDefaultMocks();
    const repoWithTrends = {
      name: "r",
      fullName: "org/r",
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, closed: 0, merged: 0 },
      pullRequestDetails: [],
      committerCount: 0,
      reviewerCount: 0,
      contributorCount: 0,
      dependentCount: 0,
      weeklyTrends: [{ week: "2026-W01", prsOpened: 0, prsMerged: 0, issuesOpened: 1, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 }],
    };
    const rawCache: OrgMetrics = {
      owner: "org",
      ownerType: "org",
      collectedAt: "2026-01-01T00:00:00Z",
      repoCount: 1,
      repos: [repoWithTrends],
      weeklyTrends: repoWithTrends.weeklyTrends,
    };
    vi.mocked(loadRawCache).mockReturnValue(rawCache);
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(collectRepos).mockResolvedValue([{ name: "r", fullName: "org/r", pushedAt: "" }]);

    await collect("org", "org");

    // Trends should NOT be recollected since per-repo data already exists
    expect(collectWeeklyTrends).not.toHaveBeenCalled();
  });
});

describe("collect (incremental)", () => {
  afterEach(() => vi.resetAllMocks());

  const today = new Date().toISOString().slice(0, 10);
  const baselineAt = `${today}T00:00:01.000Z`;
  const week = weekLabels(104).at(-1) ?? "";

  function point(prsMerged: number): WeeklyTrendPoint {
    return { week, prsOpened: 0, prsMerged, issuesOpened: 0, issuesClosed: 0, linesAdded: 0, linesDeleted: 0 };
  }

  function cachedRepo(name: string, overrides: Partial<RepoMetrics> = {}): RepoMetrics {
    return {
      name,
      fullName: `org/${name}`,
      pushedAt: "2026-01-01T00:00:00Z",
      collectedAt: baselineAt,
      issues: { open: 7, closed: 0 },
      pullRequests: { open: 0, closed: 0, merged: 0 },
      pullRequestDetails: [],
      committerCount: 0,
      reviewerCount: 0,
      contributorCount: 0,
      dependentCount: 0,
      weeklyTrends: [point(1)],
      ...overrides,
    };
  }

  function incrementalConfig() {
    const config = defaultConfig();
    config.collection.incremental = true;
    return config;
  }

  function withBaseline(repos: RepoMetrics[]) {
    vi.mocked(loadRawCache).mockReturnValue({
      owner: "org", ownerType: "org", collectedAt: baselineAt,
      repoCount: repos.length, repos, weeklyTrends: [],
    });
  }

  it("re-collects only repos that were pushed or had issue/PR activity", async () => {
    setupDefaultMocks();
    withBaseline([cachedRepo("quiet"), cachedRepo("pushed"), cachedRepo("reviewed")]);
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "quiet", fullName: "org/quiet", pushedAt: "2026-01-01T00:00:00Z" },
      { name: "pushed", fullName: "org/pushed", pushedAt: "2026-01-02T00:00:00Z" },
      { name: "reviewed", fullName: "org/reviewed", pushedAt: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(collectActiveRepos).mockResolvedValue(new Set(["org/reviewed"]));
    vi.mocked(collectWeeklyTrends).mockResolvedValue({
      orgTrends: [],
      repoTrends: new Map([
        ["org/pushed", [point(2)]],
        ["org/reviewed", [point(3)]],
      ]),
      failedRepos: new Set(), truncatedRepos: new Set(),
    });

    const result = await collect("org", "org", { config: incrementalConfig() });

    expect(loadCache).not.toHaveBeenCalled();
    expect(collectActiveRepos).toHaveBeenCalledWith("org", "org", baselineAt);
    expect(collectIssueCounts).toHaveBeenCalledTimes(2);
    expect(collectIssueCounts).not.toHaveBeenCalledWith("org", "quiet");
    expect(collectWeeklyTrends).toHaveBeenCalledWith(
      // Bounded because these mocks collect over REST, which flags the repo.
      [
        { owner: "org", name: "pushed", maxPages: expect.any(Number) },
        { owner: "org", name: "reviewed", maxPages: expect.any(Number) },
      ],
      104,
      expect.any(Number),
      expect.any(Map)
    );
    expect(result.repos.find((r) => r.name === "quiet")?.issues.open).toBe(7);
    // Org trends are the sum of the reused and the re-counted repos.
    expect(result.weeklyTrends?.find((p) => p.week === week)?.prsMerged).toBe(6);
    expect(result.weeklyTrends).toHaveLength(104);
  });

  it("matches active repos case-insensitively", async () => {
    setupDefaultMocks();
    withBaseline([cachedRepo("Mixed", { fullName: "Org/Mixed" })]);
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "Mixed", fullName: "Org/Mixed", pushedAt: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(collectActiveRepos).mockResolvedValue(new Set(["org/mixed"]));

    await collect("org", "org", { config: incrementalConfig() });

    expect(collectIssueCounts).toHaveBeenCalledWith("Org", "Mixed");
  });

  it("always re-collects a repo that had open pull requests", async () => {
    setupDefaultMocks();
    withBaseline([
      cachedRepo("in-review", { pullRequests: { open: 1, closed: 0, merged: 0 } }),
    ]);
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "in-review", fullName: "org/in-review", pushedAt: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(collectActiveRepos).mockResolvedValue(new Set());

    await collect("org", "org", { config: incrementalConfig() });

    expect(collectIssueCounts).toHaveBeenCalledWith("org", "in-review");
  });

  it("searches activity with the corrected owner type", async () => {
    setupDefaultMocks();
    withBaseline([cachedRepo("quiet")]);
    vi.mocked(resolveOwnerType).mockResolvedValue("user");
    vi.mocked(collectActiveRepos).mockResolvedValue(new Set());

    await collect("someone", "org", { config: incrementalConfig() });

    expect(collectActiveRepos).toHaveBeenCalledWith("someone", "user", baselineAt);
  });

  it("makes no per-repo calls when nothing changed", async () => {
    setupDefaultMocks();
    withBaseline([cachedRepo("quiet")]);
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "quiet", fullName: "org/quiet", pushedAt: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(collectActiveRepos).mockResolvedValue(new Set());

    const result = await collect("org", "org", { config: incrementalConfig() });

    expect(collectIssueCounts).not.toHaveBeenCalled();
    expect(collectWeeklyTrends).not.toHaveBeenCalled();
    expect(result.weeklyTrends?.find((p) => p.week === week)?.prsMerged).toBe(1);
  });

  it("ignores a baseline from an earlier day and collects everything", async () => {
    setupDefaultMocks();
    withBaseline([cachedRepo("quiet", { collectedAt: "2020-01-01T00:00:00Z" })]);
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "quiet", fullName: "org/quiet", pushedAt: "2026-01-01T00:00:00Z" },
    ]);

    await collect("org", "org", { config: incrementalConfig() });

    expect(collectActiveRepos).not.toHaveBeenCalled();
    expect(collectIssueCounts).toHaveBeenCalledTimes(1);
  });

  it("collects everything when the activity search cannot give a complete answer", async () => {
    setupDefaultMocks();
    withBaseline([cachedRepo("quiet")]);
    vi.mocked(isWithinHours).mockReturnValue(true);
    vi.mocked(collectRepos).mockResolvedValue([
      { name: "quiet", fullName: "org/quiet", pushedAt: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(collectActiveRepos).mockResolvedValue(null);

    await collect("org", "org", { config: incrementalConfig() });

    expect(collectIssueCounts).toHaveBeenCalledTimes(1);
  });
});

describe("collectGroup", () => {
  afterEach(() => {
    vi.resetAllMocks();
    resetOctokit();
  });

  it("returns cached data immediately without calling getOctokit", async () => {
    const cached: OrgMetrics = {
      owner: "acme-corp",
      ownerType: "org",
      groupName: "Acme",
      collectedAt: "2026-01-01T00:00:00Z",
      repoCount: 1,
      repos: [],
    };
    vi.mocked(loadCache).mockReturnValue(cached);

    const result = await collectGroup("Acme", [{ owner: "acme-corp", name: "repo-a" }]);

    expect(result).toBe(cached);
  });

  it("stores the result under a slugified cache key derived from groupName", async () => {
    setupDefaultMocks();
    setOctokit({
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({
            data: { full_name: "acme-corp/repo-a", pushed_at: "2026-01-01T00:00:00Z" },
          }),
        },
      },
    } as never);

    const result = await collectGroup("Acme", [{ owner: "acme-corp", name: "repo-a" }]);

    expect(saveCache).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ groupName: "Acme", owner: "acme-corp" })
    );
    expect(result.groupName).toBe("Acme");
    expect(result.repoCount).toBe(1);
  });

  it("skips repos that can't be fetched and logs a warning", async () => {
    setupDefaultMocks();
    const getMock = vi.fn()
      .mockResolvedValueOnce({ data: { full_name: "acme-corp/repo-a", pushed_at: "" } })
      .mockRejectedValueOnce({ status: 404 });
    setOctokit({ rest: { repos: { get: getMock } } } as never);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await collectGroup("Acme", [
      { owner: "acme-corp", name: "repo-a" },
      { owner: "acme-corp", name: "missing-repo" },
    ]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing-repo"));
    expect(result.repoCount).toBe(1);
    warnSpy.mockRestore();
  });
});
