import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
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

  it("should render trend chart canvases when weeklyTrends data is present", () => {
    // Re-write the cache file with weeklyTrends data
    const envelopeWithTrends: CacheEnvelope = {
      date: "2026-03-28",
      data: {
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
            dependentCount: 0,
          },
        ],
        weeklyTrends: [
          { week: "2026-W10", prsOpened: 3, prsMerged: 2, issuesOpened: 5, issuesClosed: 4, linesAdded: 400, linesDeleted: 100 },
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
            dependentCount: 0,
          },
        ],
        weeklyTrends: [
          // Cast as any to simulate old JSON without the new fields
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
});
