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
});
