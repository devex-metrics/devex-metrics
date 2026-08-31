import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { JSDOM, VirtualConsole } from "jsdom";
import { CURRENT_SCHEMA_VERSION } from "./cache.js";
import type { CacheEnvelope, WeeklyTrendPoint } from "./types.js";

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

  it("should apply the filter from the URL on DOMContentLoaded, defaulting to 30days", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain("applyFilter(readStateFromUrl())");
    // readStateFromUrl falls back to the 30-day view when no period is given.
    expect(html).toContain('period="30days"');
  });

  it("should ship the share-link control and URL state helpers", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain('id="shareBtn"');
    expect(html).toContain("function writeStateToUrl");
    expect(html).toContain("window.history.replaceState");
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

  it("sums per-repo Lines +/- across the full mergedPRTimeline, not just the 10 detailed PRs", () => {
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
            issues: { open: 0, closed: 0 },
            pullRequests: { open: 0, closed: 0, merged: 5 },
            pullRequestDetails: [
              {
                number: 1,
                title: "Latest",
                state: "merged",
                createdAt: "2026-03-01T00:00:00Z",
                author: "alice",
                isCopilotAuthored: false,
                hasCopilotReview: false,
                mergedAt: "2026-03-02T00:00:00Z",
                linesAdded: 100,
                linesDeleted: 10,
                commentCount: 0,
                commitCount: 1,
                actionsMinutes: 0,
              },
            ],
            mergedPRTimeline: [
              { number: 1, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-02T00:00:00Z", author: "alice", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 24, closesIssues: [], linesAdded: 100, linesDeleted: 10 },
              { number: 2, createdAt: "2026-02-01T00:00:00Z", mergedAt: "2026-02-02T00:00:00Z", author: "alice", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 24, closesIssues: [], linesAdded: 200, linesDeleted: 20 },
              { number: 3, createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-02T00:00:00Z", author: "alice", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 24, closesIssues: [], linesAdded: 300, linesDeleted: 30 },
            ],
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
    // Sum across timeline: 100+200+300 added, 10+20+30 deleted.
    expect(html).toContain('data-lines-added="600"');
    expect(html).toContain('data-lines-deleted="60"');
  });

  it("falls back to pullRequestDetails for Lines +/- when timeline lacks line counts", () => {
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
            issues: { open: 0, closed: 0 },
            pullRequests: { open: 0, closed: 0, merged: 1 },
            pullRequestDetails: [
              {
                number: 1, title: "x", state: "merged",
                createdAt: "2026-03-01T00:00:00Z", author: "a",
                isCopilotAuthored: false, hasCopilotReview: false,
                mergedAt: "2026-03-02T00:00:00Z",
                linesAdded: 42, linesDeleted: 7,
                commentCount: 0, commitCount: 1, actionsMinutes: 0,
              },
            ],
            // Timeline present but without linesAdded/linesDeleted (REST fallback)
            mergedPRTimeline: [
              { number: 1, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-02T00:00:00Z", author: "a", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 24, closesIssues: [] },
            ],
            committerCount: 1, reviewerCount: 0, contributorCount: 1, dependentCount: 0,
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    expect(html).toContain('data-lines-added="42"');
    expect(html).toContain('data-lines-deleted="7"');
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
          { week: "2026-W10", prsOpened: 2, prsMerged: 1, issuesOpened: 3, issuesClosed: 2 } as unknown as WeeklyTrendPoint,
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

      // Fixtures are opt-in: without the flag the build treats this as "nothing
      // collected yet" and skips publishing, rather than silently publishing
      // data of unknown age OR failing the deploy of a fresh site.
      const skipped = execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
        cwd: process.cwd(),
        encoding: "utf-8",
      });
      expect(skipped).toContain("Nothing collected for");
      expect(skipped).toContain("fixtures are opt-in");

      execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
        cwd: process.cwd(),
        env: { ...process.env, DEVEX_USE_FIXTURE: "1" },
      });

      const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
      expect(html).toContain("test-pages-owner");
      expect(html).toContain("fixture-repo");
    } finally {
      if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
    }
  });

  it("should exit with error when an opted-in fixture has a stale schema version", () => {
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

      // The stale-schema guard only applies once fixtures are opted into.
      // Without the flag the fixture is ignored entirely and the build reports
      // "nothing collected yet" instead — covered separately.
      expect(() =>
        execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
          cwd: process.cwd(),
          stdio: "pipe",
          env: { ...process.env, DEVEX_USE_FIXTURE: "1" },
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

    // 30d cycle time: median([24, 48]) = 36h → formats as "1.5days" (36 ≥ 24h)
    expect(document.getElementById("kpiCycleVal")?.textContent).toBe("1.5days");

    // Sanity-check: all-time values must NOT appear in these elements
    expect(document.getElementById("kpiIssueVal")?.textContent).not.toBe("15");
    expect(document.getElementById("kpiPRVal")?.textContent).not.toBe("10");
  });

  it("should include repoWeeklyTrends in the CHART_DATA payload when repos have per-repo trends", () => {
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
            weeklyTrends: [
              { week: "2026-W12", prsOpened: 1, prsMerged: 1, issuesOpened: 4, issuesClosed: 2, linesAdded: 20, linesDeleted: 5 },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");

    // repoWeeklyTrends should be embedded in the payload with all trend fields
    expect(html).toContain('"repoWeeklyTrends"');
    expect(html).toContain('"repo-a"');
    expect(html).toContain('"issuesOpened":4');
    expect(html).toContain('"issuesClosed":2');
    // PR and line data should also appear in the repo trend payload so the
    // "Opened" dataset can be shown when a single repo is selected.
    expect(html).toContain('"prsOpened":1');
    expect(html).toContain('"prsMerged":1');
    expect(html).toContain('"linesAdded":20');
    expect(html).toContain('"linesDeleted":5');
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelector(".trends-org-note")).toBeNull();
  });

  it("should render Agent Tasks KPI card and chart canvases", () => {
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
            copilotAgentMetrics: {
              totalTasks: 5,
              completedTasks: 3,
              failedTasks: 1,
              cancelledTasks: 0,
              timedOutTasks: 0,
              activeTasksCount: 1,
              totalSessions: 8,
              cloudAgentSessions: 6,
              cliRemoteSessions: 2,
              totalCreditsUsed: 12.5,
              avgCompletedSessionHours: 0.75,
              agentCreatedPRs: 3,
            },
          },
        ],
      },
    };
    fs.writeFileSync(cacheFile, JSON.stringify(envelope));

    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");

    // KPI card elements
    expect(html).toContain('id="kpiAgentVal"');
    expect(html).toContain('id="kpiAgentSub"');
    expect(html).toContain("Agent Tasks (30d)");
    // KPI should show total task count and summary
    expect(html).toContain(">5<");
    expect(html).toContain("3 completed");
    expect(html).toContain("3 PRs");

    // New chart canvases
    expect(html).toContain('id="chartCopilotPRTrend"');
    expect(html).toContain('id="chartAgentTasks"');
    expect(html).toContain("Copilot-authored PRs merged per week");
    expect(html).toContain("Agent Tasks by Repository");
  });

  it("should add data-agent-tasks attribute and Agent Tasks column to repo table", () => {
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
            name: "repo-with-agent",
            fullName: "test-pages-owner/repo-with-agent",
            issues: { open: 1, closed: 2 },
            pullRequests: { open: 0, closed: 0, merged: 1 },
            pullRequestDetails: [],
            committerCount: 1,
            reviewerCount: 0,
            contributorCount: 1,
            dependentCount: 0,
            copilotAgentMetrics: {
              totalTasks: 7,
              completedTasks: 3,
              failedTasks: 2,
              cancelledTasks: 1,
              timedOutTasks: 1,
              activeTasksCount: 0,
              totalSessions: 10,
              cloudAgentSessions: 10,
              cliRemoteSessions: 0,
              totalCreditsUsed: 20.0,
              agentCreatedPRs: 5,
            },
          },
          {
            name: "repo-no-agent",
            fullName: "test-pages-owner/repo-no-agent",
            issues: { open: 0, closed: 1 },
            pullRequests: { open: 0, closed: 0, merged: 0 },
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

    // Column header should be present
    expect(html).toContain("Agent Tasks");
    expect(html).toContain('data-sort="agentTasks"');
    expect(html).toContain('<option value="agentTasks">');

    // data-agent-tasks attribute on repo rows
    expect(html).toContain('data-agent-tasks="7"');
    expect(html).toContain('data-agent-tasks="0"');

    // detail row should use colspan=9
    expect(html).toContain('colspan="9"');

    // group header rows should use colspan=9
    expect(html).toContain('colspan="9" class="grp-hdr-cell"');

    // CHART_DATA should include agent byRepo data
    expect(html).toContain('"repo-with-agent"');
    expect(html).toContain('"totalTasks":7');

    // CHART_DATA should include owner for constructing GitHub task URLs
    expect(html).toContain('"owner":"test-pages-owner"');

    // Chart click handler should navigate to /agents for the repo (bar click and label click)
    expect(html).toContain("/agents");
    expect(html).toContain("CHART_DATA.owner");
    // Y-axis label click detection should be present
    expect(html).toContain("yAxis.getPixelForTick");

    // Extended detail fields should be present for repo with agent data
    expect(html).toContain("Cancelled");
    expect(html).toContain("Timed out");

    const dom = new JSDOM(html);
    const doc = dom.window.document;
    // Repo with agent tasks should show count in table cell
    const repoRow = Array.from(doc.querySelectorAll<HTMLElement>("tr.repo-row")).find(
      r => r.dataset.repoName === "repo-with-agent"
    );
    expect(repoRow).toBeDefined();
    expect(repoRow!.dataset.agentTasks).toBe("7");
  });

  it("should show – for repos with no agent data in Agent Tasks column", () => {
    execFileSync("node", ["dist/build-pages.js", "test-pages-owner"], {
      cwd: process.cwd(),
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    // The default fixture has no copilotAgentMetrics, so should show dash
    expect(html).toContain('data-agent-tasks="0"');
    // KPI shows – when no agent data
    expect(html).toContain('id="kpiAgentVal"');
    const dom = new JSDOM(html);
    expect(dom.window.document.getElementById("kpiAgentVal")?.textContent).toBe("–");
  });
});

describe("build-pages · trial and branding", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const siteDir = path.resolve(process.cwd(), "_site");
  const cacheFile = path.join(dataDir, "trial-owner.json");

  function repoStub(name: string) {
    return {
      name,
      fullName: `trial-owner/${name}`,
      issues: { open: 1, closed: 1 },
      pullRequests: { open: 0, closed: 0, merged: 1 },
      pullRequestDetails: [],
      mergedPRTimeline: [
        {
          number: 1,
          createdAt: "2026-08-20T00:00:00Z",
          mergedAt: "2026-08-22T00:00:00Z",
          author: "alice",
          isBotAuthor: false,
          isCopilotAuthored: false,
          timeToMergeHours: 48,
          closesIssues: [],
          linesAdded: 10,
          linesDeleted: 2,
        },
      ],
      committerCount: 1,
      reviewerCount: 1,
      contributorCount: 1,
      dependentCount: 0,
    };
  }

  beforeEach(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        date: "2026-08-30",
        data: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          owner: "trial-owner",
          ownerType: "org",
          collectedAt: "2026-08-30T00:00:00.000Z",
          repoCount: 2,
          repos: [repoStub("api"), repoStub("billing")],
          weeklyTrends: [],
        },
      })
    );
  });

  afterEach(() => {
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  });

  function build(extraEnv: Record<string, string>) {
    execFileSync("node", ["dist/build-pages.js", "trial-owner"], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
    });
    return fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
  }

  it("omits the trial panel when no trial is configured", () => {
    const html = build({});
    expect(html).not.toContain('<section class="trial"');
    expect(html).not.toContain('class="trial-eyebrow"');
  });

  it("renders the trial panel from Actions variables alone", () => {
    const html = build({
      DEVEX_TRIAL_TITLE: "Trunk-based development",
      DEVEX_TRIAL_START: "2026-05-01",
      DEVEX_TRIAL_HYPOTHESIS: "Smaller PRs shorten review latency",
      DEVEX_TEAM_NAME: "Team Alpha",
      DEVEX_TEAM_REPOS: "trial-owner/api",
    });
    expect(html).toContain('<section class="trial"');
    expect(html).toContain('<div class="trial-eyebrow">Improvement trial</div>');
    expect(html).toContain("Trunk-based development");
    expect(html).toContain("Smaller PRs shorten review latency");
    expect(html).toContain("Team Alpha");
    expect(html).toContain("started 2026-05-01");
  });

  it("scopes the team from the current config rather than the stored data", () => {
    const html = build({
      DEVEX_TEAM_NAME: "Team Alpha",
      DEVEX_TEAM_REPOS: "trial-owner/api",
    });
    const payload = JSON.parse(
      /CHART_DATA\s*=\s*(\{[\s\S]*?\});/.exec(html)![1]
    );
    expect(payload.teamRepos).toEqual(["api"]);
    expect(payload.team.name).toBe("Team Alpha");
  });

  it("renders milestones when configured", () => {
    const html = build({
      DEVEX_TRIAL_TITLE: "Trunk-based development",
      DEVEX_TRIAL_MILESTONES: "2026-05-15=Training complete",
    });
    expect(html).toContain("Training complete");
    expect(html).toContain("2026-05-15");
  });

  it("applies configured branding to the title and attribution", () => {
    const html = build({
      DEVEX_TITLE: "Acme DevEx",
      DEVEX_ATTRIBUTION: "Built by Acme Platform",
      DEVEX_ATTRIBUTION_URL: "https://example.com/platform",
    });
    expect(html).toContain("<title>Acme DevEx &ndash; trial-owner</title>");
    expect(html).toContain("Built by Acme Platform");
    expect(html).toContain("https://example.com/platform");
  });

  it("keeps the default attribution when none is configured", () => {
    const html = build({});
    expect(html).toContain("Made with");
    expect(html).toContain("rajbos");
  });

  it("offers the team scope toggle only when the team has repos", () => {
    expect(build({})).not.toContain('data-scope="team"');
    const withTeam = build({
      DEVEX_TEAM_NAME: "Team Alpha",
      DEVEX_TEAM_REPOS: "trial-owner/api",
    });
    expect(withTeam).toContain('data-scope="team"');
  });
});

describe("build-pages · dashboard JS executes", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const siteDir = path.resolve(process.cwd(), "_site");
  const cacheFile = path.join(dataDir, "js-owner.json");

  beforeEach(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        date: "2026-08-30",
        data: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          owner: "js-owner",
          ownerType: "org",
          collectedAt: "2026-08-30T00:00:00.000Z",
          repoCount: 2,
          repos: ["api", "billing"].map((name, i) => ({
            name,
            fullName: `js-owner/${name}`,
            issues: { open: 1, closed: 1 },
            pullRequests: { open: 0, closed: 0, merged: 2 },
            pullRequestDetails: [],
            mergedPRTimeline: [
              {
                number: i * 10 + 1,
                createdAt: "2026-08-20T00:00:00Z",
                mergedAt: "2026-08-22T00:00:00Z",
                author: "alice",
                isBotAuthor: false,
                isCopilotAuthored: i === 0,
                aiAuthorType: i === 0 ? "copilot" : undefined,
                timeToMergeHours: 48 * (i + 1),
                closesIssues: [],
                linesAdded: 10 * (i + 1),
                linesDeleted: 2,
                firstReviewAt: "2026-08-20T06:00:00Z",
                firstApprovalAt: "2026-08-21T00:00:00Z",
                reviewCount: 2,
                changesRequestedCount: i,
                revertsPR: undefined,
              },
            ],
            closedPRTimeline: [
              {
                number: i * 10 + 2,
                createdAt: "2026-08-18T00:00:00Z",
                closedAt: "2026-08-23T00:00:00Z",
                author: "bob",
                isBotAuthor: false,
                linesAdded: 5,
                linesDeleted: 1,
              },
            ],
            openPRTimeline: [
              {
                number: i * 10 + 3,
                createdAt: "2026-08-10T00:00:00Z",
                author: "carol",
                isBotAuthor: false,
              },
            ],
            reviewerLoad: [
              { reviewer: "amy", reviews: 5 - i },
              { reviewer: "bob", reviews: 1 },
            ],
            weeklyTrends: [
              {
                week: "2026-W34",
                prsOpened: 1,
                prsMerged: 1,
                issuesOpened: 1,
                issuesClosed: 1,
                linesAdded: 10,
                linesDeleted: 2,
              },
            ],
            committerCount: 1,
            reviewerCount: 1,
            contributorCount: 1,
            dependentCount: 0,
          })),
          weeklyTrends: [
            {
              week: "2026-W34",
              prsOpened: 2,
              prsMerged: 2,
              issuesOpened: 2,
              issuesClosed: 2,
              linesAdded: 30,
              linesDeleted: 4,
            },
          ],
        },
      })
    );
  });

  afterEach(() => {
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  });

  /** Load the built page in JSDOM and return it plus any script errors. */
  function run(search = "", env: Record<string, string> = {}) {
    execFileSync("node", ["dist/build-pages.js", "js-owner"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    const errors: string[] = [];
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: `https://example.com/${search}`,
      virtualConsole: new VirtualConsole().on("jsdomError", (e: Error) =>
        errors.push(e.message)
      ),
    });
    dom.window.document.dispatchEvent(
      new dom.window.Event("DOMContentLoaded", { bubbles: true })
    );
    return { dom, errors };
  }

  it("runs the dashboard script without throwing", () => {
    const { errors } = run("", {
      DEVEX_TEAM_NAME: "Platform",
      DEVEX_TEAM_REPOS: "js-owner/api",
      DEVEX_TRIAL_TITLE: "Trunk-based development",
      DEVEX_TRIAL_START: "2026-08-01",
    });
    expect(errors).toEqual([]);
  });

  it("fills the trial table with real numbers", () => {
    const { dom, errors } = run("", {
      DEVEX_TEAM_NAME: "Platform",
      DEVEX_TEAM_REPOS: "js-owner/api",
      DEVEX_TRIAL_TITLE: "Trunk-based development",
    });
    expect(errors).toEqual([]);
    const baseline = dom.window.document.getElementById("trialBaseline-cycle");
    const team = dom.window.document.getElementById("trialTeam-cycle");
    // Both repos merged a PR, so the baseline has data; the team is api only.
    expect(baseline?.textContent).not.toBe("–");
    expect(team?.textContent).not.toBe("–");
    expect(dom.window.document.getElementById("trialNote")?.textContent).toContain(
      "Baseline n="
    );
  });

  it("warns when the team sample is too small to read", () => {
    const { dom } = run("", {
      DEVEX_TEAM_NAME: "Platform",
      DEVEX_TEAM_REPOS: "js-owner/api",
      DEVEX_TRIAL_TITLE: "Trunk-based development",
    });
    expect(dom.window.document.getElementById("trialNote")?.textContent).toContain(
      "Not enough team data yet"
    );
  });

  it("restores the period and bot filter from the query string", () => {
    const { dom, errors } = run("?period=all&bots=exclude");
    expect(errors).toEqual([]);
    const active = dom.window.document.querySelector(".filter-btn.active");
    expect(active?.getAttribute("data-period")).toBe("all");
    const botCb = dom.window.document.getElementById("excludeBots") as HTMLInputElement;
    expect(botCb.checked).toBe(true);
  });

  it("restores a repo selection from the query string", () => {
    const { dom, errors } = run("?repos=api");
    expect(errors).toEqual([]);
    expect(dom.window.document.getElementById("repoPickerLabel")?.textContent).toBe(
      "1 repo"
    );
  });

  it("ignores repo names in the URL that are no longer collected", () => {
    const { dom, errors } = run("?repos=api,deleted-repo");
    expect(errors).toEqual([]);
    expect(dom.window.document.getElementById("repoPickerLabel")?.textContent).toBe(
      "1 repo"
    );
  });

  it("selects the team's repos when the URL asks for the team scope", () => {
    const { dom, errors } = run("?scope=team", {
      DEVEX_TEAM_NAME: "Platform",
      DEVEX_TEAM_REPOS: "js-owner/api",
    });
    expect(errors).toEqual([]);
    const teamBtn = dom.window.document.querySelector('.scope-btn[data-scope="team"]');
    expect(teamBtn?.classList.contains("active")).toBe(true);
  });

  it("falls back to the 30-day view for an unknown period", () => {
    const { dom } = run("?period=nonsense");
    const active = dom.window.document.querySelector(".filter-btn.active");
    expect(active?.getAttribute("data-period")).toBe("30days");
  });

  it("fills the three review legs with real durations", () => {
    const { dom, errors } = run("?period=all");
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    // Opened 2026-08-20T00:00 → first review 06:00 → approval next day.
    expect(doc.getElementById("flowP50-review")?.textContent).toBe("6.0hr");
    expect(doc.getElementById("flowP50-approval")?.textContent).toBe("18.0hr");
    expect(doc.getElementById("flowN-review")?.textContent).toBe("2");
  });

  it("says so plainly when a leg has no data to read", () => {
    const { dom } = run("?period=all");
    const note = dom.window.document.getElementById("flowNote")?.textContent ?? "";
    expect(note).toContain("Measured over 2 reviewed pull requests");
    expect(note).toContain("Too few to read as a rate");
  });

  it("fills the AI versus human comparison from the same filtered set", () => {
    const { dom, errors } = run("?period=all");
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    // One AI-authored PR in api, one human-authored PR in billing.
    expect(doc.getElementById("aiHumanAI-merged")?.textContent).toBe("1");
    expect(doc.getElementById("aiHumanHuman-merged")?.textContent).toBe("1");
    expect(doc.getElementById("aiHumanAI-cycle")?.textContent).not.toBe("–");
    expect(doc.getElementById("aiHumanNote")?.textContent).toContain("AI n=1");
  });

  it("reports review-load concentration across the collected reviewers", () => {
    const { dom, errors } = run("?period=all");
    expect(errors).toEqual([]);
    const badge = dom.window.document.getElementById("giniBadge")?.textContent ?? "";
    expect(badge).toMatch(/^Gini 0\.\d\d$/);
    expect(dom.window.document.getElementById("giniNote")?.textContent).toContain(
      "2 reviewers"
    );
  });

  it("reports the abandonment rate and the age of open work", () => {
    const { dom, errors } = run("?period=all");
    expect(errors).toEqual([]);
    // Two merged and two closed-unmerged PRs across the two repos.
    expect(dom.window.document.getElementById("kpiAbandonVal")?.textContent).toBe("50.0%");
    expect(dom.window.document.getElementById("kpiAbandonSub")?.textContent).toContain(
      "2 open"
    );
  });

  it("shows the median PR size and the share of large changes", () => {
    const { dom, errors } = run("?period=all");
    expect(errors).toEqual([]);
    expect(dom.window.document.getElementById("kpiSizeVal")?.textContent).not.toBe("–");
    expect(dom.window.document.getElementById("kpiSizeSub")?.textContent).toContain(
      "over 400 lines"
    );
  });

  it("renders a dash for cost per agent PR when there is no agent data", () => {
    const { dom, errors } = run("?period=all");
    expect(errors).toEqual([]);
    expect(dom.window.document.getElementById("kpiAgentCostVal")?.textContent).toBe("–");
    expect(dom.window.document.getElementById("kpiAgentCostSub")?.textContent).toBe(
      "no agent data"
    );
  });

  it("keeps the new metrics working under a repo filter", () => {
    const { dom, errors } = run("?period=all&repos=api");
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    expect(doc.getElementById("repoPickerLabel")?.textContent).toBe("1 repo");
    // api's single merged PR is the AI-authored one.
    expect(doc.getElementById("aiHumanAI-merged")?.textContent).toBe("1");
    expect(doc.getElementById("aiHumanHuman-merged")?.textContent).toBe("0");
  });
});

describe("build-pages · nothing collected yet", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const siteDir = path.resolve(process.cwd(), "_site");
  const owner = "never-collected-owner";
  const outputFile = path.join(dataDir, "gh-output-test.txt");

  afterEach(() => {
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  });

  function build(extraEnv: Record<string, string> = {}) {
    return execFileSync("node", ["dist/build-pages.js", owner], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, ...extraEnv },
    });
  }

  it("exits successfully instead of failing the first deploy of a new site", () => {
    // A fresh deployment builds Pages on a code push before the first
    // scheduled collection has run, so there is legitimately no data.
    const out = build();
    expect(out).toContain("Nothing collected for");
    expect(out).toContain("Collect DevEx Metrics");
  });

  it("reports site-built=false so the workflow skips upload and deploy", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(outputFile, "");
    build({ GITHUB_OUTPUT: outputFile });
    expect(fs.readFileSync(outputFile, "utf-8")).toContain("site-built=false");
  });

  it("reports site-built=true when a site is actually produced", () => {
    const cacheFile = path.join(dataDir, "built-owner.json");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(outputFile, "");
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        date: "2026-08-31",
        data: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          owner: "built-owner",
          ownerType: "org",
          collectedAt: "2026-08-31T00:00:00.000Z",
          repoCount: 0,
          repos: [],
          weeklyTrends: [],
        },
      })
    );
    try {
      execFileSync("node", ["dist/build-pages.js", "built-owner"], {
        cwd: process.cwd(),
        env: { ...process.env, GITHUB_OUTPUT: outputFile },
      });
      expect(fs.readFileSync(outputFile, "utf-8")).toContain("site-built=true");
      expect(fs.existsSync(path.join(siteDir, "index.html"))).toBe(true);
    } finally {
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    }
  });

  it("still fails hard when data exists but carries a stale schema", () => {
    // "Not collected yet" is forgiven; "collected but broken" must not be.
    const cacheFile = path.join(dataDir, "stale-owner.json");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        date: "2026-08-31",
        data: { schemaVersion: 1, owner: "stale-owner", repos: [] },
      })
    );
    try {
      expect(() =>
        execFileSync("node", ["dist/build-pages.js", "stale-owner"], {
          cwd: process.cwd(),
          stdio: "pipe",
        })
      ).toThrow();
    } finally {
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    }
  });
});
