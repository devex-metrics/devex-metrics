import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
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
