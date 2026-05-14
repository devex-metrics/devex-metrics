import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./cache.js", () => ({
  loadCache: vi.fn(),
  loadRawCache: vi.fn(),
  isWithinHours: vi.fn(),
  saveCache: vi.fn(),
  CURRENT_SCHEMA_VERSION: 2,
}));

vi.mock("./collectors/index.js", () => ({
  collectRepos: vi.fn(),
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
  extractReviewerLogins: vi.fn(),
  collectCopilotAgentMetrics: vi.fn(),
}));

import { collect } from "./collect.js";
import { loadCache, loadRawCache, isWithinHours, saveCache } from "./cache.js";
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
import type { OrgMetrics } from "./types.js";

function setupDefaultMocks() {
  vi.mocked(loadCache).mockReturnValue(null);
  vi.mocked(loadRawCache).mockReturnValue(null);
  vi.mocked(isWithinHours).mockReturnValue(false);
  vi.mocked(saveCache).mockReturnValue(undefined);
  vi.mocked(collectRepos).mockResolvedValue([]);
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
  vi.mocked(collectWeeklyTrends).mockResolvedValue({ orgTrends: [], repoTrends: new Map() });
  vi.mocked(buildPullRequestCounts).mockReturnValue({ open: 0, closed: 0, merged: 0 });
  vi.mocked(buildMergedPRTimeline).mockReturnValue([]);
  vi.mocked(collectPullRequestDetailsFromNodes).mockResolvedValue([]);
  vi.mocked(extractReviewerLogins).mockReturnValue(new Set());
  vi.mocked(collectCopilotAgentMetrics).mockResolvedValue(null);
}

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
