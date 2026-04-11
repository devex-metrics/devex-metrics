import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadCache, saveCache, loadFixture, saveFixture, loadRawCache, isWithinHours } from "./cache.js";
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
    weeklyTrends: [],
  };
}

describe("cache", () => {
  // cache.ts resolves DATA_DIR from process.cwd() + /data at module load,
  // so we use the actual data dir for these tests.
  const dataDir = path.resolve(process.cwd(), "data");
  const testFile = path.join(dataDir, "test-owner.json");
  const testFixtureFile = path.join(dataDir, "test-owner.fixture.json");

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    if (fs.existsSync(testFixtureFile)) {
      fs.unlinkSync(testFixtureFile);
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

describe("fixture", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const testFixtureFile = path.join(dataDir, "test-owner.fixture.json");

  afterEach(() => {
    if (fs.existsSync(testFixtureFile)) {
      fs.unlinkSync(testFixtureFile);
    }
  });

  it("should return null when no fixture file exists", () => {
    if (fs.existsSync(testFixtureFile)) fs.unlinkSync(testFixtureFile);
    expect(loadFixture("test-owner")).toBeNull();
  });

  it("should save and load a fixture without date restriction", () => {
    const metrics = makeSampleMetrics();
    saveFixture("test-owner", metrics);
    const loaded = loadFixture("test-owner");
    expect(loaded).not.toBeNull();
    expect(loaded!.owner).toBe("test-owner");
    expect(loaded!.repoCount).toBe(1);
  });

  it("should return null for a malformed fixture", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(testFixtureFile, '{ "owner": "test-owner" }');
    expect(loadFixture("test-owner")).toBeNull();
  });

  it("loadCache should prefer fixture over stale daily cache", () => {
    const metrics = makeSampleMetrics();
    // Write stale daily cache
    const envelope = { date: "2020-01-01", data: metrics };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "test-owner.json"), JSON.stringify(envelope));
    // Write fixture
    saveFixture("test-owner", metrics);
    const loaded = loadCache("test-owner");
    expect(loaded).not.toBeNull();
    expect(loaded!.owner).toBe("test-owner");
    // Clean up daily cache
    fs.unlinkSync(path.join(dataDir, "test-owner.json"));
  });
});

describe("isWithinHours", () => {
  it("returns false for undefined", () => {
    expect(isWithinHours(undefined, 8)).toBe(false);
  });

  it("returns true for a timestamp 1 hour ago when limit is 8", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isWithinHours(oneHourAgo, 8)).toBe(true);
  });

  it("returns false for a timestamp 9 hours ago when limit is 8", () => {
    const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
    expect(isWithinHours(nineHoursAgo, 8)).toBe(false);
  });

  it("returns false for an old timestamp", () => {
    expect(isWithinHours("2020-01-01T00:00:00.000Z", 8)).toBe(false);
  });
});

describe("loadRawCache", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const testFile = path.join(dataDir, "test-raw.json");
  const testFixture = path.join(dataDir, "test-raw.fixture.json");

  afterEach(() => {
    [testFile, testFixture].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  });

  it("returns null when no files exist", () => {
    expect(loadRawCache("test-raw")).toBeNull();
  });

  it("loads stale daily cache ignoring date", () => {
    const metrics = makeSampleMetrics();
    const envelope = { date: "2020-01-01", data: { ...metrics, owner: "test-raw" } };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(testFile, JSON.stringify(envelope));
    const loaded = loadRawCache("test-raw");
    expect(loaded).not.toBeNull();
    expect(loaded!.owner).toBe("test-raw");
  });

  it("prefers fixture over stale daily cache", () => {
    const metrics = { ...makeSampleMetrics(), owner: "test-raw" };
    const envelope = { date: "2020-01-01", data: metrics };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(testFile, JSON.stringify(envelope));
    fs.writeFileSync(testFixture, JSON.stringify(metrics));
    const loaded = loadRawCache("test-raw");
    expect(loaded).not.toBeNull();
    expect(loaded!.owner).toBe("test-raw");
  });
});
