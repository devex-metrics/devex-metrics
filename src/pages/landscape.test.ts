import { JSDOM } from "jsdom";
import { buildDashboardHtml } from "./dashboard.js";
import { buildLandscapeSection } from "./landscape.js";
import { getLandscapeControlsJS } from "./landscape-controls.js";
import type { LandscapeRepoView, OrgMetrics, RepoMetrics } from "../types.js";

const SHA = "a".repeat(40);

function observed(): LandscapeRepoView {
  return {
    fullName: "acme/public",
    status: "observed",
    collectedAt: "2026-09-25T10:30:00.000Z",
    scannerVersion: "0.1.0",
    headSha: SHA,
    files: [
      {
        path: 'docs/<script>alert("x")</script>.md',
        kind: "instructions",
        sha256: "b".repeat(64),
        last_changed: null,
        age_days: null,
        lag_days: null,
        stale: null,
        status: "unknown",
      },
    ],
    summary: {
      count: 1,
      stale_count: 0,
      max_lag_days: null,
      unknown_count: 1,
      status: "partial_unknown",
    },
    drift: {
      compared_at: "2026-09-24T10:30:00.000Z",
      compared_head_sha: "c".repeat(40),
      added: ['docs/<script>alert("x")</script>.md'],
      removed: ["AGENTS.md"],
      content_changed: [],
    },
  };
}

function activitySnapshot(entries: [string, string[] | null][]): Pick<OrgMetrics, "repos" | "collectedAt"> {
  return {
    collectedAt: "2026-09-30T12:00:00.000Z",
    repos: entries.map(([fullName, dates]): RepoMetrics => ({
      name: fullName.split("/")[1],
      fullName,
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, merged: 0, closed: 0 },
      pullRequestDetails: [],
      ...(dates === null ? {} : {
        mergedPRTimeline: dates.map((date, index) => ({
          number: index + 1, createdAt: date, mergedAt: date, author: "tester",
          isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 0, closesIssues: [],
        })),
      }),
      committerCount: 0, reviewerCount: 0, contributorCount: 0, dependentCount: 0,
    })),
  };
}

function empty(name: string): LandscapeRepoView {
  const row = observed();
  row.fullName = name;
  row.files = [];
  row.summary = { count: 0, stale_count: 0, unknown_count: 0, max_lag_days: null, status: "known" };
  return row;
}

function aged(name: string, stale: boolean): LandscapeRepoView {
  const row = observed();
  row.fullName = name;
  row.files = [{ ...row.files![0], path: "AGENTS.md", age_days: stale ? 140 : 12,
    lag_days: stale ? 100 : 3, stale, status: "known", last_changed: "2026-09-18T12:00:00Z" }];
  row.summary = { count: 1, stale_count: stale ? 1 : 0, unknown_count: 0,
    max_lag_days: stale ? 100 : 3, status: "known" };
  return row;
}

function mount(rows: LandscapeRepoView[], metrics?: Pick<OrgMetrics, "repos" | "collectedAt">): JSDOM {
  const dom = new JSDOM(buildLandscapeSection(rows, undefined, metrics), { runScripts: "outside-only" });
  dom.window.eval(getLandscapeControlsJS());
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom;
}

function visibleNames(dom: JSDOM): string[] {
  return Array.from(dom.window.document.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr:not(.landscape-detail-row)"))
    .filter((row) => !row.hidden)
    .map((row) => row.cells[1].textContent ?? "");
}

describe("landscape dashboard view", () => {
  it("prioritizes older age signals before active coverage gaps without scoring unknown or private repositories", () => {
    const rows = [
      aged("acme/quiet-fresh", false),
      { fullName: "acme/private", status: "unknown", reason: "private" } as LandscapeRepoView,
      empty("acme/active-missing"),
      aged("acme/active-old", true),
      empty("acme/quiet-missing"),
      { fullName: "acme/failed", status: "unknown", reason: "scan_error" } as LandscapeRepoView,
      observed(),
    ];
    const metrics = activitySnapshot([
      ["acme/active-missing", ["2026-09-29T12:00:00Z", "2026-09-28T12:00:00Z", "2026-05-01T12:00:00Z"]],
      ["acme/active-old", ["2026-09-29T12:00:00Z"]],
      ["acme/quiet-missing", []],
      ["acme/quiet-fresh", []],
      ["acme/private", ["2026-09-29T12:00:00Z"]],
      ["acme/failed", null],
      ["acme/public", null],
    ]);
    const dom = mount(rows, metrics);
    const doc = dom.window.document;
    expect(visibleNames(dom)).toEqual([
      "acme/active-old", "acme/active-missing", "acme/quiet-missing",
      "acme/public", "acme/failed", "acme/private", "acme/quiet-fresh",
    ]);
    const byName = (name: string) => Array.from(doc.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr:not(.landscape-detail-row)"))
      .find((row) => row.cells[1].textContent === name)!;
    expect(byName("acme/active-missing").cells[2].textContent).toBe("2 observed");
    expect(byName("acme/quiet-missing").cells[2].textContent).toBe("0 observed");
    expect(byName("acme/quiet-missing").cells[7].textContent).toContain("Not applicable");
    expect(byName("acme/failed").cells[2].textContent).toBe("Unknown");
    expect(byName("acme/private").cells[5].textContent).toBe("—");
    expect(byName("acme/private").textContent).toContain("Private repository; not scanned");
    expect(byName("acme/active-old").cells[7].textContent).toContain("Oldest 140 d");
    expect(byName("acme/active-old").cells[7].textContent).toContain("Lag up to 100 d");
    expect(doc.querySelector(".landscape-triage")?.textContent).toContain("Observation unknown");
    expect(doc.querySelector(".landscape-context")?.textContent).toContain("PR timeline can be incomplete");
    expect(doc.querySelector<HTMLButtonElement>('[data-landscape-sort="priority"]')!.closest("th")?.getAttribute("aria-sort")).toBe("ascending");

    const sort = (key: string) => doc.querySelector<HTMLButtonElement>(`[data-landscape-sort="${key}"]`)!;
    sort("activity").click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/active-missing", "acme/active-old", "acme/private"]);
    expect(visibleNames(dom).at(-1)).toBe("acme/public");
    sort("activity").click();
    expect(visibleNames(dom).slice(0, 2)).toEqual(["acme/quiet-fresh", "acme/quiet-missing"]);
    expect(visibleNames(dom).at(-1)).toBe("acme/public");
    sort("age").click();
    expect(visibleNames(dom).slice(0, 2)).toEqual(["acme/active-old", "acme/quiet-fresh"]);
    sort("priority").click();
    expect(visibleNames(dom)[0]).toBe("acme/active-old");
    doc.querySelector<HTMLButtonElement>("#landscapeSortReset")!.click();
    expect(visibleNames(dom)[0]).toBe("acme/active-old");
  });

  it("ranks quiet drift ahead of active repositories without customization files", () => {
    const quietDrift = aged("acme/quiet-drift", true);
    const activeMissing = empty("acme/active-missing");
    const dom = mount([activeMissing, quietDrift], activitySnapshot([
      ["acme/active-missing", ["2026-09-29T12:00:00Z"]],
      ["acme/quiet-drift", []],
    ]));

    expect(visibleNames(dom)).toEqual(["acme/quiet-drift", "acme/active-missing"]);
    const rows = Array.from(dom.window.document.querySelectorAll<HTMLTableRowElement>(
      "#landscapeRows > tr:not(.landscape-detail-row)"
    ));
    expect(rows[0].textContent).toContain("Review first");
    expect(rows[1].textContent).toContain("Review next");
  });

  it("does not turn absent or malformed timeline dates into zero activity", () => {
    const rows = ["missing", "bad", "empty", "recent", "old", "future"].map((name) => empty(`acme/${name}`));
    const metrics = activitySnapshot([
      ["acme/bad", ["2026-02-31T00:00:00Z"]],
      ["acme/empty", []],
      ["acme/recent", ["2026-09-30T12:00:00Z"]],
      ["acme/old", ["2025-01-01T12:00:00Z"]],
      ["acme/future", ["2026-10-01T12:00:00Z"]],
    ]);
    const doc = mount(rows, metrics).window.document;
    const values = Object.fromEntries(
      Array.from(doc.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr:not(.landscape-detail-row)"))
        .map((row) => [row.cells[1].textContent, row.cells[2].textContent])
    );
    expect(values).toMatchObject({
      "acme/missing": "Unknown", "acme/bad": "Unknown",
      "acme/empty": "0 observed", "acme/recent": "1 observed",
      "acme/old": "0 observed", "acme/future": "0 observed",
    });
  });

  it("shows separate pinned Git, team and content scores, with unknowns last during keyboard sorting", () => {
    const active = aged("acme/git-active", true);
    active.commits30d = 3;
    active.commits90d = 9;
    active.teamCommits30d = 1;
    active.teamCommits90d = 4;
    active.qualityScore = 75;
    active.qualityScored = 1;
    active.files![0].commits_since_change = 5;
    active.files![0].content_signal = {
      score: 75, scope: true, actions: true, verification: true, guardrails: false,
    };
    const quiet = empty("acme/git-quiet");
    quiet.commits30d = 0;
    quiet.commits90d = 0;
    quiet.teamCommits30d = 0;
    quiet.teamCommits90d = 0;
    quiet.qualityScore = null;
    quiet.qualityScored = 0;
    const dom = mount([quiet, active, observed()], activitySnapshot([
      ["acme/git-active", []], ["acme/git-quiet", []], ["acme/public", []],
    ]));
    const doc = dom.window.document;
    expect(visibleNames(dom)[0]).toBe("acme/git-active");
    const row = Array.from(doc.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr:not(.landscape-detail-row)"))
      .find((item) => item.cells[1].textContent === "acme/git-active")!;
    expect(row.cells[3].textContent).toContain("3 30d9 90d");
    expect(row.cells[4].textContent).toContain("1 30d4 90d");
    expect(row.cells[6].textContent).toContain("75/100");
    const detail = doc.getElementById(row.querySelector(".landscape-toggle")!.getAttribute("aria-controls")!)!;
    expect(detail.textContent).toContain("Commits since change");
    expect(detail.querySelector(".landscape-file-table tbody")?.textContent).toContain("5");
    expect(detail.querySelector(".landscape-file-table tbody")?.textContent).toContain("Scope · Actions · Checks");
    const sort = doc.querySelector<HTMLButtonElement>('[data-landscape-sort="commits90"]')!;
    sort.focus();
    expect(doc.activeElement).toBe(sort);
    sort.click();
    expect(visibleNames(dom)).toEqual(["acme/git-active", "acme/git-quiet", "acme/public"]);
    doc.querySelector<HTMLButtonElement>('[data-landscape-sort="quality"]')!.click();
    expect(visibleNames(dom)[0]).toBe("acme/git-active");
    expect(doc.querySelector<HTMLButtonElement>('[data-landscape-sort="quality"]')!.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  });

  it("passes the DevEx PR timeline into the landscape without altering its sanitized data", () => {
    const metrics = activitySnapshot([["acme/with-work", ["2026-09-29T12:00:00Z"]]]);
    const data: OrgMetrics = {
      ...metrics, owner: "acme", ownerType: "org", repoCount: 1,
    };
    const html = buildDashboardHtml(data, "2026-09-30", undefined, undefined, {
      landscape: [empty("acme/with-work")],
    });
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("#landscapeRows .landscape-activity")?.textContent).toBe("1 observed");
    expect(doc.querySelector("#landscapeRows .landscape-attention")?.textContent).toBe("Review next");
    expect(doc.querySelector('a[href="landscape.json"]')).not.toBeNull();
    expect(doc.querySelector('a[href="data.json"]')).not.toBeNull();
  });

  it("escapes repository names in both visible rows and accessible controls", () => {
    const name = 'acme/<img src=x onerror="alert(1)">';
    const html = buildLandscapeSection([empty(name)], undefined,
      activitySnapshot([[name, ["2026-09-29T12:00:00Z"]]]));
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector("#landscapeRows th[scope=row]")?.textContent).toBe(name);
    expect(doc.querySelector(".landscape-toggle")?.getAttribute("aria-label")).toContain(name);
  });

  it("places attention items on page one before alphabetical names and restores the default after sorting", () => {
    const rows = [
      ...Array.from({ length: 21 }, (_, index) => aged(`acme/a-${index}`, false)),
      empty("acme/z-needs-review"),
    ];
    const metrics = activitySnapshot(rows.map((row) =>
      [row.fullName, row.fullName.endsWith("needs-review") ? ["2026-09-29T12:00:00Z"] : []]
    ));
    const dom = mount(rows, metrics);
    const doc = dom.window.document;
    expect(visibleNames(dom)[0]).toBe("acme/z-needs-review");
    const sort = doc.querySelector<HTMLButtonElement>('[data-landscape-sort="name"]')!;
    sort.focus();
    expect(doc.activeElement).toBe(sort);
    sort.click();
    expect(visibleNames(dom)[0]).toBe("acme/a-0");
    doc.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 2 of 2");
    doc.querySelector<HTMLButtonElement>("#landscapeSortReset")!.click();
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    expect(visibleNames(dom)[0]).toBe("acme/z-needs-review");
  });
  it("renders observed file-level drift, provenance and unknowns without HTML injection", () => {
    const html = buildLandscapeSection([
      observed(),
      { fullName: "acme/private", status: "unknown", reason: "private" },
      { fullName: "acme/denied", status: "unknown", reason: "denied" },
      { fullName: "acme/missing", status: "unknown", reason: "not_scanned" },
    ]);
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector(".landscape-path")?.textContent).toContain(
      '<script>alert("x")</script>'
    );
    const toggle = doc.querySelector(".landscape-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("View AI instruction files for acme/public");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    const detail = doc.getElementById(toggle!.getAttribute("aria-controls")!);
    expect(detail?.hidden).toBe(true);
    expect(detail?.querySelector("td")?.getAttribute("colspan")).toBe("11");
    expect(doc.querySelector("table")?.getAttribute("aria-label")).toBe(
      "AI instruction file observations by repository"
    );
    expect(doc.querySelector(".landscape-coverage")?.textContent).toContain("1 / 4 observed");
    expect(doc.querySelectorAll("#landscapeRows > tr .landscape-unknown")).toHaveLength(35);
    expect(html).toContain("Compared with");
    expect(html).toContain("2026-09-24T10:30:00.000Z");
    expect(html).toContain("Removed since comparison");
    expect(html).toContain("Unknown");
    expect(html).not.toContain("0 AI files");
  });

  it("distinguishes an empty selected scope from unknown observations", () => {
    const doc = new JSDOM(buildLandscapeSection([])).window.document;
    expect(doc.querySelector(".landscape-empty")?.textContent).toContain(
      "No repositories are selected"
    );
    expect(doc.querySelector(".landscape-table")).toBeNull();
  });

  it("surfaces an observed zero and first baseline without claiming drift", () => {
    const row = observed();
    row.files = [];
    row.summary = {
      count: 0,
      stale_count: 0,
      unknown_count: 0,
      max_lag_days: null,
      status: "known",
    };
    row.drift = undefined;
    const html = buildLandscapeSection([row]);
    expect(html).toContain("0 observed");
    expect(html).toContain("First observation; no comparison yet");
    expect(html).toContain("No AI instruction files observed at this commit.");
  });

  it("marks the data as stale with the failed run when the latest attempt failed", () => {
    const html = buildLandscapeSection([observed()], {
      attempted_at: "2026-09-27T06:00:00.000Z",
      ok: false,
      run_url: "https://github.com/acme/devex/actions/runs/42",
      last_success_at: "2026-09-26T06:00:00.000Z",
    });
    const doc = new JSDOM(html).window.document;
    const notice = doc.querySelector(".landscape-stale");
    expect(notice?.textContent).toContain("Stale data");
    expect(notice?.textContent).toContain("2026-09-27 06:00 UTC");
    expect(notice?.textContent).toContain("last successful scan at 2026-09-26 06:00 UTC");
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/devex/actions/runs/42"
    );
  });

  it("shows no stale notice after a successful attempt", () => {
    const html = buildLandscapeSection([observed()], {
      attempted_at: "2026-09-27T06:00:00.000Z",
      ok: true,
      last_success_at: "2026-09-27T06:00:00.000Z",
    });
    expect(html).not.toContain("landscape-stale");
  });

  it("paginates 143 visibility-unverified rows without inventing observations or exposing names in controls", () => {
    const rows: LandscapeRepoView[] = Array.from({ length: 143 }, (_, i) => ({
      fullName: `acme/repo-${String(i).padStart(3, "0")}`,
      status: "unknown",
      reason: "visibility_unknown",
    }));
    const dom = mount(rows);
    const doc = dom.window.document;
    const next = doc.querySelector<HTMLButtonElement>("#landscapeNext")!;
    const prev = doc.querySelector<HTMLButtonElement>("#landscapePrev")!;
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 1–20 of 143 repositories");
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 8");
    expect(prev.disabled).toBe(true);
    expect(doc.querySelector(".landscape-coverage")?.textContent).toBe("0 / 143 observed");
    expect(doc.querySelectorAll("#landscapeRows tr:not([hidden]) .landscape-unknown")).toHaveLength(180);
    expect(doc.querySelector(".landscape-pagination")?.outerHTML).not.toContain("acme/");
    expect(doc.querySelectorAll(".landscape-sort")).toHaveLength(11);
    for (let i = 0; i < 7; i++) next.click();
    expect(visibleNames(dom)).toHaveLength(3);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 141–143 of 143 repositories");
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 8 of 8");
    expect(next.disabled).toBe(true);
    prev.click();
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 121–140 of 143 repositories");
  });

  it("sorts all columns stably, puts unknown values last, resets page on sort, and clears sort", () => {
    const first = observed();
    first.fullName = "acme/z-10";
    const second = observed();
    second.fullName = "acme/a-2";
    second.summary = { count: 3, stale_count: 0, max_lag_days: null, unknown_count: 0, status: "known" };
    second.drift = {
      compared_at: first.collectedAt!,
      compared_head_sha: SHA,
      added: ["AGENTS.md"], removed: ["CLAUDE.md"], content_changed: ["README.md"],
    };
    second.collectedAt = "2026-09-27T10:30:00.000Z";
    const unknown: LandscapeRepoView = { fullName: "acme/b-1", status: "unknown", reason: "visibility_unknown" };
    const rows = [
      first, unknown, second,
      ...Array.from({ length: 19 }, (_, i): LandscapeRepoView => ({
        fullName: `acme/extra-${i}`, status: "unknown", reason: "not_scanned",
      })),
    ];
    const dom = mount(rows);
    const doc = dom.window.document;
    doc.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 2 of 2");
    const sort = (key: string) =>
      doc.querySelector<HTMLButtonElement>(`.landscape-sort[data-landscape-sort="${key}"]`)!;
    sort("count").click();
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/a-2", "acme/z-10", "acme/b-1"]);
    expect(sort("count").closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(doc.querySelector("#landscapeSortStatus")?.textContent).toContain("descending");
    sort("count").click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/z-10", "acme/a-2", "acme/b-1"]);
    expect(sort("count").closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    sort("changes").click();
    expect(visibleNames(dom)[0]).toBe("acme/a-2");
    sort("observed").click();
    expect(visibleNames(dom)[0]).toBe("acme/a-2");
    sort("detail").click();
    expect(visibleNames(dom).slice(0, 2)).toEqual(["acme/a-2", "acme/z-10"]);
    sort("name").click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/a-2", "acme/b-1", "acme/extra-0"]);
    expect(sort("name").getAttribute("aria-label")).toContain("descending");
    doc.querySelector<HTMLButtonElement>("#landscapeSortReset")!.click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/z-10", "acme/extra-0", "acme/extra-1"]);
    expect(doc.querySelector("#landscapeSortStatus")?.textContent).toBe("Attention first");
    expect(sort("name").closest("th")?.hasAttribute("aria-sort")).toBe(false);
    expect(sort("priority").closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(doc.querySelector<HTMLButtonElement>("#landscapeSortReset")!.disabled).toBe(true);
  });

  it("keeps observed zero files distinct from unknowns and preserves source order for ties", () => {
    const zero = observed();
    zero.fullName = "acme/zero";
    zero.summary = {
      count: 0, stale_count: 0, unknown_count: 0, max_lag_days: null, status: "known",
    };
    zero.files = [];
    const tied = observed();
    tied.fullName = "acme/tied";
    const unknown: LandscapeRepoView = {
      fullName: "acme/unverified", status: "unknown", reason: "visibility_unknown",
    };
    const dom = mount([unknown, tied, zero, observed()]);
    const button = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-landscape-sort="count"]'
    )!;
    button.click();
    expect(visibleNames(dom)).toEqual(["acme/public", "acme/tied", "acme/zero", "acme/unverified"]);
    button.click();
    expect(visibleNames(dom)).toEqual(["acme/zero", "acme/public", "acme/tied", "acme/unverified"]);
    expect(dom.window.document.querySelectorAll("#landscapeRows > tr:not(.landscape-detail-row)")).toHaveLength(4);
  });

  it("labels failed scans as attempts without treating them as observations", () => {
    const old = observed();
    old.fullName = "acme/old";
    old.collectedAt = "2026-09-23T10:30:00.000Z";
    const recent = observed();
    recent.fullName = "acme/recent";
    const dom = mount([
      { fullName: "acme/denied", status: "unknown", reason: "denied", collectedAt: "2026-09-29T10:30:00.000Z" },
      old,
      { fullName: "acme/failed", status: "unknown", reason: "scan_error", collectedAt: "2026-09-30T10:30:00.000Z" },
      recent,
      { fullName: "acme/unverified", status: "unknown", reason: "visibility_unknown" },
    ]);
    const doc = dom.window.document;
    const rows = Array.from(doc.querySelectorAll<HTMLTableRowElement>(
      "#landscapeRows > tr:not(.landscape-detail-row)"
    ));
    expect(rows.filter((row) => row.dataset.landscapeObserved === "")).toHaveLength(3);
    for (const [name, timestamp] of [
      ["acme/denied", "2026-09-29T10:30:00.000Z"],
      ["acme/failed", "2026-09-30T10:30:00.000Z"],
    ]) {
      const row = rows.find((candidate) => candidate.cells[1].textContent === name)!;
      expect(row.cells[9].textContent).toContain(`Scan attempted ${timestamp.slice(0, 10)}`);
      expect(row.cells[9].querySelector("time")?.dateTime).toBe(timestamp);
      expect(row.cells[7].textContent?.trim()).toBe("—");
      expect(row.cells[7].querySelector("time")).toBeNull();
    }
    const button = doc.querySelector<HTMLButtonElement>('[data-landscape-sort="observed"]')!;
    button.click();
    expect(visibleNames(dom)).toEqual([
      "acme/recent", "acme/old", "acme/denied", "acme/failed", "acme/unverified",
    ]);
    button.click();
    expect(visibleNames(dom)).toEqual([
      "acme/old", "acme/recent", "acme/denied", "acme/failed", "acme/unverified",
    ]);
  });

  it("re-sorts inserted rows with missing metadata after known numeric and date values", async () => {
    const old = observed();
    old.fullName = "acme/old";
    old.collectedAt = "2026-09-23T10:30:00.000Z";
    const recent = observed();
    recent.fullName = "acme/recent";
    recent.summary = { count: 3, stale_count: 0, max_lag_days: null, unknown_count: 0, status: "known" };
    const dom = mount([
      old, recent,
      ...Array.from({ length: 18 }, (_, i): LandscapeRepoView => ({
        fullName: `acme/unverified-${i}`, status: "unknown", reason: "visibility_unknown",
      })),
    ]);
    const doc = dom.window.document;
    const tbody = doc.querySelector("#landscapeRows")!;
    const sort = (key: string) => doc.querySelector<HTMLButtonElement>(`[data-landscape-sort="${key}"]`)!;
    const names = () => Array.from((tbody as HTMLTableSectionElement).rows)
      .filter((row) => !row.classList.contains("landscape-detail-row"))
      .map((row) => row.cells[1].textContent);
    const insert = (name: string, metadata?: { count?: string; observed?: string }) => {
      const row = doc.createElement("tr");
      row.innerHTML = `<td>—</td><th scope="row">${name}</th><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>`;
      if (metadata?.count !== undefined) row.dataset.landscapeCount = metadata.count;
      if (metadata?.observed !== undefined) row.dataset.landscapeObserved = metadata.observed;
      tbody.prepend(row);
    };
    const flush = async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)); };

    sort("count").click();
    insert("acme/missing-count");
    await flush();
    insert("acme/middle", { count: "2", observed: "2026-09-24T10:30:00.000Z" });
    await flush();
    expect(names().slice(0, 3)).toEqual(["acme/recent", "acme/middle", "acme/old"]);
    expect(names().indexOf("acme/missing-count")).toBeGreaterThan(names().indexOf("acme/old"));
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 1–20 of 22 repositories");
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    sort("count").click();
    expect(names().slice(0, 3)).toEqual(["acme/old", "acme/middle", "acme/recent"]);
    expect(names().indexOf("acme/missing-count")).toBeGreaterThan(names().indexOf("acme/recent"));

    sort("observed").click();
    insert("acme/missing-date");
    await flush();
    insert("acme/invalid-date", { observed: "not-a-date" });
    await flush();
    insert("acme/non-iso-date", { observed: "Sep 24, 2026" });
    await flush();
    insert("acme/invalid-calendar", { observed: "2026-02-31T10:30:00.000Z" });
    await flush();
    insert("acme/offset", { count: "2", observed: "2026-09-24T09:00:00-03:00" });
    await flush();
    expect(names().slice(0, 4)).toEqual(["acme/recent", "acme/offset", "acme/middle", "acme/old"]);
    expect(names().slice(4, 9)).toEqual([
      "acme/invalid-calendar", "acme/invalid-date", "acme/missing-count",
      "acme/missing-date", "acme/non-iso-date",
    ]);
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    doc.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    expect(visibleNames(dom)).toHaveLength(7);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 21–27 of 27 repositories");
    sort("observed").click();
    expect(names().slice(0, 4)).toEqual(["acme/old", "acme/middle", "acme/offset", "acme/recent"]);
    expect(names().slice(4, 9)).toEqual([
      "acme/invalid-calendar", "acme/invalid-date", "acme/missing-count",
      "acme/missing-date", "acme/non-iso-date",
    ]);
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
  });

  it("expands the file table in a full-width row that follows its repository through sorting and paging", () => {
    const first = observed();
    first.fullName = "acme/z-repo";
    const second = observed();
    second.fullName = "acme/a-repo";
    const dom = mount([
      first, second,
      ...Array.from({ length: 19 }, (_, i): LandscapeRepoView => ({
        fullName: `acme/m-${String(i).padStart(2, "0")}`, status: "unknown", reason: "not_scanned",
      })),
    ]);
    const doc = dom.window.document;
    const repoRow = (name: string) => Array.from(doc.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr:not(.landscape-detail-row)"))
      .find((row) => row.cells[1].textContent === name)!;
    const toggle = repoRow("acme/z-repo").querySelector<HTMLButtonElement>(".landscape-toggle")!;
    const detail = doc.getElementById(toggle.getAttribute("aria-controls")!) as HTMLTableRowElement;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(detail.hidden).toBe(false);
    expect(detail.previousElementSibling).toBe(repoRow("acme/z-repo"));

    doc.querySelector<HTMLButtonElement>('[data-landscape-sort="name"]')!.click();
    expect(detail.previousElementSibling).toBe(repoRow("acme/z-repo"));
    expect(repoRow("acme/z-repo").hidden).toBe(true);
    expect(detail.hidden).toBe(true);
    doc.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    expect(detail.hidden).toBe(false);
    expect(visibleNames(dom)).toEqual(["acme/z-repo"]);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(detail.hidden).toBe(true);
  });

  it("updates page counts when rows change and keeps the empty selected scope free of controls", async () => {
    const empty = mount([]);
    expect(empty.window.document.querySelector("#landscapeRows")).toBeNull();
    expect(empty.window.document.querySelector("#landscapePrev")).toBeNull();

    const dom = mount(Array.from({ length: 21 }, (_, i) => ({
      fullName: `acme/repo-${i}`, status: "unknown", reason: "visibility_unknown",
    })));
    dom.window.document.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    dom.window.document.querySelector("#landscapeRows tr:not([hidden])")!.remove();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    expect(visibleNames(dom)).toHaveLength(20);
    expect(dom.window.document.querySelector("#landscapeRange")?.textContent).toBe(
      "Showing 1–20 of 20 repositories"
    );
    expect(dom.window.document.querySelector<HTMLButtonElement>("#landscapeNext")!.disabled).toBe(true);
    const added = dom.window.document.createElement("tr");
    added.innerHTML = '<td>Not assessed</td><th scope="row">acme/new</th><td>Unknown</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>';
    dom.window.document.querySelector("#landscapeRows")!.appendChild(added);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    expect(dom.window.document.querySelector("#landscapeRange")?.textContent).toBe(
      "Showing 1–20 of 21 repositories"
    );
    expect(dom.window.document.querySelector<HTMLButtonElement>("#landscapeNext")!.disabled).toBe(false);
  });
});
