import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as HistoryModule from "./history.js";

vi.mock("./collectors/repo-graphql.js", () => ({
  fetchHistoricalPRPage: vi.fn(),
}));

// Wrap the real `saveBackfillState` in a spy (everything else in the module
// stays real) so a few tests can assert *how often* the watermark is
// persisted during a run, not just its value at the end.
vi.mock("./history.js", async (importOriginal) => {
  const actual = await importOriginal<typeof HistoryModule>();
  return { ...actual, saveBackfillState: vi.fn(actual.saveBackfillState) };
});

import { fetchHistoricalPRPage } from "./collectors/repo-graphql.js";
import { runBackfill, toEventRow, describeBackfill } from "./backfill.js";
import { loadBackfillState, loadEvents, saveBackfillState, HISTORY_SCHEMA_VERSION } from "./history.js";
import type {
  HistoricalPRNode,
  HistoricalPRPage,
  HistoricalPageFailure,
  HistoricalPageOutcome,
} from "./collectors/repo-graphql.js";
import type { BackfillConfig } from "./config.js";

const mockFetch = vi.mocked(fetchHistoricalPRPage);
const saveStateSpy = vi.mocked(saveBackfillState);

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-backfill-"));
  mockFetch.mockReset();
  saveStateSpy.mockClear();
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
    ...patch,
  };
}

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

/** Wrap a page in the `{ ok: true }` shape `fetchHistoricalPRPage` resolves to. */
function ok(page: HistoricalPRPage): HistoricalPageOutcome {
  return { ok: true, page };
}

/** Wrap a classified, repository-local failure in the `{ ok: false }` shape. */
function fail(failure: Partial<HistoricalPageFailure> = {}): HistoricalPageOutcome {
  return {
    ok: false,
    failure: { kind: "transient", category: "GitHub GraphQL transient execution error", attempts: 4, ...failure },
  };
}

/** Queue `pages` responses; each entry is the nodes for one page. */
function queuePages(pages: HistoricalPRNode[][]) {
  pages.forEach((nodes, i) => {
    mockFetch.mockResolvedValueOnce(
      ok({
        nodes,
        hasNextPage: i < pages.length - 1,
        endCursor: `cursor-${i}`,
      })
    );
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
    mockFetch.mockResolvedValueOnce(
      ok({
        nodes: [node(1)],
        hasNextPage: true,
        endCursor: "cursor-A",
      })
    );
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));

    const state = loadBackfillState(dir, "acme");
    expect(state.repos["acme/api"].cursor).toBe("cursor-A");
    expect(state.repos["acme/api"].complete).toBe(false);
    expect(state.repos["acme/api"].prsSeen).toBe(1);

    // Second run must continue from the stored cursor.
    mockFetch.mockResolvedValueOnce(
      ok({
        nodes: [node(2)],
        hasNextPage: false,
        endCursor: "cursor-B",
      })
    );
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));
    expect(mockFetch).toHaveBeenLastCalledWith("acme", "api", "cursor-A");
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
    mockFetch.mockResolvedValue(ok({ nodes: [node(1)], hasNextPage: true, endCursor: "c" }));
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
    mockFetch.mockResolvedValue(ok({ nodes: [node(1)], hasNextPage: true, endCursor: "c" }));
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
    mockFetch.mockResolvedValueOnce(fail({ kind: "not-found", category: "repository not found", attempts: undefined }));
    const result = await runBackfill(dir, "acme", [{ fullName: "acme/gone" }], config());
    expect(result.pagesFetched).toBe(0);
    expect(result.reposTouched).toBe(0);
    expect(result.reposSkipped).toBe(1);
    expect(loadBackfillState(dir, "acme").repos["acme/gone"].complete).toBe(false);
    expect(loadBackfillState(dir, "acme").repos["acme/gone"].cursor).toBeNull();
  });

  it("isolates a repository that fails with a transient/generic error and still processes the next one", async () => {
    // fetchHistoricalPRPage itself retries transient/generic GraphQL errors
    // internally and only resolves { ok: false } once its own retries are
    // exhausted — simulate that exhaustion here for the failing repo.
    mockFetch.mockResolvedValueOnce(fail()); // acme/flaky exhausts its retries
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: false, endCursor: "cursor-1" })); // acme/ok succeeds

    const result = await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/flaky" }, { fullName: "acme/ok" }],
      config()
    );

    expect(result.allComplete).toBe(false);
    expect(result.reposDeferred).toBe(1);
    expect(result.reposCompleted).toBe(1);
    expect(loadBackfillState(dir, "acme").repos["acme/flaky"].complete).toBe(false);
    expect(loadBackfillState(dir, "acme").repos["acme/flaky"].cursor).toBeNull();
    expect(loadBackfillState(dir, "acme").repos["acme/ok"].complete).toBe(true);
    expect(loadEvents(dir, "acme")).toHaveLength(1);
  });

  it("still returns null immediately (repository skipped, not retried) for a repository-not-found / access-denied outcome", async () => {
    mockFetch.mockResolvedValueOnce(
      fail({ kind: "forbidden", category: "repository access denied (403)", attempts: undefined })
    );
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: false, endCursor: "cursor-1" }));

    const result = await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/private" }, { fullName: "acme/ok" }],
      config()
    );

    expect(result.reposSkipped).toBe(1);
    expect(result.reposCompleted).toBe(1);
    expect(loadBackfillState(dir, "acme").repos["acme/private"].complete).toBe(false);
    expect(loadBackfillState(dir, "acme").repos["acme/private"].cursor).toBeNull();
  });

  it("propagates an unexpected thrown error (global/programming failure) and still saves progress from earlier repositories", async () => {
    // acme/first succeeds and completes before acme/throws blows up, so its
    // durably-appended progress must survive even though the run as a whole
    // must fail (an unclassified exception is, by construction, not one of
    // fetchHistoricalPRPage's recognized repository-local outcomes).
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: false, endCursor: "cursor-1" }));
    mockFetch.mockRejectedValueOnce(new Error("boom: unexpected programming error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runBackfill(dir, "acme", [{ fullName: "acme/first" }, { fullName: "acme/throws" }], config())
    ).rejects.toThrow("boom: unexpected programming error");

    expect(loadBackfillState(dir, "acme").repos["acme/first"].complete).toBe(true);
    expect(loadEvents(dir, "acme")).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("acme/throws"));
    errorSpy.mockRestore();
  });

  it("keeps the cursor at the last successfully stored page when a later page in the same repo fails", async () => {
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: true, endCursor: "cursor-good" }));
    mockFetch.mockResolvedValueOnce(fail()); // second page exhausts its retries

    const result = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(result.reposDeferred).toBe(1);
    const mark = loadBackfillState(dir, "acme").repos["acme/api"];
    expect(mark.cursor).toBe("cursor-good");
    expect(mark.complete).toBe(false);
    expect(loadEvents(dir, "acme")).toHaveLength(1);

    // Next run must retry the failed page from the exact stored cursor.
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(2)], hasNextPage: false, endCursor: "cursor-final" }));
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    expect(mockFetch).toHaveBeenLastCalledWith("acme", "api", "cursor-good");
    expect(loadBackfillState(dir, "acme").repos["acme/api"].complete).toBe(true);
    expect(loadEvents(dir, "acme")).toHaveLength(2);
  });

  it("does not duplicate events when a page is refetched after a prior partial failure", async () => {
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: true, endCursor: "cursor-good" }));
    mockFetch.mockResolvedValueOnce(fail());
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    expect(loadEvents(dir, "acme")).toHaveLength(1);

    // Next run re-requests the same next page (simulating GitHub replaying
    // an overlapping page) and includes an event already recorded.
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1), node(2)], hasNextPage: false, endCursor: "cursor-final" }));
    const second = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(second.eventsAppended).toBe(1);
    expect(loadEvents(dir, "acme")).toHaveLength(2);
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

describe("runBackfill cross-run resumption", () => {
  // These tests deliberately never keep a reference to a prior invocation's
  // returned `BackfillResult` or in-memory state across `runBackfill()`
  // calls — each call reloads `backfill.json` from `dir` for itself, exactly
  // as a brand-new Node.js process/GitHub Actions run would.

  it("retries the initial page (null cursor) when it fails before any page ever succeeds", async () => {
    mockFetch.mockResolvedValueOnce(fail()); // first invocation: initial page exhausts retries
    const first = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(first.reposDeferred).toBe(1);
    const markAfterFirst = loadBackfillState(dir, "acme").repos["acme/api"];
    expect(markAfterFirst.cursor).toBeNull();
    expect(markAfterFirst.complete).toBe(false);
    expect(loadEvents(dir, "acme")).toHaveLength(0);

    // Second invocation (fresh process): the initial page is attempted again,
    // from null, and this time succeeds.
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: false, endCursor: "cursor-1" }));
    const second = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(mockFetch).toHaveBeenLastCalledWith("acme", "api", null);
    expect(second.reposCompleted).toBe(1);
    expect(loadEvents(dir, "acme")).toHaveLength(1);
  });

  it("resumes repository B from its saved cursor while repository C (already complete) is skipped, across two invocations", async () => {
    // Cap each repo to one page per run so the loop moves on to the next
    // target after a single fetch, matching this test's intent.
    const cfg = config({ maxPagesPerRepo: 1 });

    // First invocation: A makes progress, B is deferred, C completes.
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: true, endCursor: "cursor-a1" })); // A
    mockFetch.mockResolvedValueOnce(fail()); // B exhausts retries
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(2)], hasNextPage: false, endCursor: "cursor-c1" })); // C

    const first = await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/a" }, { fullName: "acme/b" }, { fullName: "acme/c" }],
      cfg
    );
    expect(first.reposDeferred).toBe(1);
    expect(first.reposCompleted).toBe(1);
    expect(loadBackfillState(dir, "acme").repos["acme/c"].complete).toBe(true);
    mockFetch.mockReset();

    // Second invocation, fresh process: A resumes from cursor-a1, B retries
    // from its saved (null) cursor, C is never touched again.
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(3)], hasNextPage: false, endCursor: "cursor-a2" })); // A
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(4)], hasNextPage: false, endCursor: "cursor-b1" })); // B

    const second = await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/a" }, { fullName: "acme/b" }, { fullName: "acme/c" }],
      cfg
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith("acme", "a", "cursor-a1");
    expect(mockFetch).toHaveBeenCalledWith("acme", "b", null);
    expect(second.reposAlreadyComplete).toBe(1); // acme/c
    expect(second.reposCompleted).toBe(2); // acme/a and acme/b both finish this run
    expect(loadBackfillState(dir, "acme").repos["acme/a"].complete).toBe(true);
    expect(loadBackfillState(dir, "acme").repos["acme/b"].complete).toBe(true);
  });

  it("loads an old-format backfill.json (no optional diagnostic fields) without migration errors and honors its cursor and completion", async () => {
    const oldFormatState = {
      v: HISTORY_SCHEMA_VERSION,
      scope: "acme",
      repos: {
        "acme/api": {
          cursor: "cursor-old",
          complete: false,
          pagesFetched: 2,
          prsSeen: 5,
          updatedAt: "2024-01-01T00:00:00Z",
          // Deliberately no deferredAt / lastErrorCategory / lastRequestId / consecutiveFailedRuns.
        },
        "acme/done": {
          cursor: "cursor-final",
          complete: true,
          pagesFetched: 1,
          prsSeen: 1,
          updatedAt: "2024-01-01T00:00:00Z",
        },
      },
    };
    fs.mkdirSync(path.join(dir, "acme"), { recursive: true });
    fs.writeFileSync(path.join(dir, "acme", "backfill.json"), JSON.stringify(oldFormatState));

    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(6)], hasNextPage: false, endCursor: "cursor-new" }));

    const result = await runBackfill(
      dir,
      "acme",
      [{ fullName: "acme/api" }, { fullName: "acme/done" }],
      config()
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("acme", "api", "cursor-old");
    expect(result.reposAlreadyComplete).toBe(1);
    expect(result.reposCompleted).toBe(1);
    const mark = loadBackfillState(dir, "acme").repos["acme/api"];
    expect(mark.deferredAt).toBeUndefined();
    expect(mark.lastErrorCategory).toBeUndefined();
    expect(mark.consecutiveFailedRuns).toBeUndefined();
  });

  it("persists the watermark after every successfully fetched page, not only once at the end of the run", async () => {
    queuePages([[node(1)], [node(2)], [node(3)]]);
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    // Three pages succeeded, so the watermark must have been written at
    // least three times during the run — never relying solely on a single
    // save after the whole organisation loop finishes.
    expect(saveStateSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("logs a concise recovery message once a previously deferred repository advances again, and clears its failure diagnostics", async () => {
    mockFetch.mockResolvedValueOnce(fail({ requestId: "REQ-1" })); // first invocation defers
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    const deferredMark = loadBackfillState(dir, "acme").repos["acme/api"];
    expect(deferredMark.consecutiveFailedRuns).toBe(1);
    expect(deferredMark.lastRequestId).toBe("REQ-1");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: false, endCursor: "cursor-1" }));
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("recovered"));
    const recoveredMark = loadBackfillState(dir, "acme").repos["acme/api"];
    expect(recoveredMark.consecutiveFailedRuns).toBeUndefined();
    expect(recoveredMark.lastRequestId).toBeUndefined();
    logSpy.mockRestore();
  });

  it("logs whether a repository is starting fresh or resuming from a saved cursor", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cfg = config({ maxPagesPerRepo: 1 });

    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(1)], hasNextPage: true, endCursor: "cursor-1" }));
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], cfg);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("acme/api starting fresh"));

    logSpy.mockClear();
    mockFetch.mockResolvedValueOnce(ok({ nodes: [node(2)], hasNextPage: false, endCursor: "cursor-2" }));
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], cfg);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("acme/api resuming from saved cursor"));
    // Cursors can be long and noisy — never printed in full.
    for (const call of logSpy.mock.calls) {
      expect(String(call[0])).not.toContain("cursor-1");
    }

    logSpy.mockRestore();
  });

  it("does not spend a page budget on repositories already marked complete, across invocations", async () => {
    queuePages([[node(1)]]);
    await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config());
    mockFetch.mockClear();

    const result = await runBackfill(dir, "acme", [{ fullName: "acme/api" }], config({ pagesPerRun: 1 }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.pagesFetched).toBe(0);
    expect(result.reposAlreadyComplete).toBe(1);
  });

});

describe("describeBackfill", () => {
  it("reports completion once every repository is crawled", () => {
    const line = describeBackfill(
      {
        reposTouched: 0,
        reposCompleted: 0,
        reposAlreadyComplete: 3,
        reposIncomplete: 0,
        reposDeferred: 0,
        reposSkipped: 0,
        reposStarted: 0,
        reposResumed: 0,
        pagesFetched: 0,
        eventsAppended: 0,
        duplicateEventsIgnored: 0,
        allComplete: true,
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
        reposIncomplete: 1,
        reposDeferred: 0,
        reposSkipped: 0,
        reposStarted: 1,
        reposResumed: 1,
        pagesFetched: 5,
        eventsAppended: 400,
        duplicateEventsIgnored: 0,
        allComplete: false,
      },
      config({ pagesPerRun: 100 })
    );
    expect(line).toContain("5/100 pages");
    expect(line).toContain("400 events appended");
    expect(line).toContain("1 started");
    expect(line).toContain("1 resumed");
    expect(line).toContain("1 repositories completed");
    expect(line).toContain("1 incomplete");
    expect(line).toContain("Continues next run");
  });

  it("mentions deferred and skipped repositories when retries were exhausted or access was denied this run", () => {
    const line = describeBackfill(
      {
        reposTouched: 1,
        reposCompleted: 0,
        reposAlreadyComplete: 0,
        reposIncomplete: 0,
        reposDeferred: 2,
        reposSkipped: 1,
        reposStarted: 1,
        reposResumed: 0,
        pagesFetched: 3,
        eventsAppended: 10,
        duplicateEventsIgnored: 0,
        allComplete: false,
      },
      config({ pagesPerRun: 100 })
    );
    expect(line).toContain("2 deferred");
    expect(line).toContain("1 skipped");
  });

  it("mentions duplicate events ignored when a resumed page was refetched", () => {
    const line = describeBackfill(
      {
        reposTouched: 1,
        reposCompleted: 1,
        reposAlreadyComplete: 0,
        reposIncomplete: 0,
        reposDeferred: 0,
        reposSkipped: 0,
        reposStarted: 0,
        reposResumed: 1,
        pagesFetched: 1,
        eventsAppended: 0,
        duplicateEventsIgnored: 2,
        allComplete: false,
      },
      config({ pagesPerRun: 100 })
    );
    expect(line).toContain("2 duplicate events ignored");
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
