import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectIssueCounts, collectIssueLeadTimes } from "./issues.js";
import type { MergedPRSummary } from "../types.js";

/** Build a fake Octokit whose search endpoint returns controlled total_counts. */
function buildMockOctokit(opts: {
  openIssuesTotal: number;
  closedIssuesTotal: number;
}) {
  return {
    rest: {
      search: {
        issuesAndPullRequests: ({ q }: { q: string }) => {
          const total = q.includes("state:open")
            ? opts.openIssuesTotal
            : opts.closedIssuesTotal;
          return Promise.resolve({ data: { total_count: total, items: [] } });
        },
      },
    },
  } as unknown as Octokit;
}

describe("collectIssueCounts", () => {
  afterEach(() => resetOctokit());

  it("should return issue counts directly from the issues API", async () => {
    setOctokit(
      buildMockOctokit({
        openIssuesTotal: 7,
        closedIssuesTotal: 15,
      })
    );

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 7, closed: 15 });
  });

  it("should return zero counts for an empty repo", async () => {
    setOctokit(
      buildMockOctokit({
        openIssuesTotal: 0,
        closedIssuesTotal: 0,
      })
    );

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });

  it("should return zero counts when repo is not found (404)", async () => {
    const mockOctokit = {
      rest: {
        search: {
          issuesAndPullRequests: () => Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectIssueCounts("owner", "missing-repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });

  it("should rethrow errors that are not 404/403/422", async () => {
    const mockOctokit = {
      rest: {
        search: {
          issuesAndPullRequests: () => Promise.reject(Object.assign(new Error("Server Error"), { status: 500 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    await expect(collectIssueCounts("owner", "repo")).rejects.toMatchObject({ status: 500 });
  });

  it("should return zero counts on 403 and emit a console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockOctokit = {
      rest: {
        search: {
          issuesAndPullRequests: () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    warnSpy.mockRestore();
  });

  it("should return zero counts on 422 (e.g. archived/empty repo search rejection)", async () => {
    const mockOctokit = {
      rest: {
        search: {
          issuesAndPullRequests: () => Promise.reject(Object.assign(new Error("Unprocessable"), { status: 422 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });
});

// ── collectIssueLeadTimes ─────────────────────────────────────────────────────

function makePRSummary(overrides: Partial<MergedPRSummary> & Pick<MergedPRSummary, "number" | "mergedAt" | "closesIssues">): MergedPRSummary {
  return {
    createdAt: "2026-01-01T00:00:00Z",
    author: "dev",
    isBotAuthor: false,
    isCopilotAuthored: false,
    timeToMergeHours: 24,
    ...overrides,
  };
}

describe("collectIssueLeadTimes", () => {
  afterEach(() => resetOctokit());

  it("computes lead time from issue creation to PR merge", async () => {
    const timeline: MergedPRSummary[] = [
      makePRSummary({ number: 10, mergedAt: "2026-01-05T00:00:00Z", closesIssues: [1] }),
    ];

    setOctokit({
      rest: {
        issues: {
          get: async () => ({
            data: { created_at: "2026-01-01T00:00:00Z" },
          }),
        },
      },
    } as unknown as Octokit);

    const result = await collectIssueLeadTimes("owner", "repo", timeline);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      issueNumber: 1,
      prNumber: 10,
      issueCreatedAt: "2026-01-01T00:00:00Z",
      prMergedAt: "2026-01-05T00:00:00Z",
      leadTimeHours: 96, // 4 days
    });
  });

  it("picks the earliest-merged PR when multiple PRs close the same issue", async () => {
    const timeline: MergedPRSummary[] = [
      makePRSummary({ number: 10, mergedAt: "2026-01-10T00:00:00Z", closesIssues: [5] }),
      makePRSummary({ number: 20, mergedAt: "2026-01-05T00:00:00Z", closesIssues: [5] }),
    ];

    setOctokit({
      rest: {
        issues: {
          get: async () => ({
            data: { created_at: "2026-01-01T00:00:00Z" },
          }),
        },
      },
    } as unknown as Octokit);

    const result = await collectIssueLeadTimes("owner", "repo", timeline);
    expect(result).toHaveLength(1);
    expect(result[0].prNumber).toBe(20); // earlier merge
  });

  it("returns [] when timeline has no issue refs", async () => {
    const timeline: MergedPRSummary[] = [
      makePRSummary({ number: 1, mergedAt: "2026-01-02T00:00:00Z", closesIssues: [] }),
    ];

    setOctokit({
      rest: {
        issues: {
          get: async () => { throw new Error("should not be called"); },
        },
      },
    } as unknown as Octokit);

    const result = await collectIssueLeadTimes("owner", "repo", timeline);
    expect(result).toEqual([]);
  });

  it("skips issues that return 404", async () => {
    const timeline: MergedPRSummary[] = [
      makePRSummary({ number: 1, mergedAt: "2026-01-02T00:00:00Z", closesIssues: [99] }),
    ];

    setOctokit({
      rest: {
        issues: {
          get: async () => { throw Object.assign(new Error("Not Found"), { status: 404 }); },
        },
      },
    } as unknown as Octokit);

    const result = await collectIssueLeadTimes("owner", "repo", timeline);
    expect(result).toEqual([]);
  });

  it("skips issues that return 403", async () => {
    const timeline: MergedPRSummary[] = [
      makePRSummary({ number: 1, mergedAt: "2026-01-02T00:00:00Z", closesIssues: [99] }),
    ];

    setOctokit({
      rest: {
        issues: {
          get: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); },
        },
      },
    } as unknown as Octokit);

    const result = await collectIssueLeadTimes("owner", "repo", timeline);
    expect(result).toEqual([]);
  });

  it("re-throws non-403/404 errors", async () => {
    const timeline: MergedPRSummary[] = [
      makePRSummary({ number: 1, mergedAt: "2026-01-02T00:00:00Z", closesIssues: [99] }),
    ];

    setOctokit({
      rest: {
        issues: {
          get: async () => { throw Object.assign(new Error("Server Error"), { status: 500 }); },
        },
      },
    } as unknown as Octokit);

    await expect(collectIssueLeadTimes("owner", "repo", timeline)).rejects.toThrow("Server Error");
  });
});
