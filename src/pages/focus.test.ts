import { JSDOM, VirtualConsole } from "jsdom";
import { buildDashboardHtml } from "./dashboard.js";
import { classifyFocusAuthor } from "./focus.js";
import type { MergedPRSummary, OrgMetrics, RepoMetrics } from "../types.js";

function pr(number: number, author: string, extra: Partial<MergedPRSummary> = {}): MergedPRSummary {
  return {
    number, author, createdAt: "2026-11-14T00:00:00Z", mergedAt: "2026-11-15T00:00:00Z",
    isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 24,
    closesIssues: [], linesAdded: 10, linesDeleted: 2,
    firstReviewAt: "2026-11-14T06:00:00Z", reviewCount: 1, ...extra,
  };
}

function repo(name: string, timeline: MergedPRSummary[]): RepoMetrics {
  return {
    name, fullName: `example/${name}`, issues: { open: 8, closed: 20 },
    pullRequests: { open: 2, merged: 4000, closed: 50 }, pullRequestDetails: [],
    mergedPRTimeline: timeline, closedPRTimeline: [],
    contributorCount: 4, committerCount: 3, reviewerCount: 2, dependentCount: 0,
  };
}

function sample(): OrgMetrics {
  const mono = repo("mono", [
    pr(1, "AlIcE_team"),
    pr(2, "bob", { timeToMergeHours: 48, linesAdded: 30, linesDeleted: 4,
      firstReviewAt: "2026-11-15T00:00:00Z", reviewCount: 3 }),
    pr(3, "ghost", { timeToMergeHours: 72, firstReviewAt: undefined, linesAdded: 5, linesDeleted: 1 }),
    pr(4, "build-bot[bot]", { isBotAuthor: true, isCopilotAuthored: true, timeToMergeHours: 12,
      linesAdded: 100, linesDeleted: 10 }),
    pr(5, "alice_team", { createdAt: "2026-09-10T00:00:00Z", mergedAt: "2026-09-10T06:00:00Z",
      firstReviewAt: undefined, timeToMergeHours: 6, linesAdded: 20 }),
  ]);
  mono.closedPRTimeline = [{
    number: 10, author: "alice_team", createdAt: "2026-11-14T00:00:00Z",
    closedAt: "2026-11-16T00:00:00Z", isBotAuthor: false,
  }];
  mono.collectionWarning = {
    state: "capped", detail: "History capped.", completeSince: "2026-10-25T00:00:00Z",
  };
  return {
    owner: "example", ownerType: "org", collectedAt: "2026-11-17T12:00:00Z", repoCount: 2,
    repos: [mono, repo("other", [pr(6, "carol", { timeToMergeHours: 60, linesAdded: 12 })])],
  };
}

function render(data = sample(), configured = true, search = "", users = ["ALICE_team", "build-bot[bot]", "unused_roster"]) {
  const html = buildDashboardHtml(data, "2026-11-17", undefined, undefined,
    configured ? { focus: { name: "Example group", users } } : {});
  const errors: string[] = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: `https://example.com/${search}`,
    virtualConsole: new VirtualConsole().on("jsdomError", (error: Error) => errors.push(error.message)),
  });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  const doc = dom.window.document;
  const compare = () => doc.querySelector<HTMLButtonElement>('[data-comparison="focus"]')!.click();
  const metric = (key: string) => Array.from(doc.querySelectorAll(`#focusMetricRows [data-metric="${key}"] td`))
    .map((cell) => cell.firstChild?.textContent);
  const period = (value: string) => doc.querySelector<HTMLButtonElement>(`.filter-btn[data-period="${value}"]`)!.click();
  expect(errors).toEqual([]);
  return { dom, doc, html, errors, compare, metric, period };
}

describe("PR-author focus comparison", () => {
  it("reclassifies the same snapshot at build time without modifying the raw dataset", () => {
    const data = sample();
    const before = JSON.stringify(data);
    const first = render(data);
    first.compare();
    expect(first.metric("merged")).toEqual(["2", "2", "0"]);
    first.dom.window.close();
    const second = render(data, true, "", ["BOB"]);
    second.compare();
    expect(second.metric("merged")).toEqual(["1", "3", "-2"]);
    expect(JSON.stringify(data)).toBe(before);
    second.dom.window.close();
  });

  it("keeps unavailable identities separate from known non-members, including EMU logins", () => {
    const roster = new Set(["alice_team", "build-bot[bot]"]);
    expect(classifyFocusAuthor(" ALICE_team ", roster)).toBe("focus");
    expect(classifyFocusAuthor("BOB", roster)).toBe("rest");
    expect(classifyFocusAuthor("build-bot[bot]", roster)).toBe("focus");
    for (const author of ["", " ", "unknown", "Ghost", "[deleted]"]) {
      expect(classifyFocusAuthor(author, roster)).toBe("unknown");
    }
  });

  it("compares disjoint cohorts in charts and table without changing the configured roster into page data", () => {
    const { dom, doc, html, compare, metric, errors, period } = render();
    expect(html).not.toContain("unused_roster");
    expect(doc.getElementById("focusComparison")!.hidden).toBe(true);
    const configurations = new Map<string, { data: { labels: string[]; datasets: { data: (number | null)[] }[] } }>();
    Object.assign(dom.window, {
      Chart: class {
        data: { labels: string[]; datasets: { data: (number | null)[] }[] };
        options = { plugins: {} };
        constructor(canvas: HTMLCanvasElement, config: typeof configurations extends Map<string, infer T> ? T : never) {
          configurations.set(canvas.id, config);
          this.data = config.data;
        }
        update() {}
      },
    });
    compare();
    expect(metric("merged")).toEqual(["2", "2", "0"]);
    expect(metric("cycle")).toEqual(["18.0hr", "2.3d", "-1.5d"]);
    expect(metric("added")).toEqual(["110", "42", "+68"]);
    expect(metric("abandonment")).toEqual(["33.3%", "0.0%", "+33.3 pp"]);
    expect(configurations.get("focusPRShare")!.data.datasets[0].data).toEqual([2, 2, 1]);
    expect(configurations.get("focusWeekly")!.data.datasets.map((dataset) => dataset.data)).toEqual([[2], [2], [1]]);
    expect(configurations.get("focusCycle")!.data.datasets.map((dataset) => dataset.data)).toEqual([[18], [54]]);
    expect(configurations.get("focusLines")!.data.datasets.map((dataset) => dataset.data)).toEqual([[110], [12], [42], [6]]);
    expect(doc.querySelector('[data-repo-name="mono"] .focus-repo-cell')!.textContent).toBe("2 / 1 / 150.0% focus");
    expect(doc.getElementById("focusCoverage")!.textContent).toContain("unknown author 1");
    expect(doc.querySelector("#chartPRs")!.closest(".card")!.classList.contains("focus-all-hidden")).toBe(true);
    expect(doc.querySelector("#chartIssues")!.closest(".card")!.textContent).toContain("Repository-wide context");
    period("all");
    expect(configurations.get("focusPRShare")!.data.datasets[0].data).toEqual([3, 2, 1]);
    expect(metric("merged")).toEqual(["3", "2", "+1"]);
    expect(errors).toEqual([]);
    dom.window.close();
  });

  it("reuses periods, bot exclusion and repository filters, restoring lifetime All authors totals on exit", () => {
    const { dom, doc, compare, metric, period, errors } = render();
    compare();
    const mono = doc.querySelector<HTMLTableRowElement>('[data-repo-name="mono"]')!;
    expect(mono.dataset.mergedPrs).toBe("4");
    period("all");
    expect(metric("merged")).toEqual(["3", "2", "+1"]);
    expect(mono.dataset.mergedPrs).toBe("5");
    doc.querySelector<HTMLInputElement>("#excludeBots")!.click();
    expect(metric("merged")).toEqual(["2", "2", "0"]);
    const repoCheckbox = doc.querySelector<HTMLInputElement>('#repoPickerList input[value="mono"]')!;
    repoCheckbox.checked = true;
    repoCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(metric("merged")).toEqual(["2", "1", "+1"]);
    expect(new URL(dom.window.location.href).searchParams.get("comparison")).toBe("focus");
    doc.querySelector<HTMLButtonElement>("#repoPickerReset")!.click();
    doc.querySelector<HTMLInputElement>("#excludeBots")!.click();
    doc.querySelector<HTMLButtonElement>('[data-comparison="all"]')!.click();
    expect(mono.dataset.mergedPrs).toBe("4000");
    expect(doc.querySelector<HTMLElement>(".focus-repo-cell")!.hidden).toBe(true);
    expect(doc.getElementById("focusRepoNote")!.hidden).toBe(true);
    expect(doc.querySelector("#chartPRs")!.closest(".card")!.classList.contains("focus-all-hidden")).toBe(false);
    expect(new URL(dom.window.location.href).searchParams.has("comparison")).toBe(false);
    expect(errors).toEqual([]);
    dom.window.close();
  });

  it("restores shared comparison state and keeps cap warnings for an affected period", () => {
    const { dom, doc, metric, errors } = render(sample(), true, "?comparison=focus&period=all&bots=exclude&repos=mono");
    expect(doc.querySelector('[data-comparison="focus"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(metric("merged")).toEqual(["2", "1", "+1"]);
    expect(doc.querySelector<HTMLElement>(".incomplete-notice")!.hidden).toBe(false);
    expect(doc.querySelector(".repo-detail-cell")!.getAttribute("colspan")).toBe("10");
    expect(errors).toEqual([]);
    dom.window.close();
  });

  it("does not invent zero measurements or merge unknown authors into rest", () => {
    const data = sample();
    data.repos = [repo("empty-evidence", [pr(1, "alice_team", {
      linesAdded: 10, linesDeleted: undefined, firstReviewAt: undefined, reviewCount: undefined,
    }), pr(2, "unknown")])];
    data.repos[0].closedPRTimeline = undefined;
    const { dom, doc, compare, metric } = render(data);
    compare();
    expect(metric("merged")).toEqual(["1", "0", "+1"]);
    expect(metric("added")).toEqual(["10", "Unavailable", "Unavailable"]);
    expect(metric("deleted")).toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(metric("size")).toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(metric("review")).toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(metric("abandonment")).toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(doc.getElementById("focusCoverage")!.textContent).toContain("unknown author 1");
    dom.window.close();
  });

  it("excludes incomplete post-review samples and retains measured zeroes with their sample sizes", () => {
    const data = sample();
    data.repos = [repo("rework", [
      pr(1, "alice_team", { conversationCommentCount: 0, reviewThreadCount: 0,
        recentCommitDates: ["2026-11-14T07:00:00Z"], totalCommitCount: 10 }),
      pr(2, "bob", { conversationCommentCount: 2, reviewThreadCount: 1,
        recentCommitDates: ["2026-11-14T07:00:00Z"], totalCommitCount: 1 }),
    ])];
    const { dom, doc, compare, metric } = render(data);
    compare();
    expect(metric("postReview")).toEqual(["Unavailable", "1.0", "Unavailable"]);
    expect(metric("comments")).toEqual(["0.0", "2.0", "-2.0"]);
    expect(doc.querySelector('[data-metric="comments"] .focus-sample')!.textContent).toBe(" (n=1)");
    expect(metric("threads")).toEqual(["0.0", "1.0", "-1.0"]);
    dom.window.close();
  });

  it("labels detailed-only samples and excludes them when bot attribution is unavailable", () => {
    const data = sample();
    const fallback = repo("fallback", []);
    fallback.mergedPRTimeline = undefined;
    fallback.pullRequestDetails = [{
      number: 1, title: "PR", author: "alice_team", state: "merged",
      createdAt: "2026-11-14T00:00:00Z", mergedAt: "2026-11-15T00:00:00Z",
      isCopilotAuthored: false, hasCopilotReview: false, linesAdded: 0, linesDeleted: 0,
      commentCount: 0, commitCount: 1, actionsMinutes: 0,
    }];
    data.repos = [fallback];
    const { dom, doc, compare, metric, errors } = render(data);
    compare();
    expect(metric("merged")).toEqual(["1", "0", "+1"]);
    expect(metric("cycle")).toEqual(["Unavailable", "Unavailable", "Unavailable"]);
    expect(metric("added")[0]).toBe("0");
    expect(doc.getElementById("focusCoverage")!.textContent).toContain("detailed PR sample");
    doc.querySelector<HTMLInputElement>("#excludeBots")!.click();
    expect(metric("merged")).toEqual(["0", "0", "0"]);
    expect(doc.querySelector<HTMLElement>(".td-merged-prs")!.textContent).toBe("0 (sample)");
    expect(errors).toEqual([]);
    dom.window.close();
  });

  it("ignores comparison URLs and preserves the existing view when no group is configured", () => {
    const { dom, doc } = render(sample(), false, "?comparison=focus&period=all");
    expect(doc.getElementById("focusComparison")).toBeNull();
    expect(doc.querySelector(".focus-mode-btn")).toBeNull();
    expect(doc.querySelector<HTMLTableRowElement>(".repo-row")!.dataset.mergedPrs).toBe("4000");
    expect(new URL(dom.window.location.href).searchParams.has("comparison")).toBe(false);
    dom.window.close();
  });
});
