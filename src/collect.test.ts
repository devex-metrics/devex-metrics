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
} from "./collectors/index.js";
import type { OrgMetrics } from "./types.js";

function setupDefaultMocks() {
  vi.mocked(loadCache).mockReturnValue(null);
  vi.mocked(loadRawCache).mockReturnValue(null);
  vi.mocked(isWithinHours).mockReturnValue(false);
  vi.mocked(saveCache).mockReturnValue(undefined);
  vi.mocked(collectRepos).mockResolvedValue([]);
  vi.mocked(collectIssueCounts).mockResolvedValue({ open: 0, closed: 0 });
  vi.mocked(collectPullRequestCounts).mockResolvedValue({ open: 0, closed: 0, merged: 0 });
  vi.mocked(collectPullRequestDetails).mockResolvedValue([]);
  vi.mocked(collectMergedPRTimeline).mockResolvedValue([]);
  vi.mocked(collectIssueLeadTimes).mockResolvedValue([]);
  vi.mocked(computeCopilotAdoption).mockReturnValue({
    copilotAuthoredPRs: 0, copilotReviewedPRs: 0, totalMergedPRs: 0, totalDetailedPRs: 0,
  });
  vi.mocked(collectContributors).mockResolvedValue({ committerCount: 0, reviewerCount: 0 });
  vi.mocked(collectDependentCount).mockResolvedValue(0);
  vi.mocked(collectWeeklyTrends).mockResolvedValue([]);
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
});
