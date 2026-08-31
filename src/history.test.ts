import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendRun,
  buildEventRows,
  buildRollupRows,
  compactRollup,
  loadEvents,
  loadLatest,
  loadRollup,
  readNdjson,
  rollupPath,
  HISTORY_SCHEMA_VERSION,
} from "./history.js";
import type { RollupRow } from "./history.js";
import type { MergedPRSummary, OrgMetrics, RepoMetrics } from "./types.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-history-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

function pr(number: number, daysAgo: number, extra: Partial<MergedPRSummary> = {}): MergedPRSummary {
  const mergedAt = new Date(Date.parse("2026-08-30T00:00:00Z") - daysAgo * DAY).toISOString();
  return {
    number,
    createdAt: new Date(Date.parse(mergedAt) - 2 * DAY).toISOString(),
    mergedAt,
    author: "alice",
    isBotAuthor: false,
    isCopilotAuthored: false,
    timeToMergeHours: 48,
    closesIssues: [],
    linesAdded: 10,
    linesDeleted: 5,
    ...extra,
  };
}

function repo(fullName: string, prs: MergedPRSummary[], extra: Partial<RepoMetrics> = {}): RepoMetrics {
  return {
    name: fullName.slice(fullName.indexOf("/") + 1),
    fullName,
    issues: { open: 2, closed: 3 },
    pullRequests: { open: 1, closed: 2, merged: prs.length },
    pullRequestDetails: [],
    mergedPRTimeline: prs,
    committerCount: 4,
    reviewerCount: 2,
    contributorCount: 5,
    dependentCount: 0,
    ...extra,
  };
}

function metrics(repos: RepoMetrics[]): OrgMetrics {
  return {
    owner: "acme",
    ownerType: "org",
    collectedAt: "2026-08-30T06:00:00.000Z",
    repoCount: repos.length,
    repos,
  };
}

describe("buildRollupRows", () => {
  it("emits one row per repo plus an org row", () => {
    const rows = buildRollupRows(metrics([repo("acme/api", [pr(1, 5)]), repo("acme/web", [])]), "2026-08-30");
    expect(rows.map((r) => r.repo)).toEqual(["acme/api", "acme/web", "*"]);
    expect(rows.every((r) => r.v === HISTORY_SCHEMA_VERSION)).toBe(true);
    expect(rows.every((r) => r.scope === "acme")).toBe(true);
  });

  it("counts only PRs merged in the last 30 days in the windowed fields", () => {
    const rows = buildRollupRows(
      metrics([repo("acme/api", [pr(1, 5), pr(2, 200)])]),
      "2026-08-30"
    );
    expect(rows[0].mergedPRs30d).toBe(1);
    // The all-time count is unaffected by the window.
    expect(rows[0].mergedPRs).toBe(2);
  });

  it("records cycle-time quantiles for the window", () => {
    const prs = [
      pr(1, 1, { timeToMergeHours: 10 }),
      pr(2, 2, { timeToMergeHours: 20 }),
      pr(3, 3, { timeToMergeHours: 90 }),
    ];
    const rows = buildRollupRows(metrics([repo("acme/api", prs)]), "2026-08-30");
    expect(rows[0].cycleP50).toBe(20);
    expect(rows[0].cycleP90).toBeGreaterThan(rows[0].cycleP50);
  });

  it("separates AI-authored from human PRs", () => {
    const prs = [
      pr(1, 1, { isCopilotAuthored: true, aiAuthorType: "copilot" }),
      pr(2, 2),
      pr(3, 3, { isBotAuthor: true }),
    ];
    const rows = buildRollupRows(metrics([repo("acme/api", prs)]), "2026-08-30");
    expect(rows[0].aiPRs30d).toBe(1);
    expect(rows[0].humanPRs30d).toBe(1);
  });

  it("carries the team flag through", () => {
    const rows = buildRollupRows(
      metrics([repo("acme/api", [], { isTeamRepo: true }), repo("acme/web", [])]),
      "2026-08-30"
    );
    expect(rows[0].isTeamRepo).toBe(true);
    expect(rows[1].isTeamRepo).toBe(false);
  });

  it("counts a zero-cycle-time merge in the org row, matching the repo rows", () => {
    // Auto-merged bot PRs land within the rounding floor, so timeToMergeHours
    // is 0. Those were previously dropped from the org count but kept in the
    // per-repo counts, so the two rows disagreed.
    const rows = buildRollupRows(
      metrics([
        repo("acme/api", [
          pr(1, 1, { timeToMergeHours: 0 }),
          pr(2, 2, { timeToMergeHours: 12 }),
        ]),
      ]),
      "2026-08-30"
    );
    const repoRow = rows.find((r) => r.repo === "acme/api")!;
    const orgRow = rows.find((r) => r.repo === "*")!;
    expect(repoRow.mergedPRs30d).toBe(2);
    expect(orgRow.mergedPRs30d).toBe(2);
  });

  it("sums repo counts into the org row", () => {
    const rows = buildRollupRows(
      metrics([repo("acme/api", [pr(1, 1)]), repo("acme/web", [pr(2, 1)])]),
      "2026-08-30"
    );
    const org = rows[rows.length - 1];
    expect(org.repo).toBe("*");
    expect(org.committers).toBe(8);
    expect(org.openIssues).toBe(4);
  });

  it("falls back to pullRequestDetails when no timeline is present", () => {
    const r: RepoMetrics = {
      ...repo("acme/api", []),
      mergedPRTimeline: undefined,
      pullRequestDetails: [
        {
          number: 9,
          title: "t",
          state: "closed",
          createdAt: "2026-08-20T00:00:00Z",
          author: "alice",
          isCopilotAuthored: false,
          hasCopilotReview: false,
          linesAdded: 3,
          linesDeleted: 1,
          commentCount: 0,
          commitCount: 1,
          actionsMinutes: 0,
          timeToMergeHours: 12,
          mergedAt: "2026-08-25T00:00:00Z",
        },
      ],
    };
    const rows = buildRollupRows(metrics([r]), "2026-08-30");
    expect(rows[0].mergedPRs30d).toBe(1);
    expect(rows[0].cycleP50).toBe(12);
  });

  it("clamps negative issue counts to zero", () => {
    const r = repo("acme/api", []);
    r.issues = { open: -1, closed: -5 };
    const rows = buildRollupRows(metrics([r]), "2026-08-30");
    expect(rows[0].openIssues).toBe(0);
    expect(rows[0].closedIssues).toBe(0);
  });
});

describe("buildEventRows", () => {
  it("emits one row per merged PR", () => {
    const rows = buildEventRows(metrics([repo("acme/api", [pr(1, 1), pr(2, 2)])]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ scope: "acme", repo: "acme/api", number: 1 });
  });

  it("preserves the AI author type", () => {
    const rows = buildEventRows(
      metrics([repo("acme/api", [pr(1, 1, { aiAuthorType: "claude", isCopilotAuthored: true })])])
    );
    expect(rows[0].aiAuthorType).toBe("claude");
  });
});

describe("appendRun", () => {
  it("writes rollup, events and latest on a first run", () => {
    const m = metrics([repo("acme/api", [pr(1, 1)])]);
    const result = appendRun(dir, m);
    expect(result.rollupRowsWritten).toBe(2); // repo + org
    expect(result.eventsAppended).toBe(1);
    expect(loadRollup(dir, "acme")).toHaveLength(2);
    expect(loadEvents(dir, "acme")).toHaveLength(1);
    expect(loadLatest(dir, "acme")?.owner).toBe("acme");
  });

  it("is idempotent within a day rather than duplicating rows", () => {
    const m = metrics([repo("acme/api", [pr(1, 1)])]);
    appendRun(dir, m);
    const second = appendRun(dir, m);
    expect(second.rollupRowsReplaced).toBe(2);
    expect(loadRollup(dir, "acme")).toHaveLength(2);
    expect(loadEvents(dir, "acme")).toHaveLength(1);
    expect(second.eventsAppended).toBe(0);
  });

  it("keeps earlier days when a new day is appended", () => {
    const m = metrics([repo("acme/api", [pr(1, 1)])]);
    appendRun(dir, m, "2026-08-29");
    appendRun(dir, m, "2026-08-30");
    const rows = loadRollup(dir, "acme");
    expect(rows).toHaveLength(4);
    expect([...new Set(rows.map((r) => r.date))]).toEqual(["2026-08-29", "2026-08-30"]);
  });

  it("appends only pull requests it has not seen before", () => {
    appendRun(dir, metrics([repo("acme/api", [pr(1, 1)])]), "2026-08-29");
    const second = appendRun(dir, metrics([repo("acme/api", [pr(1, 1), pr(2, 0)])]), "2026-08-30");
    expect(second.eventsAppended).toBe(1);
    expect(loadEvents(dir, "acme").map((e) => e.number)).toEqual([1, 2]);
  });

  it("keeps rollup rows sorted by date", () => {
    const m = metrics([repo("acme/api", [pr(1, 1)])]);
    appendRun(dir, m, "2026-08-30");
    appendRun(dir, m, "2026-08-29");
    const dates = loadRollup(dir, "acme").map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("writes one scope directory per owner", () => {
    appendRun(dir, metrics([repo("acme/api", [])]));
    appendRun(dir, { ...metrics([repo("other/api", [])]), owner: "other" });
    expect(fs.existsSync(path.join(dir, "acme", "rollup.ndjson"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "other", "rollup.ndjson"))).toBe(true);
  });

  it("defaults the date to the collection timestamp", () => {
    appendRun(dir, metrics([repo("acme/api", [])]));
    expect(loadRollup(dir, "acme")[0].date).toBe("2026-08-30");
  });
});

describe("readNdjson", () => {
  it("returns an empty array for a missing file", () => {
    expect(readNdjson(path.join(dir, "nope.ndjson"))).toEqual([]);
  });

  it("skips a truncated trailing line left by an interrupted run", () => {
    const file = rollupPath(dir, "acme");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"date":"2026-08-30"}\n{"date":"trunc');
    expect(readNdjson(file)).toEqual([{ date: "2026-08-30" }]);
  });
});

describe("compactRollup", () => {
  const now = Date.parse("2026-08-30T00:00:00Z");

  function row(date: string, repoName = "acme/api"): RollupRow {
    return { ...buildRollupRows(metrics([repo(repoName, [])]), date)[0] };
  }

  it("keeps every row inside the daily window", () => {
    const rows = [row("2026-08-28"), row("2026-08-29"), row("2026-08-30")];
    expect(compactRollup(rows, 90, now)).toHaveLength(3);
  });

  it("collapses older rows to one per repo per ISO week", () => {
    // Three consecutive days well outside the 90-day window, same ISO week.
    const rows = [row("2026-01-05"), row("2026-01-06"), row("2026-01-07")];
    const compacted = compactRollup(rows, 90, now);
    expect(compacted).toHaveLength(1);
    expect(compacted[0].date).toBe("2026-01-07");
  });

  it("keeps separate repos separate when compacting", () => {
    const rows = [row("2026-01-05", "acme/api"), row("2026-01-06", "acme/web")];
    expect(compactRollup(rows, 90, now)).toHaveLength(2);
  });

  it("returns rows sorted by date", () => {
    const rows = [row("2026-08-30"), row("2026-01-05"), row("2026-08-29")];
    const dates = compactRollup(rows, 90, now).map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

// ── Backfill watermarks and rollup recomputation ─────────────────────────────

import {
  appendEventRows,
  loadBackfillState,
  saveBackfillState,
  recomputeRollupFromEvents,
  mergeReconstructed,
  backfillPath,
  isMergedEvent,
  deriveRollupExtras,
  LARGE_PR_LINES,
} from "./history.js";
import type { EventRow } from "./history.js";

function event(number: number, mergedAt: string, extra: Partial<EventRow> = {}): EventRow {
  return {
    v: 1,
    scope: "acme",
    repo: "acme/api",
    number,
    state: "merged",
    author: "alice",
    isBot: false,
    createdAt: new Date(Date.parse(mergedAt) - 2 * DAY).toISOString(),
    mergedAt,
    timeToMergeHours: 48,
    linesAdded: 10,
    linesDeleted: 5,
    ...extra,
  };
}

describe("backfill watermarks", () => {
  it("returns an empty state when no file exists", () => {
    expect(loadBackfillState(dir, "acme")).toEqual({ v: 1, scope: "acme", repos: {} });
  });

  it("round-trips a saved state", () => {
    saveBackfillState(dir, {
      v: 1,
      scope: "acme",
      repos: {
        "acme/api": {
          cursor: "abc",
          complete: false,
          pagesFetched: 3,
          prsSeen: 300,
          updatedAt: "2026-08-30T00:00:00Z",
        },
      },
    });
    expect(loadBackfillState(dir, "acme").repos["acme/api"].cursor).toBe("abc");
  });

  it("starts over rather than throwing on a corrupt file", () => {
    const file = backfillPath(dir, "acme");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(loadBackfillState(dir, "acme").repos).toEqual({});
  });

  it("discards a state written by an incompatible schema version", () => {
    const file = backfillPath(dir, "acme");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ v: 999, scope: "acme", repos: { x: {} } }));
    expect(loadBackfillState(dir, "acme").repos).toEqual({});
  });
});

describe("appendEventRows", () => {
  it("appends new rows and reports how many were already present", () => {
    expect(appendEventRows(dir, "acme", [event(1, "2026-08-20T00:00:00Z")])).toEqual({
      appended: 1,
      alreadyPresent: 0,
    });
    const second = appendEventRows(dir, "acme", [
      event(1, "2026-08-20T00:00:00Z"),
      event(2, "2026-08-21T00:00:00Z"),
    ]);
    expect(second.appended).toBe(1);
    expect(second.alreadyPresent).toBe(1);
  });

  it("deduplicates within a single batch", () => {
    const result = appendEventRows(dir, "acme", [
      event(1, "2026-08-20T00:00:00Z"),
      event(1, "2026-08-20T00:00:00Z"),
    ]);
    expect(result.appended).toBe(1);
  });

  it("keeps the first row for a pull request, not the last", () => {
    appendEventRows(dir, "acme", [
      event(1, "2026-08-20T00:00:00Z", { aiAuthorType: "copilot" }),
    ]);
    appendEventRows(dir, "acme", [event(1, "2026-08-20T00:00:00Z")]);
    const stored = loadEvents(dir, "acme");
    expect(stored).toHaveLength(1);
    expect(stored[0].aiAuthorType).toBe("copilot");
  });
});

describe("recomputeRollupFromEvents", () => {
  const now = Date.parse("2026-08-30T00:00:00Z");

  it("returns nothing when there are no merged events", () => {
    expect(recomputeRollupFromEvents([], "acme", now)).toEqual([]);
    expect(
      recomputeRollupFromEvents(
        [event(1, "2026-08-01T00:00:00Z", { state: "closed", mergedAt: undefined })],
        "acme",
        now
      )
    ).toEqual([]);
  });

  it("reaches back to the oldest merged pull request", () => {
    const rows = recomputeRollupFromEvents(
      [event(1, "2019-03-04T00:00:00Z"), event(2, "2026-08-20T00:00:00Z")],
      "acme",
      now
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].date < "2019-04-01").toBe(true);
  });

  it("marks every row as reconstructed", () => {
    const rows = recomputeRollupFromEvents([event(1, "2026-08-20T00:00:00Z")], "acme", now);
    expect(rows.every((r) => r.reconstructed === true)).toBe(true);
  });

  it("leaves point-in-time fields at zero rather than inventing them", () => {
    const rows = recomputeRollupFromEvents([event(1, "2026-08-20T00:00:00Z")], "acme", now);
    expect(rows[0].committers).toBe(0);
    expect(rows[0].reviewers).toBe(0);
    expect(rows[0].dependents).toBe(0);
    expect(rows[0].agentTasks).toBe(0);
  });

  it("emits an org row alongside the repo rows", () => {
    const rows = recomputeRollupFromEvents(
      [
        event(1, "2026-08-20T00:00:00Z"),
        event(2, "2026-08-20T00:00:00Z", { repo: "acme/web" }),
      ],
      "acme",
      now
    );
    const week = rows.filter((r) => r.date === rows[rows.length - 1].date);
    expect(week.some((r) => r.repo === "*")).toBe(true);
    expect(week.find((r) => r.repo === "*")!.mergedPRs30d).toBe(2);
  });

  it("omits repos with no merges in a window rather than writing zero rows", () => {
    const rows = recomputeRollupFromEvents(
      [event(1, "2019-03-04T00:00:00Z"), event(2, "2026-08-20T00:00:00Z")],
      "acme",
      now
    );
    // Years separate the two merges; the quiet weeks in between produce no rows.
    const dates = new Set(rows.map((r) => r.date));
    expect(dates.size).toBeLessThan(20);
  });

  it("computes cycle-time quantiles over the trailing window", () => {
    const rows = recomputeRollupFromEvents(
      [
        event(1, "2026-08-20T00:00:00Z", { timeToMergeHours: 10 }),
        event(2, "2026-08-21T00:00:00Z", { timeToMergeHours: 20 }),
        event(3, "2026-08-22T00:00:00Z", { timeToMergeHours: 90 }),
      ],
      "acme",
      now
    );
    const last = rows.filter((r) => r.repo === "acme/api").pop()!;
    expect(last.cycleP50).toBe(20);
    expect(last.cycleP90).toBeGreaterThan(20);
  });

  it("separates AI-authored from human pull requests", () => {
    const rows = recomputeRollupFromEvents(
      [
        event(1, "2026-08-20T00:00:00Z", { aiAuthorType: "copilot" }),
        event(2, "2026-08-21T00:00:00Z"),
        event(3, "2026-08-22T00:00:00Z", { isBot: true }),
      ],
      "acme",
      now
    );
    const last = rows.filter((r) => r.repo === "acme/api").pop()!;
    expect(last.aiPRs30d).toBe(1);
    expect(last.humanPRs30d).toBe(1);
  });
});

describe("mergeReconstructed", () => {
  function row(date: string, repoName: string, reconstructed?: boolean): RollupRow {
    return {
      ...buildRollupRows(metrics([repo(repoName, [])]), date)[0],
      ...(reconstructed ? { reconstructed: true } : {}),
    };
  }

  it("keeps observed rows and fills only uncollected dates", () => {
    const merged = mergeReconstructed(
      [row("2026-08-30", "acme/api")],
      [row("2026-08-30", "acme/api", true), row("2020-01-05", "acme/api", true)]
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.date === "2026-08-30")!.reconstructed).toBeUndefined();
    expect(merged.find((r) => r.date === "2020-01-05")!.reconstructed).toBe(true);
  });

  it("replaces previously reconstructed rows rather than accumulating them", () => {
    const first = mergeReconstructed([], [row("2020-01-05", "acme/api", true)]);
    const second = mergeReconstructed(first, [row("2020-01-05", "acme/api", true)]);
    expect(second).toHaveLength(1);
  });

  it("returns rows sorted by date", () => {
    const merged = mergeReconstructed(
      [row("2026-08-30", "acme/api")],
      [row("2020-01-05", "acme/api", true), row("2023-06-04", "acme/api", true)]
    );
    const dates = merged.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe("isMergedEvent", () => {
  it("accepts a row that declares itself merged", () => {
    expect(isMergedEvent(event(1, "2026-08-20T00:00:00Z"))).toBe(true);
  });

  it("rejects a row that declares itself closed", () => {
    expect(
      isMergedEvent(
        event(1, "2026-08-20T00:00:00Z", { state: "closed", mergedAt: undefined })
      )
    ).toBe(false);
  });

  it("treats a pre-`state` row with a merge timestamp as merged", () => {
    // The stream is append-only, so rows written before `state` existed persist
    // forever; dropping them would silently discard the early history.
    const legacy = { ...event(1, "2026-08-20T00:00:00Z") } as Partial<EventRow>;
    delete legacy.state;
    expect(isMergedEvent(legacy as EventRow)).toBe(true);
  });

  it("treats a pre-`state` row with no merge timestamp as not merged", () => {
    const legacy = { ...event(1, "2026-08-20T00:00:00Z") } as Partial<EventRow>;
    delete legacy.state;
    delete legacy.mergedAt;
    expect(isMergedEvent(legacy as EventRow)).toBe(false);
  });

  it("recomputes rollups from a stream of pre-`state` rows", () => {
    const legacy = [event(1, "2026-08-20T00:00:00Z"), event(2, "2026-08-21T00:00:00Z")].map(
      (e) => {
        const copy = { ...e } as Partial<EventRow>;
        delete copy.state;
        return copy as EventRow;
      }
    );
    const rows = recomputeRollupFromEvents(legacy, "acme", Date.parse("2026-08-30T00:00:00Z"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.mergedPRs30d === 2)).toBe(true);
  });
});

// ── Metrics added on top of the original rollup ──────────────────────────────

describe("deriveRollupExtras", () => {
  it("returns zeroes for an empty window rather than holes", () => {
    const extras = deriveRollupExtras([], 0);
    expect(extras).toMatchObject({
      sizeP90: 0,
      largePRs30d: 0,
      abandonedPRs30d: 0,
      revertPRs30d: 0,
      reviewedPRs30d: 0,
      reviewWaitP50: 0,
      reviewGini: 0,
    });
  });

  it("counts pull requests at or over the large-change threshold", () => {
    const extras = deriveRollupExtras(
      [
        { createdAt: "2026-08-01T00:00:00Z", linesAdded: 100, linesDeleted: 10 },
        { createdAt: "2026-08-01T00:00:00Z", linesAdded: LARGE_PR_LINES, linesDeleted: 0 },
        { createdAt: "2026-08-01T00:00:00Z", linesAdded: 900, linesDeleted: 100 },
      ],
      0
    );
    expect(extras.largePRs30d).toBe(2);
  });

  it("splits the wait for review, approval and merge from raw timestamps", () => {
    const extras = deriveRollupExtras(
      [
        {
          createdAt: "2026-08-01T00:00:00Z",
          firstReviewAt: "2026-08-02T00:00:00Z",
          firstApprovalAt: "2026-08-03T00:00:00Z",
          mergedAt: "2026-08-03T12:00:00Z",
        },
      ],
      0
    );
    expect(extras.reviewWaitP50).toBe(24);
    expect(extras.approvalWaitP50).toBe(24);
    expect(extras.mergeWaitP50).toBe(12);
    expect(extras.reviewedPRs30d).toBe(1);
  });

  it("leaves a leg at zero when the timestamps behind it are missing", () => {
    const extras = deriveRollupExtras([{ createdAt: "2026-08-01T00:00:00Z" }], 0);
    expect(extras.reviewWaitP50).toBe(0);
    expect(extras.approvalWaitP50).toBe(0);
    expect(extras.reviewedPRs30d).toBe(0);
  });

  it("ignores a review timestamp that precedes the pull request", () => {
    const extras = deriveRollupExtras(
      [{ createdAt: "2026-08-05T00:00:00Z", firstReviewAt: "2026-08-01T00:00:00Z" }],
      0
    );
    expect(extras.reviewWaitP50).toBe(0);
  });

  it("takes the median of the changes-requested counts as review rounds", () => {
    const extras = deriveRollupExtras(
      [
        { createdAt: "2026-08-01T00:00:00Z", changesRequestedCount: 0 },
        { createdAt: "2026-08-01T00:00:00Z", changesRequestedCount: 2 },
        { createdAt: "2026-08-01T00:00:00Z", changesRequestedCount: 4 },
      ],
      0
    );
    expect(extras.reviewRoundsP50).toBe(2);
  });

  it("counts pull requests that revert another one", () => {
    const extras = deriveRollupExtras(
      [
        { createdAt: "2026-08-01T00:00:00Z", revertsPR: 12 },
        { createdAt: "2026-08-01T00:00:00Z" },
      ],
      0
    );
    expect(extras.revertPRs30d).toBe(1);
  });

  it("passes the abandoned count straight through", () => {
    expect(deriveRollupExtras([], 7).abandonedPRs30d).toBe(7);
  });

  it("measures review concentration across the window's reviewers", () => {
    const shared = deriveRollupExtras(
      [
        { createdAt: "2026-08-01T00:00:00Z", reviewers: ["amy"] },
        { createdAt: "2026-08-01T00:00:00Z", reviewers: ["bob"] },
      ],
      0
    );
    const concentrated = deriveRollupExtras(
      [
        { createdAt: "2026-08-01T00:00:00Z", reviewers: ["amy"] },
        { createdAt: "2026-08-01T00:00:00Z", reviewers: ["amy"] },
        { createdAt: "2026-08-01T00:00:00Z", reviewers: ["amy", "bob"] },
      ],
      0
    );
    expect(shared.reviewGini).toBe(0);
    expect(concentrated.reviewGini).toBeGreaterThan(0);
  });
});

describe("buildRollupRows with the newer metrics", () => {
  it("carries the derived fields onto every row", () => {
    const rows = buildRollupRows(
      metrics([
        repo("acme/api", [
          pr(1, 5, {
            linesAdded: 500,
            linesDeleted: 10,
            firstReviewAt: new Date(Date.parse("2026-08-25T00:00:00Z")).toISOString(),
          }),
        ]),
      ]),
      "2026-08-30"
    );
    expect(rows[0].largePRs30d).toBe(1);
    expect(rows[0].sizeP90).toBe(510);
    expect(rows[1].largePRs30d).toBe(1);
  });

  it("counts abandoned pull requests inside the window only", () => {
    const rows = buildRollupRows(
      metrics([
        repo("acme/api", [pr(1, 5)], {
          closedPRTimeline: [
            {
              number: 90,
              createdAt: "2026-08-01T00:00:00Z",
              closedAt: "2026-08-28T00:00:00Z",
              author: "amy",
              isBotAuthor: false,
            },
            {
              number: 91,
              createdAt: "2025-01-01T00:00:00Z",
              closedAt: "2025-02-01T00:00:00Z",
              author: "amy",
              isBotAuthor: false,
            },
          ],
        }),
      ]),
      "2026-08-30"
    );
    expect(rows[0].abandonedPRs30d).toBe(1);
    expect(rows[1].abandonedPRs30d).toBe(1);
  });

  it("reports the median age of the pull requests still open", () => {
    const rows = buildRollupRows(
      metrics([
        repo("acme/api", [pr(1, 5)], {
          openPRTimeline: [
            { number: 5, createdAt: "2026-08-29T23:59:59Z", author: "amy", isBotAuthor: false },
          ],
        }),
      ]),
      "2026-08-30"
    );
    expect(rows[0].openAgeP50).toBeCloseTo(24, 0);
  });

  it("leaves the open age undefined when nothing is open", () => {
    const rows = buildRollupRows(metrics([repo("acme/api", [pr(1, 5)])]), "2026-08-30");
    expect(rows[0].openAgeP50).toBeUndefined();
  });
});

describe("buildEventRows for abandoned pull requests", () => {
  it("records a closed-unmerged PR as its own event", () => {
    const rows = buildEventRows(
      metrics([
        repo("acme/api", [pr(1, 5)], {
          closedPRTimeline: [
            {
              number: 42,
              createdAt: "2026-08-01T00:00:00Z",
              closedAt: "2026-08-10T00:00:00Z",
              author: "amy",
              isBotAuthor: false,
              linesAdded: 3,
              linesDeleted: 1,
            },
          ],
        }),
      ])
    );
    const closed = rows.find((r) => r.number === 42);
    expect(closed).toMatchObject({
      state: "closed",
      closedAt: "2026-08-10T00:00:00Z",
      linesAdded: 3,
    });
    expect(closed?.mergedAt).toBeUndefined();
    expect(closed?.timeToMergeHours).toBeUndefined();
  });

  it("carries the review facts onto a merged event", () => {
    const rows = buildEventRows(
      metrics([
        repo("acme/api", [
          pr(1, 5, {
            firstReviewAt: "2026-08-24T00:00:00Z",
            firstApprovalAt: "2026-08-24T06:00:00Z",
            reviewCount: 3,
            changesRequestedCount: 1,
            revertsPR: 8,
          }),
        ]),
      ])
    );
    expect(rows[0]).toMatchObject({
      firstReviewAt: "2026-08-24T00:00:00Z",
      firstApprovalAt: "2026-08-24T06:00:00Z",
      reviewCount: 3,
      changesRequestedCount: 1,
      revertsPR: 8,
    });
  });

  it("leaves the new fields absent when nothing was collected for them", () => {
    const rows = buildEventRows(metrics([repo("acme/api", [pr(1, 5)])]));
    expect(rows[0].firstApprovalAt).toBeUndefined();
    expect(rows[0].changesRequestedCount).toBeUndefined();
  });
});

describe("recomputeRollupFromEvents with the newer metrics", () => {
  const scope = "acme";
  const now = Date.parse("2026-08-30T00:00:00Z");

  function ev(extra: Partial<EventRow>): EventRow {
    return {
      v: HISTORY_SCHEMA_VERSION,
      scope,
      repo: "acme/api",
      number: 1,
      state: "merged",
      author: "amy",
      isBot: false,
      createdAt: "2026-08-20T00:00:00Z",
      mergedAt: "2026-08-22T00:00:00Z",
      closedAt: "2026-08-22T00:00:00Z",
      timeToMergeHours: 48,
      linesAdded: 10,
      linesDeleted: 5,
      ...extra,
    };
  }

  it("reaches the review-latency metrics back through history", () => {
    const rows = recomputeRollupFromEvents(
      [
        ev({
          number: 1,
          firstReviewAt: "2026-08-21T00:00:00Z",
          firstApprovalAt: "2026-08-21T12:00:00Z",
        }),
      ],
      scope,
      now
    );
    const repoRows = rows.filter((r) => r.repo === "acme/api");
    expect(repoRows.length).toBeGreaterThan(0);
    const withData = repoRows[repoRows.length - 1];
    expect(withData.reviewWaitP50).toBe(24);
    expect(withData.approvalWaitP50).toBe(12);
    expect(withData.reviewedPRs30d).toBe(1);
    expect(withData.reconstructed).toBe(true);
  });

  it("counts abandoned pull requests from closed events", () => {
    const rows = recomputeRollupFromEvents(
      [
        ev({ number: 1 }),
        ev({
          number: 2,
          state: "closed",
          mergedAt: undefined,
          timeToMergeHours: undefined,
          closedAt: "2026-08-23T00:00:00Z",
        }),
      ],
      scope,
      now
    );
    const last = rows.filter((r) => r.repo === "acme/api").pop();
    expect(last?.abandonedPRs30d).toBe(1);
  });

  it("still reconstructs rows when the newer fields are absent from old events", () => {
    const rows = recomputeRollupFromEvents([ev({ number: 1 })], scope, now);
    const last = rows.filter((r) => r.repo === "acme/api").pop();
    expect(last?.mergedPRs30d).toBe(1);
    expect(last?.reviewWaitP50).toBe(0);
    expect(last?.reviewGini).toBe(0);
  });

  it("produces no row for a window that only holds abandonments", () => {
    const rows = recomputeRollupFromEvents(
      [
        ev({ number: 1, mergedAt: "2026-01-05T00:00:00Z", closedAt: "2026-01-05T00:00:00Z" }),
        ev({
          number: 2,
          state: "closed",
          mergedAt: undefined,
          timeToMergeHours: undefined,
          closedAt: "2026-08-23T00:00:00Z",
        }),
      ],
      scope,
      now
    );
    const august = rows.filter((r) => r.repo === "acme/api" && r.date > "2026-08-01");
    expect(august).toEqual([]);
  });
});
