import { describe, it, expect, afterEach } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectWeeklyTrends, toIsoWeekLabel } from "./trends.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a date string for N days from now (UTC). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

/** Build a mock Octokit for the trends collector. */
function buildMockOctokit(opts: {
  issues?: Array<{ created_at: string; state: string; closed_at?: string | null; pull_request?: object }>;
  prs?: Array<{ number?: number; created_at: string; updated_at: string; merged_at: string | null; additions?: number; deletions?: number }>;
  issueError?: { status: number };
  prError?: { status: number };
}) {
  const issuesData = opts.issues ?? [];
  const prsData = opts.prs ?? [];

  async function* paginateIterator(
    _method: unknown,
    _params: unknown
  ): AsyncGenerator<{ data: typeof prsData }> {
    if (opts.prError) {
      throw Object.assign(new Error("Error"), { status: opts.prError.status });
    }
    yield { data: prsData };
  }

  const paginateFn = Object.assign(
    (_method: unknown, _params: unknown) => {
      if (opts.issueError) {
        return Promise.reject(
          Object.assign(new Error("Error"), { status: opts.issueError.status })
        );
      }
      return Promise.resolve(issuesData);
    },
    {
      iterator: paginateIterator,
    }
  );

  return {
    rest: {
      issues: { listForRepo: {} },
      pulls: {
        list: {},
        get: async ({ pull_number }: { owner: string; repo: string; pull_number: number }) => {
          const pr = prsData.find((p) => p.number === pull_number);
          return { data: { additions: pr?.additions ?? 0, deletions: pr?.deletions ?? 0 } };
        },
      },
    },
    paginate: paginateFn,
  } as unknown as Octokit;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("toIsoWeekLabel", () => {
  it("labels a known Monday correctly", () => {
    // 2024-01-01 is a Monday, and is in ISO week 2024-W01.
    expect(toIsoWeekLabel(new Date("2024-01-01T00:00:00Z"))).toBe("2024-W01");
  });

  it("labels a Sunday as the same week as the preceding Monday", () => {
    // 2024-01-07 is a Sunday; ISO week still 2024-W01.
    expect(toIsoWeekLabel(new Date("2024-01-07T23:59:59Z"))).toBe("2024-W01");
  });

  it("labels year-boundary dates correctly (week spanning two years)", () => {
    // 2026-01-01 is a Thursday, so it belongs to 2026-W01.
    expect(toIsoWeekLabel(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("collectWeeklyTrends", () => {
  afterEach(() => resetOctokit());

  it("returns exactly weeksBack buckets all zeroed for an empty repo", async () => {
    setOctokit(buildMockOctokit({ issues: [], prs: [] }));
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    expect(trends).toHaveLength(4);
    for (const t of trends) {
      expect(t.prsOpened).toBe(0);
      expect(t.prsMerged).toBe(0);
      expect(t.issuesOpened).toBe(0);
      expect(t.issuesClosed).toBe(0);
      expect(t.linesAdded).toBe(0);
      expect(t.linesDeleted).toBe(0);
    }
  });

  it("counts an issue opened this week", async () => {
    setOctokit(
      buildMockOctokit({
        issues: [{ created_at: daysAgo(1), state: "open" }],
        prs: [],
      })
    );
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    const total = trends.reduce((s, t) => s + t.issuesOpened, 0);
    expect(total).toBe(1);
  });

  it("does not count issues with pull_request field", async () => {
    setOctokit(
      buildMockOctokit({
        issues: [
          { created_at: daysAgo(1), state: "open", pull_request: {} },
        ],
        prs: [],
      })
    );
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    const total = trends.reduce((s, t) => s + t.issuesOpened, 0);
    expect(total).toBe(0);
  });

  it("counts a closed issue in the correct closed bucket", async () => {
    setOctokit(
      buildMockOctokit({
        issues: [
          {
            created_at: daysAgo(10),
            state: "closed",
            closed_at: daysAgo(2),
          },
        ],
        prs: [],
      })
    );
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    const total = trends.reduce((s, t) => s + t.issuesClosed, 0);
    expect(total).toBe(1);
  });

  it("counts a PR opened this week", async () => {
    setOctokit(
      buildMockOctokit({
        issues: [],
        prs: [
          {
            created_at: daysAgo(1),
            updated_at: daysAgo(1),
            merged_at: null,
          },
        ],
      })
    );
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    const total = trends.reduce((s, t) => s + t.prsOpened, 0);
    expect(total).toBe(1);
  });

  it("counts a merged PR", async () => {
    setOctokit(
      buildMockOctokit({
        issues: [],
        prs: [
          {
            created_at: daysAgo(5),
            updated_at: daysAgo(2),
            merged_at: daysAgo(2),
          },
        ],
      })
    );
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    const total = trends.reduce((s, t) => s + t.prsMerged, 0);
    expect(total).toBe(1);
  });

  it("skips a repo that returns 404 and continues with others", async () => {
    // First call will throw 404 for issues; second repo is fine.
    let callCount = 0;

    async function* paginateIterator(): AsyncGenerator<{ data: Array<{ created_at: string; updated_at: string; merged_at: null }> }> {
      yield { data: [] };
    }

    const paginateFn = Object.assign(
      (_method: unknown, _params: unknown) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(
            Object.assign(new Error("Not Found"), { status: 404 })
          );
        }
        return Promise.resolve([
          { created_at: daysAgo(1), state: "open" },
        ]);
      },
      { iterator: paginateIterator }
    );

    setOctokit({
      rest: { issues: { listForRepo: {} }, pulls: { list: {} } },
      paginate: paginateFn,
    } as unknown as Octokit);

    // Should not throw; returns buckets with the second repo's data
    const trends = await collectWeeklyTrends(
      [
        { owner: "o", name: "missing" },
        { owner: "o", name: "good" },
      ],
      4
    );
    const total = trends.reduce((s, t) => s + t.issuesOpened, 0);
    expect(total).toBe(1);
  });

  it("returns buckets sorted by week ascending", async () => {
    setOctokit(buildMockOctokit({ issues: [], prs: [] }));
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 6);
    for (let i = 1; i < trends.length; i++) {
      expect(trends[i].week >= trends[i - 1].week).toBe(true);
    }
  });

  it("accumulates lines added and deleted for merged PRs", async () => {
    setOctokit(
      buildMockOctokit({
        issues: [],
        prs: [
          {
            number: 1,
            created_at: daysAgo(2),
            updated_at: daysAgo(1),
            merged_at: daysAgo(1),
            additions: 120,
            deletions: 30,
          },
        ],
      })
    );
    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    const totalAdded = trends.reduce((s, t) => s + t.linesAdded, 0);
    const totalDeleted = trends.reduce((s, t) => s + t.linesDeleted, 0);
    expect(totalAdded).toBe(120);
    expect(totalDeleted).toBe(30);
  });

  it("does not fetch PR details for unmerged PRs", async () => {
    let getCallCount = 0;

    async function* paginateIterator(): AsyncGenerator<{
      data: Array<{ number: number; created_at: string; updated_at: string; merged_at: null }>;
    }> {
      yield {
        data: [
          { number: 1, created_at: daysAgo(1), updated_at: daysAgo(1), merged_at: null },
          { number: 2, created_at: daysAgo(2), updated_at: daysAgo(2), merged_at: null },
        ],
      };
    }

    const paginateFn = Object.assign(
      (_method: unknown, _params: unknown) => Promise.resolve([]),
      { iterator: paginateIterator }
    );

    setOctokit({
      rest: {
        issues: { listForRepo: {} },
        pulls: {
          list: {},
          get: async () => {
            getCallCount++;
            return { data: { additions: 0, deletions: 0 } };
          },
        },
      },
      paginate: paginateFn,
    } as unknown as Octokit);

    await collectWeeklyTrends([{ owner: "o", name: "r" }], 4);
    expect(getCallCount).toBe(0);
  });

  it("respects the maxDetailFetches budget across repos", async () => {
    let getCallCount = 0;

    async function* paginateIterator(): AsyncGenerator<{
      data: Array<{ number: number; created_at: string; updated_at: string; merged_at: string }>;
    }> {
      yield {
        data: [
          { number: 1, created_at: daysAgo(1), updated_at: daysAgo(1), merged_at: daysAgo(1) },
          { number: 2, created_at: daysAgo(2), updated_at: daysAgo(2), merged_at: daysAgo(2) },
          { number: 3, created_at: daysAgo(3), updated_at: daysAgo(3), merged_at: daysAgo(3) },
        ],
      };
    }

    const paginateFn = Object.assign(
      (_method: unknown, _params: unknown) => Promise.resolve([]),
      { iterator: paginateIterator }
    );

    setOctokit({
      rest: {
        issues: { listForRepo: {} },
        pulls: {
          list: {},
          get: async () => {
            getCallCount++;
            return { data: { additions: 10, deletions: 5 } };
          },
        },
      },
      paginate: paginateFn,
    } as unknown as Octokit);

    // Two repos with 3 merged PRs each = 6 total, but budget is 4
    await collectWeeklyTrends(
      [
        { owner: "o", name: "r1" },
        { owner: "o", name: "r2" },
      ],
      4,
      4
    );
    expect(getCallCount).toBe(4);
  });
});

// ── prDataByRepo fast path ─────────────────────────────────────────────────────

import type { GraphQLPRNode } from "./repo-graphql.js";

function makeGraphQLPRNode(overrides: Partial<GraphQLPRNode> = {}): GraphQLPRNode {
  const now = new Date().toISOString();
  return {
    number: 1,
    title: "PR",
    state: "MERGED",
    createdAt: now,
    mergedAt: now,
    closedAt: now,
    updatedAt: now,
    headRefOid: "sha",
    body: null,
    author: { login: "alice", __typename: "User" },
    additions: 0,
    deletions: 0,
    commits: { totalCount: 1 },
    comments: { totalCount: 0 },
    reviewComments: { totalCount: 0 },
    reviews: { nodes: [] },
    ...overrides,
  };
}

describe("collectWeeklyTrends with prDataByRepo", () => {
  afterEach(() => resetOctokit());

  it("uses pre-fetched PR nodes and skips pulls.get when prDataByRepo provided", async () => {
    let getCallCount = 0;

    setOctokit({
      rest: {
        issues: { listForRepo: {} },
        pulls: {
          list: {},
          get: async () => {
            getCallCount++;
            return { data: { additions: 0, deletions: 0 } };
          },
        },
      },
      paginate: Object.assign(
        (_m: unknown) => Promise.resolve([]),
        {
          iterator: async function* () {
            yield { data: [] };
          },
        }
      ),
    } as unknown as Octokit);

    const prDataByRepo = new Map([
      [
        "o/r",
        [
          makeGraphQLPRNode({
            number: 1,
            state: "MERGED",
            createdAt: daysAgo(2),
            mergedAt: daysAgo(1),
            updatedAt: daysAgo(1),
            additions: 50,
            deletions: 20,
          }),
        ],
      ],
    ]);

    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4, 200, prDataByRepo);
    // Should have counted the merged PR with lines
    const totalMerged = trends.reduce((s, t) => s + t.prsMerged, 0);
    const totalAdded = trends.reduce((s, t) => s + t.linesAdded, 0);
    expect(totalMerged).toBe(1);
    expect(totalAdded).toBe(50);
    // Should NOT have called pulls.get since additions/deletions came from GraphQL node
    expect(getCallCount).toBe(0);
  });

  it("counts prsOpened for CLOSED/MERGED nodes created within window", async () => {
    setOctokit({
      rest: { issues: { listForRepo: {} }, pulls: { list: {}, get: vi.fn() } },
      paginate: Object.assign(
        (_m: unknown) => Promise.resolve([]),
        { iterator: async function* () { yield { data: [] }; } }
      ),
    } as unknown as Octokit);

    const prDataByRepo = new Map([
      [
        "o/r",
        [
          makeGraphQLPRNode({
            state: "CLOSED",
            createdAt: daysAgo(2),
            updatedAt: daysAgo(1),
            mergedAt: null,
          }),
        ],
      ],
    ]);

    const trends = await collectWeeklyTrends([{ owner: "o", name: "r" }], 4, 200, prDataByRepo);
    const totalOpened = trends.reduce((s, t) => s + t.prsOpened, 0);
    expect(totalOpened).toBe(1);
  });
});
