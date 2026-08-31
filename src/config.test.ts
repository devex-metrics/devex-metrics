import { describe, it, expect } from "vitest";
import {
  loadConfig,
  defaultConfig,
  assertUsable,
  describeConfig,
  globToRegExp,
  matchesGlobs,
  parseList,
  parseMilestones,
  applyScope,
} from "./config.js";

/** Env with no DEVEX_* variables and no config file lookup surprises. */
const EMPTY: Record<string, string | undefined> = {};

describe("globToRegExp", () => {
  it("treats * as any run of characters", () => {
    expect(globToRegExp("devex-*").test("devex-metrics")).toBe(true);
    expect(globToRegExp("devex-*").test("other")).toBe(false);
  });

  it("treats ? as exactly one character", () => {
    expect(globToRegExp("repo-?").test("repo-1")).toBe(true);
    expect(globToRegExp("repo-?").test("repo-12")).toBe(false);
  });

  it("escapes regex metacharacters so they match literally", () => {
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});

describe("matchesGlobs", () => {
  it("matches against both the bare name and owner/name", () => {
    expect(matchesGlobs("acme/api", ["api"])).toBe(true);
    expect(matchesGlobs("acme/api", ["acme/api"])).toBe(true);
    expect(matchesGlobs("acme/api", ["acme/*"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesGlobs("Acme/API", ["acme/api"])).toBe(true);
  });

  it("returns false for an empty glob list", () => {
    expect(matchesGlobs("acme/api", [])).toBe(false);
  });

  it("does not match a different repo", () => {
    expect(matchesGlobs("acme/billing", ["acme/api"])).toBe(false);
  });
});

describe("parseList", () => {
  it("splits on commas, semicolons and newlines and trims", () => {
    expect(parseList("a, b;c\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty array for an empty string so a variable can clear a list", () => {
    expect(parseList("")).toEqual([]);
  });

  it("returns undefined when the variable is unset", () => {
    expect(parseList(undefined)).toBeUndefined();
  });
});

describe("parseMilestones", () => {
  it("parses date=label pairs", () => {
    expect(parseMilestones("2026-04-01=Training; 2026-05-15=Rollout")).toEqual([
      { date: "2026-04-01", label: "Training" },
      { date: "2026-05-15", label: "Rollout" },
    ]);
  });

  it("drops entries without a label or a date", () => {
    expect(parseMilestones("2026-04-01=; =Rollout; nonsense")).toEqual([]);
  });
});

describe("loadConfig", () => {
  it("returns defaults when nothing is set", () => {
    const c = loadConfig(EMPTY);
    expect(c.owner).toBe("");
    expect(c.ownerType).toBe("org");
    expect(c.repos.excludeArchived).toBe(true);
    expect(c.collection.features.dependents).toBe(false);
    expect(c.team).toBeUndefined();
    expect(c.trial).toBeUndefined();
  });

  it("reads discrete environment variables", () => {
    const c = loadConfig({
      DEVEX_OWNER: "acme",
      DEVEX_OWNER_TYPE: "user",
      DEVEX_REPOS_INCLUDE: "api, web",
      DEVEX_MAX_IDLE_DAYS: "180",
      DEVEX_EXCLUDE_FORKS: "true",
    });
    expect(c.owner).toBe("acme");
    expect(c.ownerType).toBe("user");
    expect(c.repos.include).toEqual(["api", "web"]);
    expect(c.repos.maxIdleDays).toBe(180);
    expect(c.repos.excludeForks).toBe(true);
  });

  it("ignores an owner type that is not org or user", () => {
    const c = loadConfig({ DEVEX_OWNER_TYPE: "team" });
    expect(c.ownerType).toBe("org");
  });

  it("reads a whole config from DEVEX_CONFIG", () => {
    const c = loadConfig({
      DEVEX_CONFIG: JSON.stringify({
        owner: "acme",
        ownerType: "org",
        team: { id: "alpha", name: "Alpha", repos: ["acme/api"], discoverAll: false },
        trial: { title: "Trunk-based", interventionStart: "2026-05-01" },
      }),
    });
    expect(c.owner).toBe("acme");
    expect(c.team?.id).toBe("alpha");
    expect(c.team?.discoverAll).toBe(false);
    expect(c.trial?.title).toBe("Trunk-based");
    expect(c.trial?.milestones).toEqual([]);
  });

  it("lets discrete variables override DEVEX_CONFIG", () => {
    const c = loadConfig({
      DEVEX_CONFIG: JSON.stringify({ owner: "from-json", ownerType: "org" }),
      DEVEX_OWNER: "from-var",
    });
    expect(c.owner).toBe("from-var");
  });

  it("keeps defaults for fields DEVEX_CONFIG does not mention", () => {
    const c = loadConfig({ DEVEX_CONFIG: JSON.stringify({ owner: "acme" }) });
    expect(c.collection.historyWeeks).toBe(104);
    expect(c.branding.title).toBe("DevEx Metrics");
  });

  it("throws a helpful error when DEVEX_CONFIG is not valid JSON", () => {
    expect(() => loadConfig({ DEVEX_CONFIG: "{nope" })).toThrow(/not valid JSON/);
  });

  it("throws when DEVEX_CONFIG_FILE points at a missing file", () => {
    expect(() => loadConfig({ DEVEX_CONFIG_FILE: "does-not-exist.json" })).toThrow(
      /missing file/
    );
  });

  it("builds a team from discrete variables alone", () => {
    const c = loadConfig({
      DEVEX_TEAM_NAME: "Team Alpha",
      DEVEX_TEAM_REPOS: "acme/api",
    });
    expect(c.team?.name).toBe("Team Alpha");
    expect(c.team?.id).toBe("team-alpha");
    expect(c.team?.repos).toEqual(["acme/api"]);
    expect(c.team?.discoverAll).toBe(true);
  });

  it("builds a trial from discrete variables alone", () => {
    const c = loadConfig({
      DEVEX_TRIAL_TITLE: "Trunk-based development",
      DEVEX_TRIAL_START: "2026-05-01",
      DEVEX_TRIAL_MILESTONES: "2026-05-15=Rollout",
    });
    expect(c.trial?.title).toBe("Trunk-based development");
    expect(c.trial?.interventionStart).toBe("2026-05-01");
    expect(c.trial?.milestones).toEqual([{ date: "2026-05-15", label: "Rollout" }]);
  });

  it("does not invent a trial when no trial variable is set", () => {
    const c = loadConfig({ DEVEX_OWNER: "acme" });
    expect(c.trial).toBeUndefined();
  });

  it("treats a blank variable as unset rather than as an empty value", () => {
    const c = loadConfig({ DEVEX_OWNER: "   " });
    expect(c.owner).toBe("");
  });
});

describe("assertUsable", () => {
  it("rejects a config with no owner", () => {
    expect(() => assertUsable(defaultConfig())).toThrow(/No owner configured/);
  });

  it("accepts a config with an owner", () => {
    const c = defaultConfig();
    c.owner = "acme";
    expect(() => assertUsable(c)).not.toThrow();
  });

  it("rejects team-only collection with no team repos", () => {
    const c = defaultConfig();
    c.owner = "acme";
    c.team = { id: "t", name: "T", repos: [], discoverAll: false };
    expect(() => assertUsable(c)).toThrow(/nothing to collect/);
  });

  it("accepts team-only collection when team repos are configured", () => {
    const c = defaultConfig();
    c.owner = "acme";
    c.team = { id: "t", name: "T", repos: ["acme/api"], discoverAll: false };
    expect(() => assertUsable(c)).not.toThrow();
  });
});

describe("describeConfig", () => {
  it("summarises owner, filters, team and trial", () => {
    const c = defaultConfig();
    c.owner = "acme";
    c.repos.exclude = ["*-archive"];
    c.team = { id: "a", name: "Alpha", repos: ["acme/api"], discoverAll: true };
    c.trial = { title: "Trunk-based", milestones: [] };
    const s = describeConfig(c);
    expect(s).toContain("acme (org)");
    expect(s).toContain("exclude=*-archive");
    expect(s).toContain("Alpha");
    expect(s).toContain("org-wide baseline");
    expect(s).toContain('trial="Trunk-based"');
  });
});

describe("applyScope", () => {
  const data = {
    owner: "acme",
    ownerType: "org" as const,
    collectedAt: "2026-08-30T00:00:00Z",
    repoCount: 2,
    repos: [
      {
        name: "api",
        fullName: "acme/api",
        issues: { open: 0, closed: 0 },
        pullRequests: { open: 0, closed: 0, merged: 0 },
        pullRequestDetails: [],
        committerCount: 0,
        reviewerCount: 0,
        contributorCount: 0,
        dependentCount: 0,
      },
      {
        name: "billing",
        fullName: "acme/billing",
        issues: { open: 0, closed: 0 },
        pullRequests: { open: 0, closed: 0, merged: 0 },
        pullRequestDetails: [],
        committerCount: 0,
        reviewerCount: 0,
        contributorCount: 0,
        dependentCount: 0,
      },
    ],
  };

  it("flags team repos from the current config", () => {
    const c = defaultConfig();
    c.team = { id: "a", name: "Alpha", repos: ["acme/api"], discoverAll: true };
    const scoped = applyScope(data, c);
    expect(scoped.repos[0].isTeamRepo).toBe(true);
    expect(scoped.repos[1].isTeamRepo).toBe(false);
    expect(scoped.team?.repos).toEqual(["acme/api"]);
  });

  it("clears the team when the config no longer defines one", () => {
    const withTeam = applyScope(data, {
      ...defaultConfig(),
      team: { id: "a", name: "Alpha", repos: ["acme/api"], discoverAll: true },
    });
    const cleared = applyScope(withTeam, defaultConfig());
    expect(cleared.team).toBeUndefined();
    expect(cleared.repos.every((r) => r.isTeamRepo === false)).toBe(true);
  });

  it("copies the trial across so a retitle needs no re-collection", () => {
    const c = defaultConfig();
    c.trial = {
      title: "Trunk-based",
      interventionStart: "2026-05-01",
      milestones: [{ date: "2026-05-15", label: "Rollout" }],
    };
    const scoped = applyScope(data, c);
    expect(scoped.trial?.title).toBe("Trunk-based");
    expect(scoped.trial?.milestones).toHaveLength(1);
  });

  it("leaves the collected metrics untouched", () => {
    const scoped = applyScope(data, defaultConfig());
    expect(scoped.repoCount).toBe(2);
    expect(scoped.collectedAt).toBe(data.collectedAt);
    expect(data.repos[0].isTeamRepo).toBeUndefined();
  });
});

describe("CI health configuration", () => {
  it("is off by default — it is the only collector that walks a second history", () => {
    expect(defaultConfig().collection.features.ciHealth).toBe(false);
  });

  it("defaults to a conservative crawl budget", () => {
    const ci = defaultConfig().collection.ciHealth;
    expect(ci.pagesPerRun).toBe(20);
    expect(ci.maxPagesPerRepo).toBe(5);
    expect(ci.windowDays).toBe(90);
  });

  it("is enabled by DEVEX_FEATURE_CI_HEALTH", () => {
    const config = loadConfig({ ...EMPTY, DEVEX_FEATURE_CI_HEALTH: "true" });
    expect(config.collection.features.ciHealth).toBe(true);
  });

  it("reads the crawl budget from DEVEX_CI_* variables", () => {
    const config = loadConfig({
      ...EMPTY,
      DEVEX_CI_PAGES_PER_RUN: "50",
      DEVEX_CI_MAX_PAGES_PER_REPO: "8",
      DEVEX_CI_WINDOW_DAYS: "30",
    });
    expect(config.collection.ciHealth).toEqual({
      pagesPerRun: 50,
      maxPagesPerRepo: 8,
      windowDays: 30,
    });
  });

  it("keeps the defaults when a DEVEX_CI_* variable is blank", () => {
    const config = loadConfig({ ...EMPTY, DEVEX_CI_PAGES_PER_RUN: "  " });
    expect(config.collection.ciHealth.pagesPerRun).toBe(20);
  });

  it("merges a partial ciHealth block from DEVEX_CONFIG", () => {
    const config = loadConfig({
      ...EMPTY,
      DEVEX_CONFIG: JSON.stringify({
        owner: "acme",
        collection: { ciHealth: { pagesPerRun: 5 } },
      }),
    });
    expect(config.collection.ciHealth.pagesPerRun).toBe(5);
    // The fields the block did not mention keep their defaults.
    expect(config.collection.ciHealth.maxPagesPerRepo).toBe(5);
    expect(config.collection.ciHealth.windowDays).toBe(90);
  });

  it("lets a discrete variable win over DEVEX_CONFIG", () => {
    const config = loadConfig({
      ...EMPTY,
      DEVEX_CONFIG: JSON.stringify({
        owner: "acme",
        collection: { features: { ciHealth: true } },
      }),
      DEVEX_FEATURE_CI_HEALTH: "false",
    });
    expect(config.collection.features.ciHealth).toBe(false);
  });
});
