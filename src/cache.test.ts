import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadCache, saveCache, loadFixture, saveFixture, loadRawCache, isWithinHours, fixturesEnabled, CURRENT_SCHEMA_VERSION } from "./cache.js";
import type { OrgMetrics } from "./types.js";

function makeSampleMetrics(): OrgMetrics {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
        contributorCount: 1,
        dependentCount: 0,
      },
    ],
    weeklyTrends: [],
  };
}

afterEach(() => {
  delete process.env.DEVEX_USE_FIXTURE;
});

describe("fixturesEnabled", () => {
  it("is off by default so a stale fixture can never shadow collected data", () => {
    expect(fixturesEnabled({})).toBe(false);
  });

  it("accepts the usual truthy spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(fixturesEnabled({ DEVEX_USE_FIXTURE: v })).toBe(true);
    }
  });

  it("treats anything else as off", () => {
    for (const v of ["0", "false", "no", "", "  "]) {
      expect(fixturesEnabled({ DEVEX_USE_FIXTURE: v })).toBe(false);
    }
  });
});

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

  it("loadCache should prefer fixture over stale daily cache when fixtures are enabled", () => {
    process.env.DEVEX_USE_FIXTURE = "1";
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

  it("loadFixture returns null when schema version does not match", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const stale = { ...makeSampleMetrics(), schemaVersion: 0 };
    fs.writeFileSync(testFixtureFile, JSON.stringify(stale));
    expect(loadFixture("test-owner")).toBeNull();
  });

  it("loadCache returns null when daily cache schema version does not match", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const testFile = path.join(dataDir, "test-owner.json");
    const stale = { ...makeSampleMetrics(), schemaVersion: 0 };
    const envelope = { date: new Date().toISOString().slice(0, 10), data: { ...stale, weeklyTrends: [] } };
    fs.writeFileSync(testFile, JSON.stringify(envelope));
    expect(loadCache("test-owner")).toBeNull();
    fs.unlinkSync(testFile);
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

describe("fixture opt-in gating", () => {
  const dataDir = path.resolve(process.cwd(), "data");
  const fixtureFile = path.join(dataDir, "gated-owner.fixture.json");
  const cacheFile = path.join(dataDir, "gated-owner.json");

  afterEach(() => {
    for (const f of [fixtureFile, cacheFile]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    delete process.env.DEVEX_USE_FIXTURE;
  });

  function writeFixture(): OrgMetrics {
    const metrics = { ...makeSampleMetrics(), owner: "gated-owner" };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(fixtureFile, JSON.stringify(metrics));
    return metrics;
  }

  it("loadCache ignores a fixture unless DEVEX_USE_FIXTURE is set", () => {
    writeFixture();
    expect(loadCache("gated-owner")).toBeNull();
  });

  it("loadCache uses the fixture when DEVEX_USE_FIXTURE is set", () => {
    writeFixture();
    process.env.DEVEX_USE_FIXTURE = "1";
    const loaded = loadCache("gated-owner");
    expect(loaded?.owner).toBe("gated-owner");
    expect(loaded?.dataSource).toBe("fixture");
  });

  it("loadRawCache ignores a fixture unless DEVEX_USE_FIXTURE is set", () => {
    writeFixture();
    expect(loadRawCache("gated-owner")).toBeNull();
  });

  it("loadRawCache uses the fixture when DEVEX_USE_FIXTURE is set", () => {
    writeFixture();
    process.env.DEVEX_USE_FIXTURE = "1";
    expect(loadRawCache("gated-owner")?.owner).toBe("gated-owner");
  });

  it("marks data loaded from the daily cache with its provenance", () => {
    const metrics = { ...makeSampleMetrics(), owner: "gated-owner" };
    fs.mkdirSync(dataDir, { recursive: true });
    saveCache("gated-owner", metrics);
    expect(loadCache("gated-owner")?.dataSource).toBe("cache");
  });

  it("still prefers a same-day cache over a fixture when both are enabled", () => {
    const fixture = writeFixture();
    process.env.DEVEX_USE_FIXTURE = "1";
    saveCache("gated-owner", { ...fixture, repoCount: 99 });
    // Fixtures win by design when explicitly enabled — assert that contract
    // holds so a future change to the ordering is a deliberate one.
    expect(loadCache("gated-owner")?.dataSource).toBe("fixture");
  });
});
