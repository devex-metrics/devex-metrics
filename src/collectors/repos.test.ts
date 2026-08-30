import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import type { Octokit } from "@octokit/rest";
import { collectRepos } from "./repos.js";

type RepoPage = Array<{ name: string; full_name: string; pushed_at: string | null }>;

function buildMockOctokit(pages: RepoPage[], authenticatedLogin?: string | null) {
  const listForOrg = Symbol("listForOrg");
  const listForUser = Symbol("listForUser");
  const listForAuthenticatedUser = Symbol("listForAuthenticatedUser");
  const captured: { method?: unknown; params?: unknown } = {};

  async function* fakeIterator(method: unknown, params: unknown) {
    captured.method = method;
    captured.params = params;
    for (const page of pages) {
      yield { data: page };
    }
  }

  const getAuthenticated =
    authenticatedLogin === null
      ? vi.fn().mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
      : authenticatedLogin === undefined
        ? vi.fn().mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
        : vi.fn().mockResolvedValue({ data: { login: authenticatedLogin } });

  const mock = {
    rest: {
      repos: { listForOrg, listForUser, listForAuthenticatedUser },
      users: { getAuthenticated },
    },
    paginate: Object.assign(vi.fn(), { iterator: fakeIterator }),
  } as unknown as Octokit;

  return { mock, captured, listForOrg, listForUser, listForAuthenticatedUser, getAuthenticated };
}

describe("collectRepos", () => {
  afterEach(() => resetOctokit());

  it("fetches repos for an org using listForOrg with org param", async () => {
    const { mock, captured, listForOrg } = buildMockOctokit([
      [{ name: "repo-a", full_name: "myorg/repo-a", pushed_at: "2026-01-01T00:00:00Z" }],
    ]);
    setOctokit(mock);

    const repos = await collectRepos("myorg", "org");

    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      name: "repo-a",
      fullName: "myorg/repo-a",
      pushedAt: "2026-01-01T00:00:00Z",
      archived: false,
      fork: false,
      isTeamRepo: false,
    });
    expect(captured.method).toBe(listForOrg);
    expect(captured.params).toMatchObject({ org: "myorg" });
  });

  it("org mode never calls getAuthenticated", async () => {
    const { mock, getAuthenticated } = buildMockOctokit([
      [{ name: "repo-a", full_name: "myorg/repo-a", pushed_at: "" }],
    ], "myorg");
    setOctokit(mock);

    await collectRepos("myorg", "org");

    expect(getAuthenticated).not.toHaveBeenCalled();
  });

  it("uses listForAuthenticatedUser when owner matches the authenticated user", async () => {
    const { mock, captured, listForAuthenticatedUser } = buildMockOctokit([
      [{ name: "repo-b", full_name: "myuser/repo-b", pushed_at: "2026-02-01T00:00:00Z" }],
    ], "myuser");
    setOctokit(mock);

    const repos = await collectRepos("myuser", "user");

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ name: "repo-b", fullName: "myuser/repo-b" });
    expect(captured.method).toBe(listForAuthenticatedUser);
    expect(captured.params).toMatchObject({ type: "all" });
  });

  it("uses listForAuthenticatedUser with case-insensitive owner match", async () => {
    const { mock, captured, listForAuthenticatedUser } = buildMockOctokit([
      [{ name: "repo-c", full_name: "MyUser/repo-c", pushed_at: "" }],
    ], "MyUser");
    setOctokit(mock);

    const repos = await collectRepos("myuser", "user");

    expect(captured.method).toBe(listForAuthenticatedUser);
    expect(repos).toHaveLength(1);
  });

  it("falls back to listForUser when owner does not match the authenticated user", async () => {
    const { mock, captured, listForUser } = buildMockOctokit([
      [{ name: "repo-b", full_name: "otheruser/repo-b", pushed_at: "2026-02-01T00:00:00Z" }],
    ], "someoneelse");
    setOctokit(mock);

    const repos = await collectRepos("otheruser", "user");

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ name: "repo-b", fullName: "otheruser/repo-b" });
    expect(captured.method).toBe(listForUser);
    expect(captured.params).toMatchObject({ username: "otheruser" });
  });

  it("falls back to listForUser when getAuthenticated throws (e.g. GitHub App token)", async () => {
    const { mock, captured, listForUser } = buildMockOctokit([
      [{ name: "repo-b", full_name: "myuser/repo-b", pushed_at: "" }],
    ], null);
    setOctokit(mock);

    const repos = await collectRepos("myuser", "user");

    expect(captured.method).toBe(listForUser);
    expect(repos).toHaveLength(1);
  });

  it("falls back to empty string when pushed_at is null", async () => {
    const { mock } = buildMockOctokit([
      [{ name: "empty-repo", full_name: "org/empty-repo", pushed_at: null }],
    ]);
    setOctokit(mock);

    const repos = await collectRepos("org", "org");

    expect(repos[0].pushedAt).toBe("");
  });

  it("accumulates repos across multiple pages", async () => {
    const { mock } = buildMockOctokit([
      [{ name: "repo-1", full_name: "org/repo-1", pushed_at: "" }],
      [{ name: "repo-2", full_name: "org/repo-2", pushed_at: "" }],
      [{ name: "repo-3", full_name: "org/repo-3", pushed_at: "" }],
    ]);
    setOctokit(mock);

    const repos = await collectRepos("org", "org");

    expect(repos).toHaveLength(3);
    expect(repos.map((r) => r.name)).toEqual(["repo-1", "repo-2", "repo-3"]);
  });

  it("returns empty array when there are no repos", async () => {
    const { mock } = buildMockOctokit([]);
    setOctokit(mock);

    const repos = await collectRepos("org", "org");

    expect(repos).toHaveLength(0);
  });
});

// ── filterRepos ───────────────────────────────────────────────────────────────

import { filterRepos, describeFiltering } from "./repos.js";
import { defaultConfig } from "../config.js";
import type { DiscoveredRepo } from "./repos.js";
import type { DevexConfig } from "../config.js";

function repo(fullName: string, extra: Partial<DiscoveredRepo> = {}): DiscoveredRepo {
  return {
    name: fullName.slice(fullName.indexOf("/") + 1),
    fullName,
    pushedAt: new Date().toISOString(),
    archived: false,
    fork: false,
    isTeamRepo: false,
    ...extra,
  };
}

function configWith(patch: (c: DevexConfig) => void): DevexConfig {
  const c = defaultConfig();
  c.owner = "acme";
  patch(c);
  return c;
}

describe("filterRepos", () => {
  it("keeps everything when no filters are configured", () => {
    const config = configWith(() => {});
    const result = filterRepos([repo("acme/api"), repo("acme/web")], config);
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/api", "acme/web"]);
    expect(result.dropped).toEqual({});
  });

  it("drops archived repos by default", () => {
    const config = configWith(() => {});
    const result = filterRepos([repo("acme/api"), repo("acme/old", { archived: true })], config);
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/api"]);
    expect(result.dropped).toEqual({ archived: 1 });
  });

  it("keeps archived repos when excludeArchived is off", () => {
    const config = configWith((c) => {
      c.repos.excludeArchived = false;
    });
    const result = filterRepos([repo("acme/old", { archived: true })], config);
    expect(result.repos).toHaveLength(1);
  });

  it("drops forks only when excludeForks is on", () => {
    const forked = [repo("acme/fork", { fork: true })];
    expect(filterRepos(forked, configWith(() => {})).repos).toHaveLength(1);
    const result = filterRepos(
      forked,
      configWith((c) => {
        c.repos.excludeForks = true;
      })
    );
    expect(result.repos).toHaveLength(0);
    expect(result.dropped).toEqual({ fork: 1 });
  });

  it("applies include globs", () => {
    const config = configWith((c) => {
      c.repos.include = ["devex-*"];
    });
    const result = filterRepos([repo("acme/devex-api"), repo("acme/billing")], config);
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/devex-api"]);
    expect(result.dropped).toEqual({ "not included": 1 });
  });

  it("applies exclude globs after include globs", () => {
    const config = configWith((c) => {
      c.repos.include = ["devex-*"];
      c.repos.exclude = ["*-archive"];
    });
    const result = filterRepos(
      [repo("acme/devex-api"), repo("acme/devex-archive")],
      config
    );
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/devex-api"]);
    expect(result.dropped).toEqual({ excluded: 1 });
  });

  it("drops repos idle beyond maxIdleDays", () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const config = configWith((c) => {
      c.repos.maxIdleDays = 180;
    });
    const result = filterRepos([repo("acme/api"), repo("acme/stale", { pushedAt: old })], config);
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/api"]);
    expect(result.dropped).toEqual({ idle: 1 });
  });

  it("treats a repo with no push date as idle when a cutoff is set", () => {
    const config = configWith((c) => {
      c.repos.maxIdleDays = 180;
    });
    const result = filterRepos([repo("acme/empty", { pushedAt: "" })], config);
    expect(result.repos).toHaveLength(0);
    expect(result.dropped).toEqual({ idle: 1 });
  });

  it("keeps a repo with no push date when no cutoff is set", () => {
    const result = filterRepos([repo("acme/empty", { pushedAt: "" })], configWith(() => {}));
    expect(result.repos).toHaveLength(1);
  });

  it("flags team repos but keeps the whole org when discoverAll is true", () => {
    const config = configWith((c) => {
      c.team = { id: "alpha", name: "Alpha", repos: ["acme/api"], discoverAll: true };
    });
    const result = filterRepos([repo("acme/api"), repo("acme/billing")], config);
    expect(result.repos).toHaveLength(2);
    expect(result.repos.find((r) => r.fullName === "acme/api")?.isTeamRepo).toBe(true);
    expect(result.repos.find((r) => r.fullName === "acme/billing")?.isTeamRepo).toBe(false);
  });

  it("collects only the team's repos when discoverAll is false", () => {
    const config = configWith((c) => {
      c.team = { id: "alpha", name: "Alpha", repos: ["acme/api"], discoverAll: false };
    });
    const result = filterRepos([repo("acme/api"), repo("acme/billing")], config);
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/api"]);
    expect(result.repos[0].isTeamRepo).toBe(true);
    expect(result.dropped).toEqual({ "outside team": 1 });
  });

  it("matches team globs against the bare repo name too", () => {
    const config = configWith((c) => {
      c.team = { id: "alpha", name: "Alpha", repos: ["api"], discoverAll: true };
    });
    const result = filterRepos([repo("acme/api")], config);
    expect(result.repos[0].isTeamRepo).toBe(true);
  });

  it("counts several drop reasons independently", () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const config = configWith((c) => {
      c.repos.maxIdleDays = 180;
      c.repos.exclude = ["*-archive"];
    });
    const result = filterRepos(
      [
        repo("acme/api"),
        repo("acme/x-archive"),
        repo("acme/stale", { pushedAt: old }),
        repo("acme/old", { archived: true }),
      ],
      config
    );
    expect(result.repos.map((r) => r.fullName)).toEqual(["acme/api"]);
    expect(result.dropped).toEqual({ archived: 1, excluded: 1, idle: 1 });
  });
});

describe("describeFiltering", () => {
  it("summarises kept, skipped and team counts", () => {
    const config = configWith((c) => {
      c.team = { id: "a", name: "Alpha", repos: ["acme/api"], discoverAll: true };
    });
    const result = filterRepos([repo("acme/api"), repo("acme/old", { archived: true })], config);
    const line = describeFiltering(2, result);
    expect(line).toContain("1/2 repositories kept");
    expect(line).toContain("skipped 1 archived");
    expect(line).toContain("1 flagged as team repos");
  });

  it("omits the skipped clause when nothing was dropped", () => {
    const result = filterRepos([repo("acme/api")], configWith(() => {}));
    expect(describeFiltering(1, result)).toBe("1/1 repositories kept");
  });
});
