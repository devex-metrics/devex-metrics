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

function render(repos: RepoMetrics[], team?: OrgMetrics["team"]) {
  const data: OrgMetrics = {
    owner: "example",
    ownerType: "org",
    collectedAt: new Date().toISOString(),
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
      expect(doc.getElementById("repoPage")?.textContent).toBe(
        `Page 1 of ${Math.max(1, Math.ceil(count / 20))}`
      );
      expect((doc.getElementById("repoPrev") as HTMLButtonElement).disabled).toBe(true);
      expect((doc.getElementById("repoNext") as HTMLButtonElement).disabled).toBe(count <= 20);
      expect(doc.getElementById("shown")?.textContent).toBe(String(Math.min(count, 20)));
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

  it("sorts ISO dates chronologically and leaves missing dates last in either direction", () => {
    const repos = [
      repo("missing"),
      repo("old", 0, "2020-01-01T00:00:00Z"),
      repo("new", 0, "2020-12-31T00:00:00Z"),
    ];
    delete repos[0].pushedAt;
    const { dom, doc } = render(repos);
    const names = () => visibleRows(doc).map((row) => row.dataset.repoName);
    const sort = doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="pushed"]')!;
    sort.click();
    expect(names()).toEqual(["new", "old", "missing"]);
    sort.click();
    expect(names()).toEqual(["old", "new", "missing"]);
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
    const sort = doc.querySelector<HTMLButtonElement>('.repo-sort[data-sort="mergedPrs"]')!;
    sort.click();
    expect(visibleRows(doc).map((row) => row.dataset.repoName)).toEqual(["recent", "old"]);
    (doc.querySelector('.filter-btn[data-period="all"]') as HTMLButtonElement).click();
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
