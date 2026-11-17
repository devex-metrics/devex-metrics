import { describe, it, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildDashboardHtml } from "./dashboard.js";
import type { OrgMetrics, RepoMetrics } from "../types.js";

function repo(
  name: string,
  issues = 0,
  pushedAt: string | undefined = new Date().toISOString()
): RepoMetrics {
  return {
    name,
    fullName: `example/${name}`,
    pushedAt,
    issues: { open: issues, closed: 0 },
    pullRequests: { open: 0, closed: 0, merged: 0 },
    pullRequestDetails: [],
    committerCount: 0,
    reviewerCount: 0,
    contributorCount: 0,
    dependentCount: 0,
  };
}

function visibleRows(document: Document): HTMLTableRowElement[] {
  return Array.from(document.querySelectorAll<HTMLTableRowElement>("#repoList tr.repo-row")).filter(
    (row) => !row.hidden && row.style.display !== "none"
  );
}

function pr(number: number, mergedAt: string) {
  return {
    number,
    title: "PR",
    state: "closed",
    createdAt: mergedAt,
    author: "tester",
    isCopilotAuthored: false,
    hasCopilotReview: false,
    mergedAt,
    linesAdded: 0,
    linesDeleted: 0,
    commentCount: 0,
    commitCount: 0,
    actionsMinutes: 0,
  };
}

function render(repos: RepoMetrics[], team?: OrgMetrics["team"], collectedAt = new Date().toISOString()) {
  const data: OrgMetrics = {
    owner: "example",
    ownerType: "org",
    collectedAt,
    repoCount: repos.length,
    repos,
    team,
  };
  const html = buildDashboardHtml(data, data.collectedAt.slice(0, 10));
  const errors: string[] = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://example.com/",
    virtualConsole: new VirtualConsole().on("jsdomError", (error: Error) =>
      errors.push(error.message)
    ),
  });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  expect(errors).toEqual([]);
  return { html, dom, doc: dom.window.document };
}

describe("repository table controls", () => {
  it("filters row totals, expanded counts, lines and the detailed sample together", () => {
    const r = repo("period");
    const dates = ["2026-11-10T00:00:00Z", "2026-09-10T00:00:00Z", "2026-06-10T00:00:00Z"];
    r.pullRequests = { open: 8, merged: 4000, closed: 500 };
    r.pullRequestDetails = dates.map((date, i) => pr(i + 1, date));
    r.mergedPRTimeline = dates.map((date, i) => ({
      number: i + 1, createdAt: date, mergedAt: date, author: "tester",
      isBotAuthor: i === 1, isCopilotAuthored: false, timeToMergeHours: 1,
      closesIssues: [], linesAdded: (i + 1) * 10, linesDeleted: i + 1,
    }));
    r.closedPRTimeline = dates.map((date, i) => ({
      number: i + 4, createdAt: date, closedAt: date, author: "tester", isBotAuthor: false,
    }));
    const { dom, doc } = render([r], undefined, "2026-11-17T12:00:00Z");
    const row = doc.querySelector<HTMLTableRowElement>(".repo-row")!;
    const detail = doc.getElementById("detail-example-period")!;
    const select = (period: string) =>
      doc.querySelector<HTMLButtonElement>(`.filter-btn[data-period="${period}"]`)!.click();
    const check = (merged: number, closed: number, lines: number, sample: number) => {
      expect(row.dataset.mergedPrs).toBe(String(merged));
      expect(row.dataset.linesAdded).toBe(String(lines));
      expect(detail.querySelector(".detail-merged-prs")?.textContent).toBe(String(merged));
      expect(detail.querySelector(".detail-closed-prs")?.textContent).toBe(String(closed));
      expect(Array.from(detail.querySelectorAll<HTMLTableRowElement>(".pr-tbl tbody tr"))
        .filter((tr) => !tr.hidden)).toHaveLength(sample);
    };
    check(1, 1, 10, 1);
    select("90days");
    check(2, 2, 30, 2);
    select("120days");
    check(2, 2, 30, 2);
    select("150days");
    check(2, 2, 30, 2);
    select("180days");
    check(3, 3, 60, 3);
    select("year");
    check(3, 3, 60, 3);
    select("all");
    check(4000, 500, 60, 3);
    select("30days");
    check(1, 1, 10, 1);
    select("180days");
    doc.querySelector<HTMLInputElement>("#excludeBots")!.click();
    check(2, 3, 40, 2);
    dom.window.close();
  });

  it("reorders a line-count sort when the selected period changes", () => {
    const old = repo("old-lines");
    const recent = repo("recent-lines");
    old.pullRequestDetails = [{ ...pr(1, "2026-09-10T00:00:00Z"), linesAdded: 100 }];
    recent.pullRequestDetails = [{ ...pr(2, "2026-11-10T00:00:00Z"), linesAdded: 10 }];
    const { dom, doc } = render([old, recent], undefined, "2026-11-17T12:00:00Z");
    doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="linesAdded"]')!.click();
    expect(visibleRows(doc).map((row) => row.dataset.repoName)).toEqual(["recent-lines", "old-lines"]);
    doc.querySelector<HTMLButtonElement>('.filter-btn[data-period="90days"]')!.click();
    expect(visibleRows(doc).map((row) => row.dataset.repoName)).toEqual(["old-lines", "recent-lines"]);
    dom.window.close();
  });

  it("labels sampled counts, missing closed timelines and incomplete line data", () => {
    const sampled = repo("sampled");
    sampled.pullRequestDetails = [pr(1, "2026-11-10T00:00:00Z")];
    const lean = repo("lean");
    lean.mergedPRTimeline = [{
      number: 2, createdAt: "2026-11-10T00:00:00Z", mergedAt: "2026-11-10T00:00:00Z",
      author: "tester", isBotAuthor: false, isCopilotAuthored: false,
      timeToMergeHours: 1, closesIssues: [],
    }];
    const { dom, doc } = render([sampled, lean], undefined, "2026-11-17T12:00:00Z");
    expect(doc.querySelector(".td-merged-prs")?.textContent).toBe("1 (sample)");
    expect(doc.querySelector(".detail-closed-prs")?.textContent).toBe("Unavailable");
    expect(doc.querySelector(".line-coverage")?.textContent).toContain("sample");
    expect(doc.querySelectorAll(".line-coverage")[1].textContent).toContain("partial");
    expect(doc.getElementById("reposPeriodNote")?.textContent).toContain("fixed windows");
    dom.window.close();
  });

  it("uses the same cap boundary for the top notice, row badge and expanded warning", () => {
    const r = repo("capped");
    r.collectionWarning = {
      state: "capped", detail: "History capped.", completeSince: "2026-09-01T00:00:00Z",
    };
    const { dom, doc } = render([r], undefined, "2026-11-17T12:00:00Z");
    const warnings = () => Array.from(doc.querySelectorAll<HTMLElement>("[data-collection-warning]"));
    expect(warnings()).toHaveLength(3);
    expect(warnings().every((el) => el.hidden && el.style.display === "none")).toBe(true);
    expect((doc.querySelector(".incomplete-notice") as HTMLElement).hidden).toBe(true);
    doc.querySelector<HTMLButtonElement>('.filter-btn[data-period="90days"]')!.click();
    expect(warnings().every((el) => !el.hidden)).toBe(true);
    expect(doc.getElementById("incompleteSummary")?.textContent).toContain("1 of 1 repository has");
    doc.querySelector<HTMLButtonElement>('.filter-btn[data-period="all"]')!.click();
    expect(warnings().every((el) => !el.hidden)).toBe(true);
    dom.window.close();
  });

  it("keeps caps at the exact cutoff, unknown caps and non-cap failures visible", () => {
    const repos = ["boundary", "unknown", "failed"].map((name) => repo(name));
    repos[0].collectionWarning = {
      state: "capped", detail: "Cap.", completeSince: "2026-10-18T12:00:00Z",
    };
    repos[1].collectionWarning = { state: "capped", detail: "Legacy cap." };
    repos[2].collectionWarning = {
      state: "partial", detail: "Failure.", completeSince: "2020-01-01T00:00:00Z",
    };
    const { dom, doc } = render(repos, undefined, "2026-11-17T12:00:00Z");
    expect(Array.from(doc.querySelectorAll<HTMLElement>("[data-collection-warning]"))
      .every((el) => !el.hidden)).toBe(true);
    expect(doc.querySelector(".incomplete-notice")?.textContent).toContain("cap date is unknown");
    for (const name of ["boundary", "unknown"]) {
      const checkbox = doc.querySelector<HTMLInputElement>(`#repoPickerList input[value="${name}"]`)!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new dom.window.Event("change"));
    }
    expect(doc.getElementById("incompleteSummary")?.textContent).toContain("2 of 2 repositories");
    dom.window.close();
  });

  it.each([0, 1, 20, 21, 143])(
    "caps %i repositories at 20 on first paint and after boot",
    (count) => {
      const repos = Array.from({ length: count }, (_, i) =>
        repo(`repo-${String(i).padStart(3, "0")}`)
      );
      const { html, dom, doc } = render(repos);
      const staticDoc = new JSDOM(html).window.document;
      expect(visibleRows(staticDoc)).toHaveLength(Math.min(count, 20));
      expect(visibleRows(doc)).toHaveLength(Math.min(count, 20));
      expect(staticDoc.getElementById("repoRange")?.textContent).toBe(
        `Showing ${count ? `1–${Math.min(count, 20)}` : "0"} of ${count} ${count === 1 ? "repository" : "repositories"}`
      );
      expect(staticDoc.querySelector(".repo-count")?.textContent).toBe(
        `${Math.min(count, 20)} of ${count} ${count === 1 ? "repository" : "repositories"} shown`
      );
      expect(doc.getElementById("repoPage")?.textContent).toBe(
        `Page 1 of ${Math.max(1, Math.ceil(count / 20))}`
      );
      expect((doc.getElementById("repoPrev") as HTMLButtonElement).disabled).toBe(true);
      expect((doc.getElementById("repoNext") as HTMLButtonElement).disabled).toBe(count <= 20);
      expect(doc.getElementById("shown")?.textContent).toBe(String(Math.min(count, 20)));
      if (count === 0) {
        expect(doc.getElementById("repoRange")?.textContent).toBe("Showing 0 of 0 repositories");
      } else {
        expect(doc.getElementById("repoRange")?.textContent).toContain("in expanded groups");
      }
      if (count > 20) {
        const next = doc.getElementById("repoNext") as HTMLButtonElement;
        next.click();
        expect(visibleRows(doc)).toHaveLength(Math.min(20, count - 20));
        expect(visibleRows(doc)[0]?.dataset.repoName).toBe("repo-020");
        for (let i = 0; i < 20; i++) next.click();
        const lastCount = count % 20 || 20;
        expect(visibleRows(doc)).toHaveLength(lastCount);
        expect(doc.getElementById("shown")?.textContent).toBe(String(lastCount));
        expect(doc.getElementById("repoPage")?.textContent).toBe(
          `Page ${Math.ceil(count / 20)} of ${Math.ceil(count / 20)}`
        );
        expect(next.disabled).toBe(true);
        (doc.getElementById("repoPrev") as HTMLButtonElement).click();
        expect(visibleRows(doc)).toHaveLength(20);
      }
      dom.window.close();
    },
    30_000
  );

  it("sorts names naturally and numbers in both directions, then restores original order", () => {
    const { dom, doc } = render([
      repo("repo-10", 2),
      repo("repo-2", 10),
      repo("repo-1", 10),
      repo("repo-3", 0),
    ]);
    const names = () => visibleRows(doc).map((row) => row.dataset.repoName);
    const sort = (key: string) =>
      doc.querySelector<HTMLButtonElement>(`.repo-sort[data-sort="${key}"]`)!;
    expect(names()).toEqual(["repo-10", "repo-2", "repo-1", "repo-3"]);
    expect((doc.getElementById("repoSort") as HTMLSelectElement).value).toBe("");
    sort("name").click();
    expect(names()).toEqual(["repo-1", "repo-2", "repo-3", "repo-10"]);
    expect(sort("name").closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(sort("name").getAttribute("aria-label")).toBe("Sort by Repository, descending");
    sort("name").click();
    expect(names()).toEqual(["repo-10", "repo-3", "repo-2", "repo-1"]);
    expect(sort("name").closest("th")?.getAttribute("aria-sort")).toBe("descending");
    sort("openIssues").click();
    expect(names()).toEqual(["repo-2", "repo-1", "repo-10", "repo-3"]);
    sort("openIssues").click();
    expect(names()).toEqual(["repo-3", "repo-10", "repo-2", "repo-1"]);
    expect(sort("name").closest("th")?.hasAttribute("aria-sort")).toBe(false);
    const select = doc.getElementById("repoSort") as HTMLSelectElement;
    select.value = "openIssues";
    select.dispatchEvent(new dom.window.Event("change"));
    expect(names()).toEqual(["repo-2", "repo-1", "repo-10", "repo-3"]);
    (doc.getElementById("repoSortReset") as HTMLButtonElement).click();
    expect(names()).toEqual(["repo-10", "repo-2", "repo-1", "repo-3"]);
    expect(select.value).toBe("");
    expect(doc.getElementById("repoSortStatus")?.textContent).toBe("Original order");
    expect((doc.getElementById("repoSortReset") as HTMLButtonElement).disabled).toBe(true);
    dom.window.close();
  });

  it("sorts pushed instants across offsets and leaves missing or malformed dates last in either direction", () => {
    const repos = [
      repo("missing"),
      repo("same-offset", 0, "2020-09-24T09:00:00-03:00"),
      repo("later-offset", 0, "2020-09-24T15:00:00+02:00"),
      repo("malformed", 0, "not-a-date"),
      repo("earlier-utc", 0, "2020-09-24T10:30:00Z"),
      repo("same-utc", 0, "2020-09-24T12:00:00Z"),
    ];
    delete repos[0].pushedAt;
    const { dom, doc } = render(repos);
    const names = () => visibleRows(doc).map((row) => row.dataset.repoName);
    const sort = doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="pushed"]')!;
    sort.click();
    expect(names()).toEqual([
      "later-offset",
      "same-offset",
      "same-utc",
      "earlier-utc",
      "missing",
      "malformed",
    ]);
    sort.click();
    expect(names()).toEqual([
      "earlier-utc",
      "same-offset",
      "same-utc",
      "later-offset",
      "missing",
      "malformed",
    ]);
    dom.window.close();
  });

  it("ranks non-ISO and overflowing pushed timestamps last in both directions", () => {
    const repos = [
      repo("invalid-calendar", 0, "2026-02-31T10:30:00Z"),
      repo("missing"),
      repo("same-offset", 0, "2026-03-03T09:00:00-03:00"),
      repo("non-iso", 0, "Sep 24 2026"),
      repo("later-offset", 0, "2026-03-03T15:00:00+02:00"),
      repo("invalid-hour", 0, "2026-03-03T24:00:00Z"),
      repo("earlier-utc", 0, "2026-03-03T10:30:00Z"),
      repo("same-utc", 0, "2026-03-03T12:00:00Z"),
    ];
    delete repos[1].pushedAt;
    const { dom, doc } = render(repos);
    const unknownNames = new Set(["invalid-calendar", "missing", "non-iso", "invalid-hour"]);
    const unknownOrder = Array.from(
      doc.querySelectorAll<HTMLTableRowElement>("#repoList tr.repo-row")
    )
      .filter((row) => unknownNames.has(row.dataset.repoName ?? ""))
      .sort((a, b) => Number(a.dataset.repoIndex) - Number(b.dataset.repoIndex))
      .map((row) => row.dataset.repoName);
    doc.querySelectorAll(".grp-hdr-row").forEach((header) => header.remove());
    (doc.getElementById("repoFilter") as HTMLInputElement).dispatchEvent(
      new dom.window.Event("input")
    );
    const names = () => visibleRows(doc).map((row) => row.dataset.repoName);
    const sort = doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="pushed"]')!;
    sort.click();
    expect(names()).toEqual([
      "later-offset",
      "same-offset",
      "same-utc",
      "earlier-utc",
      ...unknownOrder,
    ]);
    sort.click();
    expect(names()).toEqual([
      "earlier-utc",
      "same-offset",
      "same-utc",
      "later-offset",
      ...unknownOrder,
    ]);
    dom.window.close();
  });

  it("orders sub-millisecond pushed instants across offsets with stable equal-instant ties", () => {
    const { dom, doc } = render([
      repo("higher", 0, "2020-09-24T12:00:00.1239Z"),
      repo("lower-offset", 0, "2020-09-24T09:00:00.1234-03:00"),
      repo("equal-utc", 0, "2020-09-24T12:00:00.123400Z"),
      repo("whole-ms", 0, "2020-09-24T12:00:00.123Z"),
    ]);
    const names = () => visibleRows(doc).map((row) => row.dataset.repoName);
    const sort = doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="pushed"]')!;
    sort.click();
    expect(names()).toEqual(["higher", "lower-offset", "equal-utc", "whole-ms"]);
    sort.click();
    expect(names()).toEqual(["whole-ms", "lower-offset", "equal-utc", "higher"]);
    dom.window.close();
  });

  it("uses ungrouped range wording when no age-group headers are present", () => {
    const { dom, doc } = render([repo("one"), repo("two")]);
    expect(doc.getElementById("repoRange")?.textContent).toBe(
      "Showing 1–2 of 2 repositories in expanded groups"
    );
    doc.querySelectorAll(".grp-hdr-row").forEach((header) => header.remove());
    const search = doc.getElementById("repoFilter") as HTMLInputElement;
    search.dispatchEvent(new dom.window.Event("input"));
    expect(doc.getElementById("repoRange")?.textContent).toBe("Showing 1–2 of 2 repositories");
    search.value = "one";
    search.dispatchEvent(new dom.window.Event("input"));
    expect(doc.getElementById("repoRange")?.textContent).toBe("Showing 1–1 of 1 repository");
    search.value = "missing";
    search.dispatchEvent(new dom.window.Event("input"));
    expect(doc.getElementById("repoRange")?.textContent).toBe("Showing 0 of 0 repositories");
    dom.window.close();
  });

  it("filters across pages, resets on search and sort, and clamps empty results", () => {
    const { dom, doc } = render(
      Array.from({ length: 143 }, (_, i) => repo(`repo-${String(i).padStart(3, "0")}`))
    );
    const next = doc.getElementById("repoNext") as HTMLButtonElement;
    const input = doc.getElementById("repoFilter") as HTMLInputElement;
    next.click();
    input.value = "repo-0";
    input.dispatchEvent(new dom.window.Event("input"));
    expect(doc.getElementById("repoPage")?.textContent).toBe("Page 1 of 5");
    expect(doc.getElementById("repoRange")?.textContent).toContain("Showing 1–20 of 100");
    next.click();
    expect(visibleRows(doc)[0]?.dataset.repoName).toBe("repo-020");
    doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="name"]')!.click();
    expect(doc.getElementById("repoPage")?.textContent).toBe("Page 1 of 5");
    input.value = "repo-13";
    input.dispatchEvent(new dom.window.Event("input"));
    expect(doc.getElementById("repoPage")?.textContent).toBe("Page 1 of 1");
    expect(visibleRows(doc)).toHaveLength(10);
    expect(doc.getElementById("shown")?.textContent).toBe("10");
    input.value = "absent";
    input.dispatchEvent(new dom.window.Event("input"));
    expect(visibleRows(doc)).toHaveLength(0);
    expect(doc.getElementById("repoRange")?.textContent).toContain("Showing 0 of 0");
    expect(next.disabled).toBe(true);
    expect((doc.getElementById("repoPrev") as HTMLButtonElement).disabled).toBe(true);
    dom.window.close();
  }, 30_000);

  it("keeps age groups and detail rows usable across filtering and pagination", () => {
    const repos = [
      ...Array.from({ length: 25 }, (_, i) => repo(`recent-${i}`)),
      repo("older-a", 0, "2020-01-01T00:00:00Z"),
      repo("older-b", 0, "2020-02-01T00:00:00Z"),
    ];
    const { dom, doc } = render(repos);
    const next = doc.getElementById("repoNext") as HTMLButtonElement;
    const older = doc.querySelector<HTMLButtonElement>(
      '.grp-hdr-row[data-grp-id="grp-older"] button'
    )!;
    expect(older.getAttribute("aria-expanded")).toBe("false");
    expect(visibleRows(doc)).toHaveLength(20);
    next.click();
    expect(visibleRows(doc)).toHaveLength(5);
    older.click();
    expect(older.getAttribute("aria-expanded")).toBe("true");
    expect(doc.getElementById("repoPage")?.textContent).toBe("Page 1 of 2");
    next.click();
    expect(visibleRows(doc)).toHaveLength(7);
    const row = visibleRows(doc).find((r) => r.dataset.repoName === "older-a")!;
    (row.querySelector(".repo-expand-btn") as HTMLButtonElement).click();
    const detail = doc.getElementById(`detail-${row.dataset.repoId}`)!;
    expect(detail.hidden).toBe(false);
    (doc.getElementById("repoPrev") as HTMLButtonElement).click();
    expect(detail.style.display).toBe("none");
    next.click();
    expect(detail.style.display).toBe("");
    older.click();
    const search = doc.getElementById("repoFilter") as HTMLInputElement;
    search.value = "older";
    search.dispatchEvent(new dom.window.Event("input"));
    expect(visibleRows(doc)).toHaveLength(0);
    expect(older.closest("tr")?.hidden).toBe(false);
    expect(doc.getElementById("repoRange")?.textContent).toContain("2 in collapsed groups");
    older.click();
    expect(visibleRows(doc)).toHaveLength(2);
    expect(doc.getElementById("shown")?.textContent).toBe("2");
    dom.window.close();
  });

  it("reorders a merged-PR sort when the period filter changes", () => {
    const old = repo("old", 0);
    const recent = repo("recent", 0);
    old.pullRequests.merged = 2;
    old.pullRequestDetails = [pr(1, "2020-01-01T00:00:00Z"), pr(2, "2020-01-02T00:00:00Z")];
    recent.pullRequests.merged = 1;
    recent.pullRequestDetails = [pr(3, new Date().toISOString())];
    const { dom, doc } = render([old, recent]);
    expect(doc.querySelector<HTMLParagraphElement>("#detail-example-old .pr-sample-empty")?.hidden).toBe(false);
    const sort = doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="mergedPrs"]')!;
    sort.click();
    expect(visibleRows(doc).map((row) => row.dataset.repoName)).toEqual(["recent", "old"]);
    (doc.querySelector('.filter-btn[data-period="all"]') as HTMLButtonElement).click();
    expect(doc.querySelector<HTMLParagraphElement>("#detail-example-old .pr-sample-empty")?.hidden).toBe(true);
    expect(visibleRows(doc).map((row) => row.dataset.repoName)).toEqual(["old", "recent"]);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    dom.window.close();
  });

  it("keeps chart scope and picker independent of table pagination while re-sorting merged PRs", () => {
    const teamRepo = repo("team-repo");
    teamRepo.isTeamRepo = true;
    teamRepo.pullRequests.merged = 1;
    teamRepo.pullRequestDetails = [pr(1, new Date().toISOString())];
    const other = repo("other-repo");
    other.pullRequests.merged = 2;
    other.pullRequestDetails = [pr(2, new Date().toISOString()), pr(3, new Date().toISOString())];
    const repos = [teamRepo, other, ...Array.from({ length: 19 }, (_, i) => repo(`extra-${i}`))];
    const { dom, doc } = render(repos, {
      id: "team",
      name: "Team",
      repos: [teamRepo.fullName],
      discoverAll: true,
    });
    doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="mergedPrs"]')!.click();
    expect(visibleRows(doc)[0]?.dataset.repoName).toBe("other-repo");
    doc.querySelector<HTMLButtonElement>('.scope-btn[data-scope="team"]')!.click();
    expect(visibleRows(doc)[0]?.dataset.repoName).toBe("team-repo");
    expect(doc.getElementById("repoPage")?.textContent).toBe("Page 1 of 2");
    expect(doc.getElementById("shown")?.textContent).toBe("20");
    const teamCheckbox = doc.querySelector<HTMLInputElement>(
      '#repoPickerList input[value="team-repo"]'
    )!;
    teamCheckbox.checked = false;
    teamCheckbox.dispatchEvent(new dom.window.Event("change"));
    const otherCheckbox = doc.querySelector<HTMLInputElement>(
      '#repoPickerList input[value="other-repo"]'
    )!;
    otherCheckbox.checked = true;
    otherCheckbox.dispatchEvent(new dom.window.Event("change"));
    expect(visibleRows(doc)[0]?.dataset.repoName).toBe("other-repo");
    expect(doc.getElementById("repoRange")?.textContent).toContain("Showing 1–20 of 21");
    expect(doc.getElementById("shown")?.textContent).toBe("20");
    dom.window.close();
  });
});
