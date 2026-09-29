import { describe, it, expect, vi, afterEach } from "vitest";
import type { Octokit } from "@octokit/rest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { collectActiveRepos } from "./activity.js";

afterEach(() => {
  resetOctokit();
  vi.restoreAllMocks();
});

function item(fullName: string) {
  return { repository_url: `https://api.github.com/repos/${fullName}` };
}

function fakeSearch(impl: (args: { q: string; page: number }) => unknown) {
  const search = vi.fn(async (args: { q: string; page: number }) => ({ data: impl(args) }));
  setOctokit({ rest: { search: { issuesAndPullRequests: search } } } as unknown as Octokit);
  return search;
}

describe("collectActiveRepos", () => {
  it("returns the lower-cased repos with issue or PR activity since the timestamp", async () => {
    const search = fakeSearch(({ q }) => ({
      total_count: 2,
      incomplete_results: false,
      items: q.includes("is:issue") ? [item("Org/A"), item("org/b")] : [item("org/a")],
    }));

    const active = await collectActiveRepos("org", "org", "2026-09-29T06:00:00.123Z");

    expect(active).toEqual(new Set(["org/a", "org/b"]));
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "org:org is:issue updated:>=2026-09-29T06:00:00Z" })
    );
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "org:org is:pr updated:>=2026-09-29T06:00:00Z" })
    );
  });

  it("scopes a personal account with user:", async () => {
    const search = fakeSearch(() => ({ total_count: 0, incomplete_results: false, items: [] }));

    await collectActiveRepos("me", "user", "2026-09-29T06:00:00Z");

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringMatching(/^user:me /) })
    );
  });

  it("follows pages until a short page", async () => {
    const full = Array.from({ length: 100 }, () => item("org/a"));
    const search = fakeSearch(({ q, page }) => ({
      total_count: 101,
      incomplete_results: false,
      items: q.includes("is:pr") ? [] : page === 1 ? full : [item("org/b")],
    }));

    const active = await collectActiveRepos("org", "org", "2026-09-29T06:00:00Z");

    expect(active).toEqual(new Set(["org/a", "org/b"]));
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("returns null when the results exceed the search window", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeSearch(() => ({ total_count: 1001, incomplete_results: false, items: [] }));

    expect(await collectActiveRepos("org", "org", "2026-09-29T06:00:00Z")).toBeNull();
  });

  it("returns null when the search reports incomplete results", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeSearch(() => ({ total_count: 3, incomplete_results: true, items: [] }));

    expect(await collectActiveRepos("org", "org", "2026-09-29T06:00:00Z")).toBeNull();
  });

  it("returns null and warns when the search fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = vi.fn().mockRejectedValue({ status: 403 });
    setOctokit({ rest: { search: { issuesAndPullRequests: search } } } as unknown as Octokit);

    expect(await collectActiveRepos("org", "org", "2026-09-29T06:00:00Z")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("403"));
  });
});
