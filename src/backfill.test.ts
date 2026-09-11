import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("./collectors/repo-graphql.js", () => ({
  fetchHistoricalPRPage: vi.fn(),
}));

import { fetchHistoricalPRPage } from "./collectors/repo-graphql.js";
import { runBackfill, toEventRow, describeBackfill } from "./backfill.js";
import { loadBackfillState, loadEvents, saveBackfillState } from "./history.js";
import type { HistoricalPRNode } from "./collectors/repo-graphql.js";
import type { BackfillConfig } from "./config.js";

const mockFetch = vi.mocked(fetchHistoricalPRPage);

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-backfill-"));
  mockFetch.mockReset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function config(patch: Partial<BackfillConfig> = {}): BackfillConfig {
  return {
    enabled: true,
    pagesPerRun: 100,
    maxPagesPerRepo: 20,
    recomputeRollups: false,
    pageSize: 50,
    minPageSize: 10,
    adaptivePageSize: true,
    ...patch,
  };
}

/** The page-size fetch options `runBackfill` passes for `config()`'s defaults. */
const DEFAULT_SIZE_OPTIONS = { pageSize: 50, minPageSize: 10, adaptive: true };

function node(number: number, extra: Partial<HistoricalPRNode> = {}): HistoricalPRNode {
  return {
    number,
    state: "MERGED",
    createdAt: "2019-03-01T00:00:00Z",
    mergedAt: "2019-03-03T00:00:00Z",
    closedAt: "2019-03-03T00:00:00Z",
    author: { login: "alice", __typename: "User" },
    additions: 10,
    deletions: 2,
    body: null,
    reviews: { totalCount: 0, nodes: [] },
    ...extra,
  };
}

/** Queue `pages` responses; each entry is the nodes for one page. */
function queuePages(pages: HistoricalPRNode[][]) {
  pages.forEach((nodes, i) => {
    mockFetch.mockResolvedValueOnce({
      nodes,
      hasNextPage: i < pages.length - 1,
      endCursor: `cursor-${i}`,
      pageSize: 50,
    });
  });
}

describe("toEventRow", () => {
  it("maps a merged PR with its cycle time", () => {
    const row = toEventRow("acme", "acme/api", node(1));
    expect(row).toMatchObject({
      scope: "acme",
      repo: "acme/api",
      number: 1,
      state: "merged",
      author: "alice",
      isBot: false,
      timeToMergeHours: 48,
      linesAdded: 10,
      linesDeleted: 2,
    });
  });

  it("records a closed-unmerged PR without a merge time", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(2, { state: "CLOSED", mergedAt: null })
    );
    expect(row.state).toBe("closed");
    expect(row.mergedAt).toBeUndefined();
    expect(row.timeToMergeHours).toBeUndefined();
    expect(row.closedAt).toBe("2019-03-03T00:00:00Z");
  });

  it("captures the earliest review time as the raw review-latency fact", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(3, {
        reviews: {
          totalCount: 2,
          nodes: [
            { submittedAt: "2019-03-02T12:00:00Z", author: { login: "bob" } },
            { submittedAt: "2019-03-01T09:00:00Z", author: { login: "carol" } },
          ],
        },
      })
    );
    expect(row.firstReviewAt).toBe("2019-03-01T09:00:00Z");
    expect(row.reviewCount).toBe(2);
    expect(row.reviewers).toEqual(["bob", "carol"]);
  });

  it("deduplicates reviewers", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(4, {
        reviews: {
          totalCount: 3,
          nodes: [
            { submittedAt: "2019-03-02T00:00:00Z", author: { login: "bob" } },
            { submittedAt: "2019-03-02T01:00:00Z", author: { login: "bob" } },
          ],
        },
      })
    );
    expect(row.reviewers).toEqual(["bob"]);
  });

  it("flags bot authors", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(5, { author: { login: "dependabot[bot]", __typename: "Bot" } })
    );
    expect(row.isBot).toBe(true);
    expect(row.aiAuthorType).toBeUndefined();
  });

  it("detects AI authorship from the login", () => {
    for (const [login, expected] of [
      ["Copilot", "copilot"],
      ["copilot-swe-agent[bot]", "copilot"],
      ["claude[bot]", "claude"],
      ["codex-bot", "codex"],
    ] as const) {
      const row = toEventRow(
        "acme",
        "acme/api",
        node(6, { author: { login, __typename: "Bot" } })
      );
      expect(row.aiAuthorType).toBe(expected);
    }
  });

  it("survives a deleted author account", () => {
    const row = toEventRow("acme", "acme/api", node(7, { author: null }));
    expect(row.author).toBe("unknown");
  });
});

describe("runBackfill", () => {
  it("walks a repo to completion and records its PRs", async () => {
    queuePages([[node(1), node(2)], [node(3)]]);
    const result = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(result.pagesFetched).toBe(2);
    expect(result.eventsAppended).toBe(3);
    expect(result.reposCompleted).toBe(1);
    expect(result.allComplete).toBe(true);
    expect(loadEvents(dir, "acme")).toHaveLength(3);
  });

  it("stores a watermark so the next run resumes rather than restarting", async () => {
    mockFetch.mockResolvedValueOnce({
      nodes: [node(1)],
      hasNextPage: true,
      endCursor: "cursor-A",
      pageSize: 50,
    });
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));

    const state = loadBackfillState(dir, "acme");
    expect(state.repos["acme/api"].cursor).toBe("cursor-A");
    expect(state.repos["acme/api"].complete).toBe(false);
    expect(state.repos["acme/api"].prsSeen).toBe(1);

    // Second run must continue from the stored cursor.
    mockFetch.mockResolvedValueOnce({
      nodes: [node(2)],
      hasNextPage: false,
      endCursor: "cursor-B",
      pageSize: 50,
    });
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));
    expect(mockFetch).toHaveBeenLastCalledWith("acme", "api", "cursor-A", DEFAULT_SIZE_OPTIONS);
    expect(loadBackfillState(dir, "acme").repos["acme/api"].complete).toBe(true);
  });

  it("never re-fetches a repository once complete", async () => {
    queuePages([[node(1)]]);
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    mockFetch.mockClear();

    const second = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(second.reposAlreadyComplete).toBe(1);
    expect(second.allComplete).toBe(true);
  });

  it("respects the per-run page budget", async () => {
    mockFetch.mockResolvedValue({ nodes: [node(1)], hasNextPage: true, endCursor: "c", pageSize: 50 });
    const result = await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/api" }, { fullName: "acme/web" }],
      config({ pagesPerRun: 3, maxPagesPerRepo: 20 })
    );
    expect(result.pagesFetched).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("caps one repository so it cannot starve the others", async () => {
    mockFetch.mockResolvedValue({ nodes: [node(1)], hasNextPage: true, endCursor: "c", pageSize: 50 });
    await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/api" }, { fullName: "acme/web" }],
      config({ pagesPerRun: 10, maxPagesPerRepo: 2 })
    );
    const calls = mockFetch.mock.calls.map((c) => c[1]);
    expect(calls.filter((r) => r === "api")).toHaveLength(2);
    expect(calls.filter((r) => r === "web")).toHaveLength(2);
  });

  it("leaves the watermark untouched when a repo is inaccessible", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const result = await runBackfill(dir, "acme", [{ fullName: "acme/gone" }], config());
    expect(result.pagesFetched).toBe(0);
    expect(result.reposTouched).toBe(0);
    expect(loadBackfillState(dir, "acme").repos["acme/gone"].complete).toBe(false);
    expect(loadBackfillState(dir, "acme").repos["acme/gone"].cursor).toBeNull();
  });

  it("does not append the same pull request twice across runs", async () => {
    queuePages([[node(1), node(2)]]);
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    // Simulate a re-crawl of the same repo from scratch.
    fs.rmSync(path.join(dir, "acme", "backfill.json"));
    queuePages([[node(1), node(2), node(3)]]);
    const second = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(second.eventsAppended).toBe(1);
    expect(loadEvents(dir, "acme")).toHaveLength(3);
  });

  it("tracks the oldest pull request it has reached", async () => {
    queuePages([
      [node(1, { createdAt: "2018-01-05T00:00:00Z" }), node(2, { createdAt: "2020-06-01T00:00:00Z" })],
    ]);
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    const mark = loadBackfillState(dir, "acme").repos["acme/api"];
    expect(mark.oldestCreatedAt).toBe("2018-01-05T00:00:00Z");
    expect(mark.newestCreatedAt).toBe("2020-06-01T00:00:00Z");
  });

  it("skips a malformed repository name without throwing", async () => {
    const result = await runBackfill(dir, "acme", [{ fullName: "no-slash" }], config());
    expect(result.pagesFetched).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles an empty final page", async () => {
    queuePages([[node(1)], []]);
    const result = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    expect(result.allComplete).toBe(true);
    expect(loadEvents(dir, "acme")).toHaveLength(1);
  });
});

describe("runBackfill adaptive page sizing", () => {
  it("requests the configured page size and reports no reduction on a normal page", async () => {
    queuePages([[node(1)]]);
    const result = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    expect(mockFetch).toHaveBeenCalledWith("acme", "api", null, DEFAULT_SIZE_OPTIONS);
    expect(result.pageSizeReductions).toBe(0);
    expect(result.reposWithReducedPageSize).toEqual([]);
  });

  it("adopts a reduced page size returned by the collector and keeps using it for later pages", async () => {
    mockFetch
      .mockResolvedValueOnce({ nodes: [node(1)], hasNextPage: true, endCursor: "cursor-A", pageSize: 25 })
      .mockResolvedValueOnce({ nodes: [node(2)], hasNextPage: false, endCursor: "cursor-B", pageSize: 25 });

    const result = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(result.pageSizeReductions).toBe(1);
    expect(result.reposWithReducedPageSize).toEqual(["acme/api"]);
    // The first page requested the configured default (50); the second must
    // request the reduced size (25) rather than immediately going back to 50.
    expect(mockFetch).toHaveBeenNthCalledWith(1, "acme", "api", null, DEFAULT_SIZE_OPTIONS);
    expect(mockFetch).toHaveBeenNthCalledWith(2, "acme", "api", "cursor-A", {
      pageSize: 25,
      minPageSize: 10,
      adaptive: true,
    });
    expect(loadBackfillState(dir, "acme").repos["acme/api"].preferredPageSize).toBe(25);
  });

  it("persists the reduced page size as a hint and starts the next run there", async () => {
    mockFetch.mockResolvedValueOnce({
      nodes: [node(1)],
      hasNextPage: true,
      endCursor: "cursor-A",
      pageSize: 25,
    });
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));
    expect(loadBackfillState(dir, "acme").repos["acme/api"].preferredPageSize).toBe(25);

    mockFetch.mockResolvedValueOnce({
      nodes: [node(2)],
      hasNextPage: false,
      endCursor: "cursor-B",
      pageSize: 25,
    });
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));
    expect(mockFetch).toHaveBeenLastCalledWith("acme", "api", "cursor-A", {
      pageSize: 25,
      minPageSize: 10,
      adaptive: true,
    });
  });

  it("keeps each repository's page size independent — one reduction does not affect another repo", async () => {
    mockFetch
      .mockResolvedValueOnce({ nodes: [node(1)], hasNextPage: false, endCursor: "c1", pageSize: 25 })
      .mockResolvedValueOnce({ nodes: [node(2)], hasNextPage: false, endCursor: "c2", pageSize: 50 });

    await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/api" }, { fullName: "acme/web" }],
      config()
    );

    expect(mockFetch).toHaveBeenNthCalledWith(1, "acme", "api", null, DEFAULT_SIZE_OPTIONS);
    expect(mockFetch).toHaveBeenNthCalledWith(2, "acme", "web", null, DEFAULT_SIZE_OPTIONS);
    expect(loadBackfillState(dir, "acme").repos["acme/api"].preferredPageSize).toBe(25);
    expect(loadBackfillState(dir, "acme").repos["acme/web"].preferredPageSize).toBe(50);
  });

  it("ignores a stale preferredPageSize hint that no longer fits the current configuration", async () => {
    // A hint below the current minPageSize (config changed since it was recorded).
    const state = loadBackfillState(dir, "acme");
    state.repos["acme/api"] = {
      cursor: "cursor-A",
      complete: false,
      pagesFetched: 1,
      prsSeen: 1,
      updatedAt: new Date().toISOString(),
      preferredPageSize: 5,
    };
    saveBackfillState(dir, state);
    queuePages([[node(2)]]);

    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ minPageSize: 10 }));
    expect(mockFetch).toHaveBeenCalledWith("acme", "api", "cursor-A", DEFAULT_SIZE_OPTIONS);
  });

  it("falls back to a single request at the configured size when adaptivePageSize is disabled", async () => {
    queuePages([[node(1)]]);
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ adaptivePageSize: false }));
    expect(mockFetch).toHaveBeenCalledWith("acme", "api", null, {
      pageSize: 50,
      minPageSize: 10,
      adaptive: false,
    });
  });
});

describe("describeBackfill", () => {
  it("reports completion once every repository is crawled", () => {
    const line = describeBackfill(
      {
        reposTouched: 0,
        reposCompleted: 0,
        reposAlreadyComplete: 3,
        pagesFetched: 0,
        eventsAppended: 0,
        allComplete: true,
        pageSizeReductions: 0,
        reposWithReducedPageSize: [],
      },
      config()
    );
    expect(line).toContain("History complete");
  });

  it("reports progress and that it continues while work remains", () => {
    const line = describeBackfill(
      {
        reposTouched: 2,
        reposCompleted: 1,
        reposAlreadyComplete: 0,
        pagesFetched: 5,
        eventsAppended: 400,
        allComplete: false,
        pageSizeReductions: 0,
        reposWithReducedPageSize: [],
      },
      config({ pagesPerRun: 100 })
    );
    expect(line).toContain("5/100 pages");
    expect(line).toContain("400 PRs recorded");
    expect(line).toContain("Continues next run");
  });

  it("mentions page-size reductions when any occurred", () => {
    const line = describeBackfill(
      {
        reposTouched: 2,
        reposCompleted: 0,
        reposAlreadyComplete: 0,
        pagesFetched: 5,
        eventsAppended: 100,
        allComplete: false,
        pageSizeReductions: 2,
        reposWithReducedPageSize: ["acme/api"],
      },
      config()
    );
    expect(line).toContain("initial=50");
    expect(line).toContain("min=10");
    expect(line).toContain("2 reduction(s) across 1 repo(s)");
  });
});

describe("toEventRow review and revert facts", () => {
  it("records the first approval alongside the first review", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(1, {
        reviews: {
          totalCount: 3,
          nodes: [
            { submittedAt: "2019-03-02T12:00:00Z", author: { login: "bob" }, state: "APPROVED" },
            { submittedAt: "2019-03-02T06:00:00Z", author: { login: "amy" }, state: "CHANGES_REQUESTED" },
            { submittedAt: "2019-03-02T18:00:00Z", author: { login: "cat" }, state: "APPROVED" },
          ],
        },
      })
    );
    expect(row.firstReviewAt).toBe("2019-03-02T06:00:00Z");
    expect(row.firstApprovalAt).toBe("2019-03-02T12:00:00Z");
    expect(row.changesRequestedCount).toBe(1);
  });

  it("leaves the approval absent when nobody approved", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(1, {
        reviews: {
          totalCount: 1,
          nodes: [
            { submittedAt: "2019-03-02T06:00:00Z", author: { login: "amy" }, state: "COMMENTED" },
          ],
        },
      })
    );
    expect(row.firstApprovalAt).toBeUndefined();
    expect(row.changesRequestedCount).toBe(0);
  });

  it("omits the round count entirely when no review carried a state", () => {
    // Rows crawled before `state` was requested must stay absent rather than
    // claiming a confident zero.
    const row = toEventRow(
      "acme",
      "acme/api",
      node(1, {
        reviews: {
          totalCount: 1,
          nodes: [{ submittedAt: "2019-03-02T06:00:00Z", author: { login: "amy" } }],
        },
      })
    );
    expect(row.changesRequestedCount).toBeUndefined();
    expect(row.firstReviewAt).toBe("2019-03-02T06:00:00Z");
  });

  it("records the pull request a historical revert refers to", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(9, { body: "Reverts acme/api#4" })
    );
    expect(row.revertsPR).toBe(4);
  });

  it("leaves the revert reference off an ordinary pull request", () => {
    const row = toEventRow("acme", "acme/api", node(9, { body: "Fixes #4" }));
    expect(row.revertsPR).toBeUndefined();
  });

  it("still records an abandoned pull request with no reviews at all", () => {
    const row = toEventRow(
      "acme",
      "acme/api",
      node(3, { state: "CLOSED", mergedAt: null, closedAt: "2019-04-01T00:00:00Z" })
    );
    expect(row.state).toBe("closed");
    expect(row.firstApprovalAt).toBeUndefined();
    expect(row.changesRequestedCount).toBeUndefined();
  });
});
