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
  prs?: Array<{ created_at: string; updated_at: string; merged_at: string | null }>;
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
      pulls: { list: {} },
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
});
