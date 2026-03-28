import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadCache, saveCache } from "./cache.js";
import type { OrgMetrics } from "./types.js";

function makeSampleMetrics(): OrgMetrics {
  return {
    owner: "test-owner",
    ownerType: "user",
    collectedAt: new Date().toISOString(),
    repoCount: 1,
    repos: [
      {
        name: "repo-a",
        fullName: "test-owner/repo-a",
        issues: { open: 1, closed: 2 },
        pullRequests: { open: 0, closed: 0, merged: 1 },
        pullRequestDetails: [],
        committerCount: 1,
        reviewerCount: 0,
        dependentCount: 0,
      },
    ],
  };
}

describe("cache", () => {
  // cache.ts resolves DATA_DIR from process.cwd() + /data at module load,
  // so we use the actual data dir for these tests.
  const dataDir = path.resolve(process.cwd(), "data");
  const testFile = path.join(dataDir, "test-owner.json");

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it("should return null when no cache file exists", () => {
    // Ensure file doesn't exist
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    expect(loadCache("test-owner")).toBeNull();
  });

  it("should save and load cache for today", () => {
    const metrics = makeSampleMetrics();
    saveCache("test-owner", metrics);
    const loaded = loadCache("test-owner");
    expect(loaded).not.toBeNull();
    expect(loaded!.owner).toBe("test-owner");
    expect(loaded!.repoCount).toBe(1);
  });

  it("should return null for stale cache", () => {
    const metrics = makeSampleMetrics();
    // Write an envelope with yesterday's date
    const envelope = {
      date: "2020-01-01",
      data: metrics,
    };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(testFile, JSON.stringify(envelope));
    expect(loadCache("test-owner")).toBeNull();
  });
});
