import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";
import { CURRENT_SCHEMA_VERSION } from "./cache.js";
import type { CacheEnvelope } from "./types.js";

describe("build-pages", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const siteDir = path.resolve(process.cwd(), "_site");
  const cacheFile = path.join(dataDir, "test-pages-owner.json");

  beforeEach(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envelope: CacheEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            issues: { open: 2, closed: 5 },
            pullRequests: { open: 1, closed: 0, merged: 3 },
            pullRequestDetails: [],
            committerCount: 2,
            reviewerCount: 1,
            contributorCount: 3,
            dependentCount: 0,
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));
  });

  afterEach(() => {
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    if (fs.existsSync(siteDir)) {
      fs.rmSync(siteDir, { recursive: true });
    }
  });

  it("should generate an HTML index page", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const indexPath = path.join(siteDir, "index.html");
    expect(fs.existsSync(indexPath)).toBe(true);
    const html = fs.readFileSync(indexPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("test-pages-owner");
    expect(html).toContain("DevEx Metrics");
  });

  it("should generate a data.json file", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const dataPath = path.join(siteDir, "data.json");
    expect(fs.existsSync(dataPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    expect(data.owner).toBe("test-pages-owner");
    expect(data.repoCount).toBe(1);
  });

  it("should generate a report.md file", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const mdPath = path.join(siteDir, "report.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    const md = fs.readFileSync(mdPath, "utf-8");
    expect(md).toContain("# DevEx Metrics");
  });

  it("should include branch and workflow run link in footer when env vars are set", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_REF_NAME: "main",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "test-org/test-repo",
        GITHUB_RUN_ID: "12345",
      },
    });
    const html = fs.readFileSync(
      path.join(siteDir, "index.html"),
      "utf-8"
    );
    expect(html).toContain("Deployed from branch");
    expect(html).toContain("main");
    expect(html).toContain(
      "https://github.com/test-org/test-repo/actions/runs/12345"
    );
    expect(html).toContain("workflow run");
  });

  it("should not include deployment info in footer when env vars are absent", () => {
    const env = { ...process.env };
    delete env.GITHUB_REF_NAME;
    delete env.GITHUB_SERVER_URL;
    delete env.GITHUB_REPOSITORY;
    delete env.GITHUB_RUN_ID;

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
      env,
    });
    const html = fs.readFileSync(
      path.join(siteDir, "index.html"),
      "utf-8"
    );
    expect(html).not.toContain("Deployed from branch");
    expect(html).not.toContain("workflow run");
  });

  it("should embed setupGroups and computeAge in the JS", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain("setupGroups");
    expect(html).toContain("computeAge");
    expect(html).toContain("utcDaysSince");
    expect(html).toContain("grp-month");
    expect(html).toContain("grp-older");
  });

  it("should include data-pushed attribute on repo cards", () => {
    const envelope: CacheEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            pushedAt: "2025-01-15T10:00:00Z",
            issues: { open: 2, closed: 5 },
            pullRequests: { open: 1, closed: 0, merged: 3 },
            pullRequestDetails: [],
            committerCount: 2,
            reviewerCount: 1,
            contributorCount: 3,
            dependentCount: 0,
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain('data-pushed="2025-01-15T10:00:00Z"');
    expect(html).toContain("bdg-age");
  });

  it("should include Merged column in PR table and sort PRs descending by mergedAt", () => {
    const envelope: CacheEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            pushedAt: "2026-03-20T10:00:00Z",
            issues: { open: 2, closed: 5 },
            pullRequests: { open: 1, closed: 0, merged: 3 },
            pullRequestDetails: [
              {
                number: 10,
                title: "Older PR",
                state: "merged",
                mergedAt: "2026-01-01T00:00:00Z",
                linesAdded: 10,
                linesDeleted: 5,
                commentCount: 1,
                commitCount: 1,
                actionsMinutes: 1,
              },
              {
                number: 20,
                title: "Newer PR",
                state: "merged",
                mergedAt: "2026-03-01T00:00:00Z",
                linesAdded: 20,
                linesDeleted: 2,
                commentCount: 2,
                commitCount: 2,
                actionsMinutes: 2,
              },
            ],
            committerCount: 2,
            reviewerCount: 1,
            contributorCount: 3,
            dependentCount: 0,
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain("<th>Merged</th>");
    expect(html).toContain("2026-03-01");
    expect(html).toContain("2026-01-01");
    // Newer PR (#20) should appear before older PR (#10) in the HTML
    const pos20 = html.indexOf("#20 Newer PR");
    const pos10 = html.indexOf("#10 Older PR");
    expect(pos20).toBeLessThan(pos10);
  });

  it("should render trend chart canvases when weeklyTrends data is present", () => {
    // Re-write the cache file with weeklyTrends data
    const envelopeWithTrends: CacheEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            issues: { open: 2, closed: 5 },
            pullRequests: { open: 1, closed: 0, merged: 3 },
            pullRequestDetails: [],
            committerCount: 2,
            reviewerCount: 1,
            contributorCount: 3,
            dependentCount: 0,
          },
        ],
        weeklyTrends: [
          { week: "2026-W11", prsOpened: 1, prsMerged: 1, issuesOpened: 2, issuesClosed: 1, linesAdded: 200, linesDeleted: 50 },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelopeWithTrends));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain('id="chartPRTrends"');
    expect(html).toContain('id="chartIssueTrends"');
    expect(html).toContain('id="chartPRSizeTrends"');
    expect(html).toContain("PR Trends");
    expect(html).toContain("Issue Trends");
    expect(html).toContain("PR Size Trends");
  });

  it("should default the Last 30 Days filter button as active", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    // Last 30 Days button should be active, All Time should not
    expect(html).toContain('class="filter-btn active" data-period="30days"');
    expect(html).not.toContain('class="filter-btn active" data-period="all"');
  });

  it("should call applyFilter on DOMContentLoaded with 30days default", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain('applyFilter("30days")');
  });

  it("should include KPI element IDs for dynamic filter updates", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain('id="kpiIssueVal"');
    expect(html).toContain('id="kpiIssueLbl"');
    expect(html).toContain('id="kpiIssueSub"');
    expect(html).toContain('id="kpiPRVal"');
    expect(html).toContain('id="kpiPRLbl"');
    expect(html).toContain('id="kpiPRSub"');
  });

  it("should build successfully without trend charts when weeklyTrends is absent", () => {
    // The beforeEach fixture has no weeklyTrends — build-pages must not crash.
    expect(() =>
      execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
        cwd: process.cwd(),
      })
    ).not.toThrow();
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    // Trend canvases are still in the HTML (always rendered); Chart.js guards
    // the actual rendering in JS when weeklyTrends is empty.
    expect(html).toContain('id="chartPRTrends"');
    expect(html).toContain('id="chartIssueTrends"');
    expect(html).toContain('id="chartPRSizeTrends"');
  });

  it("normalizes missing linesAdded/linesDeleted to 0 for old cached data", () => {
    // Simulate old cached data where weeklyTrends lacks the new fields
    const oldEnvelope: CacheEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            issues: { open: 1, closed: 2 },
            pullRequests: { open: 0, closed: 0, merged: 1 },
            pullRequestDetails: [],
            committerCount: 1,
            reviewerCount: 0,
            contributorCount: 1,
            dependentCount: 0,
          },
        ],
        weeklyTrends: [
          { week: "2026-W10", prsOpened: 2, prsMerged: 1, issuesOpened: 3, issuesClosed: 2 } as unknown as import("./types.js").WeeklyTrendPoint,
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(oldEnvelope));

    expect(() =>
      execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
        cwd: process.cwd(),
      })
    ).not.toThrow();

    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    // Normalized values should appear as 0 in the chart payload
    expect(html).toContain('"linesAdded":0');
    expect(html).toContain('"linesDeleted":0');
  });

  it("detail rows survive sort/filter — accordion opens after sorting", () => {
    // Regression: filterAndSort removed detail rows from the DOM and then called
    // document.getElementById() to find them — but detached nodes can't be found
    // that way, so the detail rows were permanently lost after the first sort.
    const envelope: CacheEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 2,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            pushedAt: "2026-03-27T10:00:00Z",
            issues: { open: 5, closed: 3 },
            pullRequests: { open: 2, closed: 0, merged: 4 },
            pullRequestDetails: [],
            committerCount: 3,
            reviewerCount: 2,
            contributorCount: 4,
            dependentCount: 1,
          },
          {
            name: "repo-b",
            fullName: "test-pages-owner/repo-b",
            pushedAt: "2026-03-26T10:00:00Z",
            issues: { open: 1, closed: 8 },
            pullRequests: { open: 0, closed: 1, merged: 2 },
            pullRequestDetails: [],
            committerCount: 1,
            reviewerCount: 0,
            contributorCount: 1,
            dependentCount: 0,
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");

    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const { window } = dom;
    const document = window.document;

    // Fire DOMContentLoaded so setupGroups / setupControls run
    document.dispatchEvent(new window.Event("DOMContentLoaded"));

    // Simulate a sort by changing the select value and dispatching "change"
    const sortSelect = document.getElementById("repoSort") as HTMLSelectElement;
    expect(sortSelect).not.toBeNull();
    sortSelect.value = "openIssues";
    sortSelect.dispatchEvent(new window.Event("change"));

    // After sort, every detail row should still be in the document
    const dataRows = Array.from(
      document.querySelectorAll<HTMLElement>("tr.repo-row")
    );
    expect(dataRows.length).toBe(2);

    for (const row of dataRows) {
      const repoId = row.dataset.repoId!;
      const detailRow = document.getElementById(`detail-${repoId}`);
      expect(detailRow).not.toBeNull();

      // Simulate clicking the expand button
      const btn = row.querySelector<HTMLElement>(".repo-expand-btn");
      expect(btn).not.toBeNull();
      btn!.click();

      // Detail row should now be visible (hidden removed, no display:none)
      expect(detailRow!.hidden).toBe(false);
      expect(detailRow!.style.display).not.toBe("none");
    }
  });

  it("should fall back to fixture file when no daily cache is present", () => {
    const fixtureFile = path.join(dataDir, "test-pages-owner.fixture.json");
    // Remove the daily cache so only the fixture is available
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    try {
      const fixtureData = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T08:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "fixture-repo",
            fullName: "test-pages-owner/fixture-repo",
            issues: { open: 1, closed: 2 },
            pullRequests: { open: 0, closed: 0, merged: 1 },
            pullRequestDetails: [],
            committerCount: 1,
            reviewerCount: 0,
            contributorCount: 1,
            dependentCount: 0,
          },
        ],
      };
      fs.writeFileSync(fixtureFile, JSON.stringify(fixtureData));

      execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
        cwd: process.cwd(),
      });

      const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
      expect(html).toContain("test-pages-owner");
      expect(html).toContain("fixture-repo");
    } finally {
      if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
    }
  });

  it("should exit with error when fixture has a stale schema version", () => {
    const fixtureFile = path.join(dataDir, "test-pages-owner.fixture.json");
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    try {
      const staleFixture = {
        schemaVersion: 1,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T08:00:00Z",
        repoCount: 1,
        repos: [],
      };
      fs.writeFileSync(fixtureFile, JSON.stringify(staleFixture));

      expect(() =>
        execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
          cwd: process.cwd(),
        })
      ).toThrow();
    } finally {
      if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
    }
  });

  it("should exit with error when cache file has a stale schema version", () => {
    const staleEnvelope = {
      date: "2026-03-28",
      data: {
        schemaVersion: 1,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-03-28T12:00:00Z",
        repoCount: 0,
        repos: [],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(staleEnvelope));

    expect(() =>
      execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
        cwd: process.cwd(),
      })
    ).toThrow();
  });

  it("should initialise KPI panels with 30-day values to prevent load-time flicker", () => {
    // collectedAt = 2026-04-01T12:00:00Z → 30d cutoff = 2026-03-02T12:00:00Z
    // W09 Monday = 2026-02-23 → before cutoff (excluded)
    // W11 Monday = 2026-03-09 → after cutoff (included)
    // W13 Monday = 2026-03-23 → after cutoff (included)
    const envelope: CacheEnvelope = {
      date: "2026-04-01",
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        owner: "test-pages-owner",
        ownerType: "org",
        collectedAt: "2026-04-01T12:00:00Z",
        repoCount: 1,
        repos: [
          {
            name: "repo-a",
            fullName: "test-pages-owner/repo-a",
            // All-time totals deliberately differ from 30d values
            issues: { open: 15, closed: 20 },
            pullRequests: { open: 3, closed: 2, merged: 10 },
            pullRequestDetails: [],
            mergedPRTimeline: [
              // Before cutoff — must NOT appear in 30d KPIs
              { number: 1, createdAt: "2026-01-14T00:00:00Z", mergedAt: "2026-01-15T00:00:00Z", author: "dev", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 100, closesIssues: [] },
              // After cutoff — must appear in 30d KPIs
              { number: 2, createdAt: "2026-03-14T00:00:00Z", mergedAt: "2026-03-15T00:00:00Z", author: "dev", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 24, closesIssues: [] },
              { number: 3, createdAt: "2026-03-24T00:00:00Z", mergedAt: "2026-03-25T00:00:00Z", author: "dev", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 48, closesIssues: [] },
            ],
            committerCount: 2,
            reviewerCount: 1,
            contributorCount: 3,
            dependentCount: 0,
          },
        ],
        weeklyTrends: [
          // Excluded (before cutoff)
          { week: "2026-W09", prsOpened: 5, prsMerged: 4, issuesOpened: 10, issuesClosed: 8, linesAdded: 100, linesDeleted: 40 },
          // Included (after cutoff): issuesOpened=5, issuesClosed=3, prsOpened=4
          { week: "2026-W11", prsOpened: 4, prsMerged: 3, issuesOpened: 5, issuesClosed: 3, linesAdded: 80, linesDeleted: 20 },
          // Included: issuesOpened=3, issuesClosed=2, prsOpened=2
          { week: "2026-W13", prsOpened: 2, prsMerged: 2, issuesOpened: 3, issuesClosed: 2, linesAdded: 50, linesDeleted: 10 },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");

    // Parse without running JS to check the server-rendered initial values
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // 30d issuesOpened = 5 + 3 = 8; issuesClosed = 3 + 2 = 5
    expect(document.getElementById("kpiIssueVal")?.textContent).toBe("8");
    expect(document.getElementById("kpiIssueLbl")?.textContent).toBe("Issues Opened");
    expect(document.getElementById("kpiIssueSub")?.textContent).toBe("5 closed");

    // 30d prsMerged = 2 (PR#2 and PR#3); prsOpened = 4 + 2 = 6
    expect(document.getElementById("kpiPRVal")?.textContent).toBe("2");
    expect(document.getElementById("kpiPRSub")?.textContent).toBe("6 opened");

    // 30d cycle time: median([24, 48]) = 36h → formats as "1.5d" (36 ≥ 24h)
    expect(document.getElementById("kpiCycleVal")?.textContent).toBe("1.5d");

    // Sanity-check: all-time values must NOT appear in these elements
    expect(document.getElementById("kpiIssueVal")?.textContent).not.toBe("15");
    expect(document.getElementById("kpiPRVal")?.textContent).not.toBe("10");
  });
});
