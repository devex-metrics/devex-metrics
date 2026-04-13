import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import {
  collectPullRequestCounts,
  collectPullRequestDetails,
  collectMergedPRTimeline,
  computeCopilotAdoption,
  parseIssueRefs,
} from "./pull-requests.js";

/** Build a fake Octokit whose pulls.list returns controlled data. */
function buildMockOctokit(opts: {
  openPrsTotal: number;
  closedPrs: Array<{ merged_at: string | null }>;
}) {
  function fakeListResponse(total: number) {
    const data = total > 0 ? [{ id: 1 }] : [];
    const headers: Record<string, string> = {};
    if (total > 1) {
      headers.link = `<https://api.github.com/fake?page=${total}>; rel="last"`;
    }
    return Promise.resolve({ data, headers });
  }

  const mock = {
    rest: {
      pulls: {
        list: ({ state, per_page }: { state: string; per_page: number }) => {
          if (state === "open") {
            return fakeListResponse(opts.openPrsTotal);
          }
          // For closed, return the full array (paginate path)
          return fakeListResponse(opts.closedPrs.length);
        },
      },
    },
    paginate: (_method: unknown, _params: unknown) => {
      // Returns the full closed PR list
      return Promise.resolve(opts.closedPrs);
    },
  } as unknown as Octokit;

  return mock;
}

describe("collectPullRequestCounts", () => {
  afterEach(() => resetOctokit());

  it("should return correct open/closed/merged counts", async () => {
    setOctokit(
      buildMockOctokit({
        openPrsTotal: 4,
        closedPrs: [
          { merged_at: "2026-01-01T00:00:00Z" },
          { merged_at: "2026-01-02T00:00:00Z" },
          { merged_at: null }, // closed but not merged
        ],
      })
    );

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 4, closed: 1, merged: 2 });
  });

  it("should return zeros for an empty repo", async () => {
    setOctokit(
      buildMockOctokit({
        openPrsTotal: 0,
        closedPrs: [],
      })
    );

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0, merged: 0 });
  });

  it("should count all closed as merged when all have merged_at", async () => {
    setOctokit(
      buildMockOctokit({
        openPrsTotal: 0,
        closedPrs: [
          { merged_at: "2026-01-01T00:00:00Z" },
          { merged_at: "2026-01-02T00:00:00Z" },
        ],
      })
    );

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0, merged: 2 });
  });

  it("should return zero counts when repo is not found (404)", async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          list: () => Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })),
        },
      },
      paginate: () => Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })),
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectPullRequestCounts("owner", "missing-repo");
    expect(counts).toEqual({ open: 0, closed: 0, merged: 0 });
  });

  it("should rethrow errors that are not 404", async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          list: () => Promise.reject(Object.assign(new Error("Server Error"), { status: 500 })),
        },
      },
      paginate: () => Promise.reject(Object.assign(new Error("Server Error"), { status: 500 })),
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    await expect(collectPullRequestCounts("owner", "repo")).rejects.toMatchObject({ status: 500 });
  });

  it("should return zero counts on 403 and emit a console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockOctokit = {
      rest: {
        pulls: {
          list: () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 })),
        },
      },
      paginate: () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 })),
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0, merged: 0 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    warnSpy.mockRestore();
  });
});

// ── collectPullRequestDetails ─────────────────────────────────────────────────

type ClosedPR = {
  number: number;
  title: string;
  merged_at: string | null;
  created_at: string;
  user?: { login: string; type: string };
  body?: string | null;
};
type PRDetail = {
  additions: number;
  deletions: number;
  comments: number;
  review_comments: number;
  commits: number;
  head: { sha: string };
};
type CheckRun = { started_at: string | null; completed_at: string | null };
type Review = { user?: { login: string } | null; state: string };

function buildDetailsOctokit(opts: {
  prs?: ClosedPR[];
  details?: Map<number, PRDetail>;
  checkRuns?: Map<string, CheckRun[]>;
  reviews?: Map<number, Review[]>;
  listError?: { status: number };
  checksThrow?: boolean;
  reviewsThrow?: boolean;
}): Octokit {
  const prs = opts.prs ?? [];
  const details = opts.details ?? new Map<number, PRDetail>();
  const checkRuns = opts.checkRuns ?? new Map<string, CheckRun[]>();
  const reviews = opts.reviews ?? new Map<number, Review[]>();

  return {
    rest: {
      pulls: {
        list: async () => {
          if (opts.listError) {
            throw Object.assign(new Error("Error"), { status: opts.listError.status });
          }
          return { data: prs };
        },
        get: async ({ pull_number }: { pull_number: number }) => {
          const detail = details.get(pull_number) ?? {
            additions: 0,
            deletions: 0,
            comments: 0,
            review_comments: 0,
            commits: 1,
            head: { sha: `sha-${pull_number}` },
          };
          return { data: detail };
        },
        listReviews: async ({ pull_number }: { pull_number: number }) => {
          if (opts.reviewsThrow) throw new Error("No reviews");
          return { data: reviews.get(pull_number) ?? [] };
        },
      },
      checks: {
        listForRef: async ({ ref }: { ref: string }) => {
          if (opts.checksThrow) throw new Error("No check runs");
          return { data: { check_runs: checkRuns.get(ref) ?? [] } };
        },
      },
    },
  } as unknown as Octokit;
}

describe("collectPullRequestDetails", () => {
  afterEach(() => resetOctokit());

  it("returns details for merged PRs", async () => {
    const sha = "sha-42";
    setOctokit(
      buildDetailsOctokit({
        prs: [{ number: 42, title: "Add feature", merged_at: "2026-03-01T00:00:00Z", created_at: "2026-02-28T00:00:00Z", user: { login: "dev1", type: "User" } }],
        details: new Map([
          [42, { additions: 50, deletions: 10, comments: 3, review_comments: 2, commits: 2, head: { sha } }],
        ]),
      })
    );

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 42,
      title: "Add feature",
      state: "merged",
      createdAt: "2026-02-28T00:00:00Z",
      author: "dev1",
      isCopilotAuthored: false,
      hasCopilotReview: false,
      linesAdded: 50,
      linesDeleted: 10,
      commentCount: 5, // comments + review_comments
      commitCount: 2,
      mergedAt: "2026-03-01T00:00:00Z",
    });
    expect(result[0].timeToMergeHours).toBeGreaterThan(0);
  });

  it("excludes unmerged (closed) PRs from the results", async () => {
    setOctokit(
      buildDetailsOctokit({
        prs: [
          { number: 1, title: "Merged", merged_at: "2026-03-01T00:00:00Z", created_at: "2026-02-28T00:00:00Z", user: { login: "dev", type: "User" } },
          { number: 2, title: "Closed without merge", merged_at: null, created_at: "2026-02-28T00:00:00Z", user: { login: "dev", type: "User" } },
        ],
      })
    );

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
  });

  it("computes actionsMinutes from check run start/end timestamps", async () => {
    const sha = "sha-99";
    setOctokit(
      buildDetailsOctokit({
        prs: [{ number: 99, title: "CI test", merged_at: "2026-03-01T00:00:00Z", created_at: "2026-02-28T00:00:00Z", user: { login: "dev", type: "User" } }],
        details: new Map([
          [99, { additions: 0, deletions: 0, comments: 0, review_comments: 0, commits: 1, head: { sha } }],
        ]),
        checkRuns: new Map([[sha, [{ started_at: "2026-03-01T10:00:00Z", completed_at: "2026-03-01T10:02:30Z" }]]]),
      })
    );

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result[0].actionsMinutes).toBe(2.5); // 2m30s
  });

  it("returns actionsMinutes = 0 when checks.listForRef fails", async () => {
    setOctokit(
      buildDetailsOctokit({
        prs: [{ number: 1, title: "No checks", merged_at: "2026-03-01T00:00:00Z", created_at: "2026-02-28T00:00:00Z", user: { login: "dev", type: "User" } }],
        checksThrow: true,
      })
    );

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result[0].actionsMinutes).toBe(0);
  });

  it("returns [] on 404", async () => {
    setOctokit(buildDetailsOctokit({ listError: { status: 404 } }));

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result).toEqual([]);
  });

  it("returns [] on 403 and emits a console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(buildDetailsOctokit({ listError: { status: 403 } }));

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    warnSpy.mockRestore();
  });

  it("skips a PR whose detail fetch throws and still returns others", async () => {
    setOctokit({
      rest: {
        pulls: {
          list: async () => ({
            data: [
              { number: 1, title: "Fails", merged_at: "2026-01-01T00:00:00Z", created_at: "2025-12-30T00:00:00Z", user: { login: "dev", type: "User" } },
              { number: 2, title: "Succeeds", merged_at: "2026-01-02T00:00:00Z", created_at: "2025-12-31T00:00:00Z", user: { login: "dev", type: "User" } },
            ],
          }),
          get: async ({ pull_number }: { pull_number: number }) => {
            if (pull_number === 1) throw new Error("Unavailable");
            return { data: { additions: 5, deletions: 2, comments: 0, review_comments: 0, commits: 1, head: { sha: "sha-2" } } };
          },
          listReviews: async () => ({ data: [] }),
        },
        checks: { listForRef: async () => ({ data: { check_runs: [] } }) },
      },
    } as unknown as Octokit);

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(2);
  });

  it("passes the limit as per_page to the list call", async () => {
    const capturedParams: unknown[] = [];
    setOctokit({
      rest: {
        pulls: {
          list: async (params: unknown) => {
            capturedParams.push(params);
            return { data: [] };
          },
          get: async () => ({ data: {} }),
          listReviews: async () => ({ data: [] }),
        },
        checks: { listForRef: async () => ({ data: { check_runs: [] } }) },
      },
    } as unknown as Octokit);

    await collectPullRequestDetails("owner", "repo", 5);
    expect(capturedParams[0]).toMatchObject({ per_page: 5 });
  });

  it("returns PRs sorted by mergedAt descending (newest first)", async () => {
    setOctokit(
      buildDetailsOctokit({
        prs: [
          { number: 10, title: "Old", merged_at: "2026-01-01T00:00:00Z", created_at: "2025-12-30T00:00:00Z", user: { login: "dev", type: "User" } },
          { number: 20, title: "New", merged_at: "2026-03-01T00:00:00Z", created_at: "2026-02-28T00:00:00Z", user: { login: "dev", type: "User" } },
        ],
      })
    );

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result[0].number).toBe(20);
    expect(result[1].number).toBe(10);
  });

  it("detects Copilot review and copilot-authored PR", async () => {
    const copilotReview: Review = { user: { login: "copilot[bot]" }, state: "CHANGES_REQUESTED" };
    setOctokit(
      buildDetailsOctokit({
        prs: [{
          number: 7,
          title: "Bot PR",
          merged_at: "2026-03-02T00:00:00Z",
          created_at: "2026-03-01T00:00:00Z",
          user: { login: "copilot[bot]", type: "Bot" },
        }],
        reviews: new Map([[7, [copilotReview]]]),
      })
    );

    const result = await collectPullRequestDetails("owner", "repo");
    expect(result).toHaveLength(1);
    expect(result[0].isCopilotAuthored).toBe(true);
    expect(result[0].hasCopilotReview).toBe(true);
    expect(result[0].author).toBe("copilot[bot]");
  });
});

// ── parseIssueRefs ────────────────────────────────────────────────────────────

describe("parseIssueRefs", () => {
  it("extracts issue numbers from closing keywords", () => {
    expect(parseIssueRefs("Fixes #42")).toEqual([42]);
    expect(parseIssueRefs("closes #1, fixes #2")).toEqual([1, 2]);
    expect(parseIssueRefs("Resolves #100")).toEqual([100]);
  });

  it("handles 'fixed', 'close', 'resolved' variants", () => {
    expect(parseIssueRefs("fixed #5")).toEqual([5]);
    expect(parseIssueRefs("close #3")).toEqual([3]);
    expect(parseIssueRefs("resolved #8")).toEqual([8]);
  });

  it("deduplicates issue numbers", () => {
    expect(parseIssueRefs("Fixes #10, also fixes #10")).toEqual([10]);
  });

  it("returns [] for null/undefined/empty body", () => {
    expect(parseIssueRefs(null)).toEqual([]);
    expect(parseIssueRefs(undefined)).toEqual([]);
    expect(parseIssueRefs("")).toEqual([]);
  });

  it("ignores non-matching text", () => {
    expect(parseIssueRefs("This PR adds feature #99")).toEqual([]);
    expect(parseIssueRefs("See issue #5 for details")).toEqual([]);
  });
});

// ── collectMergedPRTimeline ───────────────────────────────────────────────────

describe("collectMergedPRTimeline", () => {
  afterEach(() => resetOctokit());

  function buildTimelineOctokit(pages: Array<Array<{
    number: number;
    created_at: string;
    merged_at: string | null;
    user?: { login: string; type: string };
    body?: string | null;
  }>>): Octokit {
    let callCount = 0;
    return {
      rest: {
        pulls: {
          list: async () => {
            const data = pages[callCount] ?? [];
            callCount++;
            return { data };
          },
        },
      },
    } as unknown as Octokit;
  }

  it("returns enriched timeline entries for merged PRs", async () => {
    setOctokit(buildTimelineOctokit([[
      {
        number: 1,
        created_at: "2026-01-01T00:00:00Z",
        merged_at: "2026-01-03T00:00:00Z",
        user: { login: "dev1", type: "User" },
        body: "Fixes #42",
      },
      {
        number: 2,
        created_at: "2026-01-02T00:00:00Z",
        merged_at: null, // not merged - should be excluded
        user: { login: "dev2", type: "User" },
        body: null,
      },
    ]]));

    const result = await collectMergedPRTimeline("owner", "repo");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 1,
      author: "dev1",
      isBotAuthor: false,
      isCopilotAuthored: false,
      closesIssues: [42],
    });
    expect(result[0].timeToMergeHours).toBe(48);
  });

  it("detects bot authors", async () => {
    setOctokit(buildTimelineOctokit([[
      {
        number: 10,
        created_at: "2026-01-01T00:00:00Z",
        merged_at: "2026-01-01T01:00:00Z",
        user: { login: "dependabot[bot]", type: "Bot" },
        body: null,
      },
      {
        number: 11,
        created_at: "2026-01-01T00:00:00Z",
        merged_at: "2026-01-02T01:00:00Z",
        user: { login: "copilot[bot]", type: "Bot" },
        body: null,
      },
    ]]));

    const result = await collectMergedPRTimeline("owner", "repo");
    expect(result).toHaveLength(2);
    // sorted desc by mergedAt: copilot[bot] (Jan 2) first, dependabot[bot] (Jan 1) second
    const copilotEntry = result.find((e) => e.number === 11)!;
    const dependabotEntry = result.find((e) => e.number === 10)!;
    expect(dependabotEntry.isBotAuthor).toBe(true);
    expect(dependabotEntry.isCopilotAuthored).toBe(false);
    expect(copilotEntry.isBotAuthor).toBe(true);
    expect(copilotEntry.isCopilotAuthored).toBe(true);
  });

  it("returns sorted by mergedAt descending", async () => {
    setOctokit(buildTimelineOctokit([[
      {
        number: 1,
        created_at: "2026-01-01T00:00:00Z",
        merged_at: "2026-01-02T00:00:00Z",
        user: { login: "dev", type: "User" },
        body: null,
      },
      {
        number: 2,
        created_at: "2026-01-03T00:00:00Z",
        merged_at: "2026-01-04T00:00:00Z",
        user: { login: "dev", type: "User" },
        body: null,
      },
    ]]));

    const result = await collectMergedPRTimeline("owner", "repo");
    expect(result[0].number).toBe(2);
    expect(result[1].number).toBe(1);
  });

  it("handles 404 gracefully", async () => {
    setOctokit({
      rest: {
        pulls: {
          list: async () => { throw Object.assign(new Error("Not found"), { status: 404 }); },
        },
      },
    } as unknown as Octokit);

    const result = await collectMergedPRTimeline("owner", "repo");
    expect(result).toEqual([]);
  });

  it("handles 403 gracefully", async () => {
    setOctokit({
      rest: {
        pulls: {
          list: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); },
        },
      },
    } as unknown as Octokit);

    const result = await collectMergedPRTimeline("owner", "repo");
    expect(result).toEqual([]);
  });

  it("re-throws non-403/404 errors", async () => {
    setOctokit({
      rest: {
        pulls: {
          list: async () => { throw Object.assign(new Error("Server Error"), { status: 500 }); },
        },
      },
    } as unknown as Octokit);

    await expect(collectMergedPRTimeline("owner", "repo")).rejects.toThrow("Server Error");
  });

  it("defaults unknown author when user is null", async () => {
    setOctokit(buildTimelineOctokit([[
      {
        number: 5,
        created_at: "2026-01-01T00:00:00Z",
        merged_at: "2026-01-02T00:00:00Z",
        user: undefined,
        body: null,
      },
    ]]));

    const result = await collectMergedPRTimeline("owner", "repo");
    expect(result[0].author).toBe("unknown");
    expect(result[0].isBotAuthor).toBe(false);
  });
});

// ── computeCopilotAdoption ────────────────────────────────────────────────────

describe("computeCopilotAdoption", () => {
  it("counts copilot-authored and copilot-reviewed PRs", () => {
    const timeline: Parameters<typeof computeCopilotAdoption>[0] = [
      { number: 1, createdAt: "", mergedAt: "", author: "copilot[bot]", isBotAuthor: true, isCopilotAuthored: true, timeToMergeHours: 1, closesIssues: [] },
      { number: 2, createdAt: "", mergedAt: "", author: "dev", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 2, closesIssues: [] },
      { number: 3, createdAt: "", mergedAt: "", author: "copilot[bot]", isBotAuthor: true, isCopilotAuthored: true, timeToMergeHours: 1, closesIssues: [] },
    ];
    const details: Parameters<typeof computeCopilotAdoption>[1] = [
      { number: 1, title: "", state: "merged", createdAt: "", author: "copilot[bot]", isCopilotAuthored: true, hasCopilotReview: false, linesAdded: 0, linesDeleted: 0, commentCount: 0, commitCount: 1, actionsMinutes: 0 },
      { number: 2, title: "", state: "merged", createdAt: "", author: "dev", isCopilotAuthored: false, hasCopilotReview: true, linesAdded: 0, linesDeleted: 0, commentCount: 0, commitCount: 1, actionsMinutes: 0 },
    ];

    const result = computeCopilotAdoption(timeline, details);
    expect(result).toEqual({
      copilotAuthoredPRs: 2,
      copilotReviewedPRs: 1,
      totalMergedPRs: 3,
      totalDetailedPRs: 2,
    });
  });

  it("returns zeros for empty inputs", () => {
    const result = computeCopilotAdoption([], []);
    expect(result).toEqual({
      copilotAuthoredPRs: 0,
      copilotReviewedPRs: 0,
      totalMergedPRs: 0,
      totalDetailedPRs: 0,
    });
  });
});
