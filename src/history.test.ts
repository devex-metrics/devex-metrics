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
