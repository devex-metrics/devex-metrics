import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("./collectors/workflow-runs.js", () => ({
  fetchWorkflowRunPage: vi.fn(),
}));

import { fetchWorkflowRunPage } from "./collectors/workflow-runs.js";
import type { WorkflowRunFacts } from "./collectors/workflow-runs.js";
import {
  runCiCrawl,
  toCiRunRow,
  appendCiRuns,
  loadCiRuns,
  loadCiState,
  saveCiState,
  rearmCompleted,
  toCiSamples,
  summariseCiHealth,
  describeCiCrawl,
  ciStatePath,
} from "./ci-health.js";
import type { CiRunRow, CiState } from "./ci-health.js";
import type { CiHealthConfig } from "./config.js";

const mockFetch = vi.mocked(fetchWorkflowRunPage);

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-ci-"));
  mockFetch.mockReset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function config(patch: Partial<CiHealthConfig> = {}): CiHealthConfig {
  return { pagesPerRun: 10, maxPagesPerRepo: 3, windowDays: 90, ...patch };
}

function run(overrides: Partial<WorkflowRunFacts> = {}): WorkflowRunFacts {
  return {
    id: 1,
    attempt: 1,
    workflow: "CI",
    branch: "main",
    headSha: "abc",
    event: "push",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-01T10:00:00Z",
    startedAt: "2026-08-01T10:01:00Z",
    updatedAt: "2026-08-01T10:06:00Z",
    ...overrides,
  };
}

/** Queue `pages` responses; each entry is the runs for one page. */
function queuePages(pages: WorkflowRunFacts[][]) {
  pages.forEach((runs, i) => {
    mockFetch.mockResolvedValueOnce({ runs, hasMore: i < pages.length - 1 });
  });
}

const target = { fullName: "acme/api", defaultBranch: "main" };

describe("toCiRunRow", () => {
  it("keeps the raw facts, not a computed verdict", () => {
    const row = toCiRunRow("acme", "acme/api", run({ id: 7, attempt: 2 }));
    expect(row).toMatchObject({
      scope: "acme",
      repo: "acme/api",
      runId: 7,
      attempt: 2,
      workflow: "CI",
      branch: "main",
      conclusion: "success",
      createdAt: "2026-08-01T10:00:00Z",
      startedAt: "2026-08-01T10:01:00Z",
      completedAt: "2026-08-01T10:06:00Z",
    });
  });

  it("leaves completedAt off a run that is still going", () => {
    const row = toCiRunRow(
      "acme",
      "acme/api",
      run({ status: "in_progress", conclusion: null })
    );
    expect(row.completedAt).toBeUndefined();
    expect(row.conclusion).toBeUndefined();
  });

  it("leaves startedAt off a run that never reached a runner", () => {
    const row = toCiRunRow("acme", "acme/api", run({ startedAt: undefined }));
    expect(row.startedAt).toBeUndefined();
  });
});

describe("appendCiRuns", () => {
  function row(runId: number, attempt = 1): CiRunRow {
    return toCiRunRow("acme", "acme/api", run({ id: runId, attempt }));
  }

  it("appends new rows and reports what it wrote", () => {
    expect(appendCiRuns(dir, "acme", [row(1), row(2)])).toEqual({
      appended: 2,
      alreadyPresent: 0,
    });
    expect(loadCiRuns(dir, "acme")).toHaveLength(2);
  });

  it("never writes the same run attempt twice", () => {
    appendCiRuns(dir, "acme", [row(1)]);
    const second = appendCiRuns(dir, "acme", [row(1), row(2)]);
    expect(second.appended).toBe(1);
    expect(loadCiRuns(dir, "acme")).toHaveLength(2);
  });

  it("treats a re-run attempt as its own row", () => {
    appendCiRuns(dir, "acme", [row(1, 1)]);
    expect(appendCiRuns(dir, "acme", [row(1, 2)]).appended).toBe(1);
  });

  it("de-duplicates within a single batch", () => {
    expect(appendCiRuns(dir, "acme", [row(1), row(1)]).appended).toBe(1);
  });

  it("writes nothing for an empty batch", () => {
    expect(appendCiRuns(dir, "acme", []).appended).toBe(0);
    expect(loadCiRuns(dir, "acme")).toEqual([]);
  });
});

describe("loadCiState", () => {
  it("returns an empty state when no file exists", () => {
    expect(loadCiState(dir, "acme")).toEqual({ v: 1, scope: "acme", repos: {} });
  });

  it("round-trips a saved state", () => {
    const state: CiState = {
      v: 1,
      scope: "acme",
      repos: {
        "acme/api": {
          anchor: "2026-08-30",
          page: 3,
          complete: false,
          runsSeen: 200,
          updatedAt: "2026-08-30T00:00:00Z",
        },
      },
    };
    saveCiState(dir, state);
    expect(loadCiState(dir, "acme")).toEqual(state);
  });

  it("starts over on an unreadable watermark file rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = ciStatePath(dir, "acme");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    expect(loadCiState(dir, "acme").repos).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("discards a state written by an incompatible schema", () => {
    const file = ciStatePath(dir, "acme");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ v: 99, scope: "acme", repos: { x: {} } }));
    expect(loadCiState(dir, "acme").repos).toEqual({});
  });
});

describe("runCiCrawl", () => {
  it("walks a repository to completion and records its runs", async () => {
    queuePages([[run({ id: 1 }), run({ id: 2 })]]);
    const result = await runCiCrawl(dir, "acme", [target], config(), "2026-08-30");
    expect(result.pagesFetched).toBe(1);
    expect(result.rowsAppended).toBe(2);
    expect(result.reposCompleted).toBe(1);
    expect(result.allComplete).toBe(true);
    expect(loadCiRuns(dir, "acme")).toHaveLength(2);
  });

  it("stops at the per-repo page cap and resumes there next run", async () => {
    queuePages([[run({ id: 1 })], [run({ id: 2 })], [run({ id: 3 })], [run({ id: 4 })]]);
    const result = await runCiCrawl(
      dir,
      "acme",
      [target],
      config({ maxPagesPerRepo: 2 }),
      "2026-08-30"
    );
    expect(result.pagesFetched).toBe(2);
    expect(result.allComplete).toBe(false);
    const mark = loadCiState(dir, "acme").repos["acme/api"];
    expect(mark.page).toBe(3);
    expect(mark.complete).toBe(false);
    expect(mark.anchor).toBe("2026-08-30");
  });

  it("keeps the anchor date across runs so pagination stays stable", async () => {
    queuePages([[run({ id: 1 })], [run({ id: 2 })]]);
    await runCiCrawl(dir, "acme", [target], config({ maxPagesPerRepo: 1 }), "2026-08-30");
    mockFetch.mockReset();
    queuePages([[run({ id: 2 })]]);
    await runCiCrawl(dir, "acme", [target], config({ maxPagesPerRepo: 1 }), "2026-09-05");
    expect(mockFetch).toHaveBeenCalledWith("acme", "api", "main", "2026-08-30", 2);
  });

  it("spreads a shared budget rather than letting one repo take it all", async () => {
    queuePages([
      [run({ id: 1 })],
      [run({ id: 2 })],
      [run({ id: 3 })],
      [run({ id: 4 })],
    ]);
    const result = await runCiCrawl(
      dir,
      "acme",
      [target, { fullName: "acme/web", defaultBranch: "main" }],
      config({ pagesPerRun: 3, maxPagesPerRepo: 2 }),
      "2026-08-30"
    );
    expect(result.pagesFetched).toBe(3);
    expect(loadCiState(dir, "acme").repos["acme/web"].page).toBe(2);
  });

  it("never spends a page on a repository already caught up", async () => {
    queuePages([[run({ id: 1 })]]);
    await runCiCrawl(dir, "acme", [target], config(), "2026-08-30");
    mockFetch.mockReset();
    const result = await runCiCrawl(dir, "acme", [target], config(), "2026-08-30");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.reposAlreadyComplete).toBe(1);
    expect(result.pagesFetched).toBe(0);
  });

  it("skips a repository whose default branch is unknown", async () => {
    const result = await runCiCrawl(
      dir,
      "acme",
      [{ fullName: "acme/api" }],
      config(),
      "2026-08-30"
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.reposSkipped).toBe(1);
    // A repository nobody could crawl must not hold the whole scope open.
    expect(result.allComplete).toBe(true);
  });

  it("leaves the watermark untouched when a page cannot be fetched", async () => {
    mockFetch.mockResolvedValueOnce(null);
    const result = await runCiCrawl(dir, "acme", [target], config(), "2026-08-30");
    expect(result.pagesFetched).toBe(0);
    expect(result.reposTouched).toBe(0);
    expect(loadCiState(dir, "acme").repos["acme/api"].page).toBe(1);
  });

  it("warns and moves on for a malformed repository name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runCiCrawl(
      dir,
      "acme",
      [{ fullName: "nope", defaultBranch: "main" }],
      config(),
      "2026-08-30"
    );
    expect(result.pagesFetched).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nope"));
    warn.mockRestore();
  });

  it("records the oldest and newest run it has seen", async () => {
    queuePages([
      [
        run({ id: 1, createdAt: "2026-01-01T00:00:00Z" }),
        run({ id: 2, createdAt: "2026-08-01T00:00:00Z" }),
      ],
    ]);
    await runCiCrawl(dir, "acme", [target], config(), "2026-08-30");
    const mark = loadCiState(dir, "acme").repos["acme/api"];
    expect(mark.oldestCreatedAt).toBe("2026-01-01T00:00:00Z");
    expect(mark.newestCreatedAt).toBe("2026-08-01T00:00:00Z");
    expect(mark.runsSeen).toBe(2);
  });
});

describe("rearmCompleted", () => {
  const mark = {
    anchor: "2026-08-30",
    page: 4,
    complete: true,
    runsSeen: 300,
    updatedAt: "2026-08-30T00:00:00Z",
  };

  it("re-opens a completed repository against a fresh anchor", () => {
    const next = rearmCompleted(
      { v: 1, scope: "acme", repos: { "acme/api": mark } },
      "2026-09-01"
    );
    expect(next.repos["acme/api"]).toMatchObject({
      anchor: "2026-09-01",
      page: 1,
      complete: false,
      runsSeen: 300,
    });
  });

  it("leaves a repository completed earlier today alone", () => {
    const next = rearmCompleted(
      { v: 1, scope: "acme", repos: { "acme/api": mark } },
      "2026-08-30"
    );
    expect(next.repos["acme/api"].complete).toBe(true);
  });

  it("leaves an unfinished crawl mid-flight", () => {
    const inFlight = { ...mark, complete: false };
    const next = rearmCompleted(
      { v: 1, scope: "acme", repos: { "acme/api": inFlight } },
      "2026-09-01"
    );
    expect(next.repos["acme/api"]).toEqual(inFlight);
  });
});

describe("toCiSamples", () => {
  function row(extra: Partial<CiRunRow>): CiRunRow {
    return {
      v: 1,
      scope: "acme",
      repo: "acme/api",
      runId: 1,
      attempt: 1,
      workflow: "CI",
      branch: "main",
      headSha: "abc",
      event: "push",
      conclusion: "success",
      createdAt: "2026-08-01T10:00:00Z",
      startedAt: "2026-08-01T10:01:00Z",
      completedAt: "2026-08-01T10:06:00Z",
      ...extra,
    };
  }

  it("derives duration and queue time in minutes", () => {
    const [sample] = toCiSamples([row({})]);
    expect(sample).toMatchObject({
      repo: "api",
      success: true,
      flaky: false,
      durationMinutes: 5,
      queueMinutes: 1,
    });
  });

  it("drops a run that never finished", () => {
    expect(toCiSamples([row({ completedAt: undefined, conclusion: undefined })])).toEqual(
      []
    );
  });

  it("drops cancelled and skipped runs — a human changing their mind is not a failure", () => {
    expect(toCiSamples([row({ conclusion: "cancelled" })])).toEqual([]);
    expect(toCiSamples([row({ runId: 2, conclusion: "skipped" })])).toEqual([]);
  });

  it("keeps only the last attempt of a re-run", () => {
    const samples = toCiSamples([
      row({ attempt: 1, conclusion: "failure" }),
      row({ attempt: 2, conclusion: "success" }),
    ]);
    expect(samples).toHaveLength(1);
    expect(samples[0].success).toBe(true);
  });

  it("marks a run flaky when it only passed on a re-run of the same commit", () => {
    const samples = toCiSamples([
      row({ attempt: 1, conclusion: "failure" }),
      row({ attempt: 2, conclusion: "success" }),
    ]);
    expect(samples[0].flaky).toBe(true);
  });

  it("does not call a re-run flaky when it failed again", () => {
    const samples = toCiSamples([
      row({ attempt: 1, conclusion: "failure" }),
      row({ attempt: 2, conclusion: "failure" }),
    ]);
    expect(samples[0].flaky).toBe(false);
    expect(samples[0].success).toBe(false);
  });

  it("does not call a first-attempt pass flaky", () => {
    expect(toCiSamples([row({})])[0].flaky).toBe(false);
  });

  it("leaves the queue time absent when the run never reported a start", () => {
    const [sample] = toCiSamples([row({ startedAt: undefined })]);
    expect(sample.queueMinutes).toBeUndefined();
    // Duration then falls back to the creation time, still an upper bound.
    expect(sample.durationMinutes).toBe(6);
  });

  it("returns an empty list for no rows", () => {
    expect(toCiSamples([])).toEqual([]);
  });

  it("sorts oldest finish first", () => {
    const samples = toCiSamples([
      row({ runId: 2, completedAt: "2026-08-05T00:00:00Z" }),
      row({ runId: 1, completedAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect(samples.map((s) => s.finishedAt)).toEqual([
      "2026-08-01T00:00:00Z",
      "2026-08-05T00:00:00Z",
    ]);
  });
});

describe("summariseCiHealth", () => {
  function sample(extra: Record<string, unknown> = {}) {
    return {
      repo: "api",
      workflow: "CI",
      finishedAt: "2026-08-01T10:06:00Z",
      success: true,
      flaky: false,
      durationMinutes: 5,
      queueMinutes: 1,
      ...extra,
    };
  }

  it("reports nothing rather than zeroes for an empty input", () => {
    const summary = summariseCiHealth([]);
    expect(summary.runs).toBe(0);
    expect(summary.successRate).toBeUndefined();
    expect(summary.durationP50).toBeUndefined();
    expect(summary.queueP50).toBeUndefined();
    expect(summary.flakyRate).toBeUndefined();
  });

  it("computes the success and flaky rates", () => {
    const summary = summariseCiHealth([
      sample(),
      sample({ success: false }),
      sample({ flaky: true }),
      sample(),
    ]);
    expect(summary.runs).toBe(4);
    expect(summary.successes).toBe(3);
    expect(summary.successRate).toBe(75);
    expect(summary.flakyRuns).toBe(1);
    expect(summary.flakyRate).toBe(25);
  });

  it("reports duration and queue as order statistics with their sample sizes", () => {
    const summary = summariseCiHealth([
      sample({ durationMinutes: 1, queueMinutes: 1 }),
      sample({ durationMinutes: 5, queueMinutes: 2 }),
      sample({ durationMinutes: 100, queueMinutes: 3 }),
    ]);
    expect(summary.durationP50).toBe(5);
    expect(summary.durationN).toBe(3);
    expect(summary.queueP90).toBeGreaterThan(2);
    expect(summary.queueN).toBe(3);
  });

  it("counts a run with no timing towards the rate but not the quantiles", () => {
    const summary = summariseCiHealth([
      sample({ durationMinutes: undefined, queueMinutes: undefined }),
      sample({ durationMinutes: 4, queueMinutes: 2 }),
    ]);
    expect(summary.runs).toBe(2);
    expect(summary.durationN).toBe(1);
    expect(summary.queueN).toBe(1);
  });
});

describe("describeCiCrawl", () => {
  const base = {
    reposTouched: 0,
    reposCompleted: 0,
    reposAlreadyComplete: 0,
    reposSkipped: 0,
    pagesFetched: 0,
    rowsAppended: 0,
    allComplete: false,
  };

  it("says nothing was needed when everything is caught up", () => {
    const text = describeCiCrawl({ ...base, allComplete: true }, config());
    expect(text).toContain("up to date");
  });

  it("reports the budget spent and what it bought", () => {
    const text = describeCiCrawl(
      { ...base, pagesFetched: 4, rowsAppended: 380, reposCompleted: 1 },
      config({ pagesPerRun: 10 })
    );
    expect(text).toContain("4/10 pages");
    expect(text).toContain("380 run(s) recorded");
  });

  it("names repositories it could not crawl", () => {
    const text = describeCiCrawl({ ...base, reposSkipped: 2, pagesFetched: 1 }, config());
    expect(text).toContain("2 repo(s) skipped");
  });
});
