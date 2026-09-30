import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { enrichLandscapeScan, MAX_FILES_PER_REPO, scoreLandscapeContent } from "./landscape-signals.js";
import { parseLandscapeScan } from "./landscape.js";
import type { LandscapeRepository } from "./types.js";

const HEAD = "a".repeat(40);
const AT = "2026-09-30T12:00:00.000Z";
const CHANGED = "2026-09-20T12:00:00.000Z";
const CONTENT = "# Scope\nThis repository uses AI instructions.\n- Run npm test\n# Checks\nDo not skip validation.\n";
const HASH = createHash("sha256").update(CONTENT).digest("hex");

function scan(files = 1) {
  return parseLandscapeScan({
    schema_version: 1, generated_at: AT, scanner_version: "0.1.0",
    repositories: [{
      full_name: "acme/public", head_sha: HEAD,
      ai_files: Array.from({ length: files }, (_, index) => ({
        path: `rules/${index}.md`, kind: "instructions", sha256: HASH,
        last_changed: CHANGED, age_days: 10, lag_days: 5, stale: false,
      })),
      ai_summary: { count: files, stale_count: 0, max_lag_days: files ? 5 : null },
    }],
  });
}

function fakeApi(options: {
  head?: string; private?: boolean; team?: unknown; recent?: number;
  content?: string; fileCount?: number;
} = {}) {
  const graphql = vi.fn(async (query: string, _vars: Record<string, string>): Promise<unknown> => {
    const fields = Object.fromEntries(
      Array.from(query.matchAll(/file(\d+):history/g), ([, index]) => [`file${index}`, { totalCount: options.fileCount ?? 3 }])
    );
    return {
      repository: {
        nameWithOwner: "acme/public", isPrivate: options.private ?? false,
        object: {
          oid: options.head ?? HEAD, month: { totalCount: 2 },
          recent: { totalCount: options.recent ?? 5 }, ...fields,
          ...(options.team === undefined ? {} : { team: options.team }),
        },
      },
    };
  });
  const getContent = vi.fn(async () => {
    const text = options.content ?? CONTENT;
    return { data: {
      type: "file", encoding: "base64", size: Buffer.byteLength(text),
      content: Buffer.from(text).toString("base64"),
    } };
  });
  return { graphql, getContent, octokit: {
    graphql, rest: { repos: { getContent } },
  } as unknown as Octokit };
}

function observed(scanResult: Awaited<ReturnType<typeof enrichLandscapeScan>>): LandscapeRepository {
  const repo = scanResult.repositories[0];
  if (!("head_sha" in repo)) throw new Error("Expected observed repo");
  return repo;
}

describe("pinned public landscape signals", () => {
  it("counts real Git-history windows and all commits since the changed date, not PRs", async () => {
    const api = fakeApi();
    const result = observed(await enrichLandscapeScan(scan(), api.octokit));
    expect(result).toMatchObject({
      commits_30d: 2, commits_90d: 5, team_commits_30d: null, team_commits_90d: null,
      ai_files: [{ commits_since_change: 3, content_signal: {
        score: 100, scope: true, actions: true, verification: true, guardrails: true,
      } }],
    });
    expect(api.graphql).toHaveBeenCalledWith(expect.stringContaining("recent:history"), expect.objectContaining({
      head: HEAD, end: AT, file0: CHANGED,
      month: new Date(Date.parse(AT) - 30 * 86_400_000).toISOString(),
      recent: new Date(Date.parse(AT) - 90 * 86_400_000).toISOString(),
    }));
    expect(api.getContent).toHaveBeenCalledWith({
      owner: "acme", repo: "public", path: "rules/0.md", ref: HEAD,
    });
    expect(JSON.stringify(result)).not.toContain(CONTENT);
  });

  it("treats unverified heads and content hashes as unknown, not a quality zero", async () => {
    const mismatch = fakeApi({ head: "b".repeat(40) });
    const result = observed(await enrichLandscapeScan(scan(), mismatch.octokit, ["Alice"]));
    expect(result.commits_90d).toBeNull();
    expect(result.ai_files[0].content_signal).toBeNull();
    expect(mismatch.getContent).not.toHaveBeenCalled();
    const changed = fakeApi({ content: "# Scope\nChanged since the scan" });
    const unavailable = observed(await enrichLandscapeScan(scan(), changed.octokit));
    expect(unavailable.commits_90d).toBe(5);
    expect(unavailable.ai_files[0].content_signal).toBeNull();
    const denied = fakeApi();
    denied.graphql.mockRejectedValueOnce({ status: 403 });
    expect(observed(await enrichLandscapeScan(scan(), denied.octokit))
      .commits_90d).toBeNull();
    expect(denied.getContent).not.toHaveBeenCalled();
  });

  it("leaves file history unknown without a last-changed timestamp while still scoring verified bytes", async () => {
    const source = scan();
    const repo = source.repositories[0] as LandscapeRepository;
    repo.ai_files[0].last_changed = null;
    const api = fakeApi();
    const result = observed(await enrichLandscapeScan(source, api.octokit));
    expect(result.ai_files[0].commits_since_change).toBeNull();
    expect(result.ai_files[0].content_signal?.score).toBe(100);
    expect(api.graphql.mock.calls[0][0]).not.toContain("file0:history");
  });

  it("counts only configured, linked GitHub authors with complete pagination and no identity publication", async () => {
    const nodes = Array.from({ length: 100 }, (_, index) => ({
      oid: String(index).padStart(40, "0"), committedDate: "2026-08-01T12:00:00Z",
      author: { user: { login: index === 0 ? "Alice" : "outsider" } },
    }));
    const api = fakeApi({ recent: 101, team: {
      totalCount: 101, nodes, pageInfo: { hasNextPage: true, endCursor: "next" },
    } });
    api.graphql.mockImplementationOnce(async (query: string, vars: Record<string, string>) => {
      const fields = Object.fromEntries(Array.from(query.matchAll(/file(\d+):history/g),
        ([, index]) => [`file${index}`, { totalCount: 3 }]));
      return { repository: { nameWithOwner: "acme/public", isPrivate: false,
        object: { oid: vars.head, month: { totalCount: 2 }, recent: { totalCount: 101 },
          ...fields, team: { totalCount: 101, nodes,
            pageInfo: { hasNextPage: true, endCursor: "next" } } } } };
    });
    api.graphql.mockImplementationOnce(async (_query: string, vars: Record<string, string>) => ({
      repository: { nameWithOwner: "acme/public", isPrivate: false,
        object: { oid: vars.head, team: { totalCount: 101,
          nodes: [{ oid: "f".repeat(40), committedDate: "2026-09-29T12:00:00Z",
            author: { user: { login: "aLiCe" } } }],
          pageInfo: { hasNextPage: false, endCursor: null } } } },
    }));
    const result = observed(await enrichLandscapeScan(scan(), api.octokit, ["alice"]));
    expect(result.team_commits_30d).toBe(1);
    expect(result.team_commits_90d).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/Alice|outsider/i);
    expect(api.graphql).toHaveBeenCalledTimes(2);
  });

  it("reports unknown team attribution if history is incomplete or above the fixed pagination budget", async () => {
    const missing = fakeApi({ team: {
      totalCount: 5,
      nodes: [{ oid: "f".repeat(40), committedDate: AT, author: { user: null } }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } });
    expect(observed(await enrichLandscapeScan(scan(), missing.octokit, ["alice"])).team_commits_90d).toBeNull();
    const overBudget = fakeApi({ recent: 501, team: {
      totalCount: 501, nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" },
    } });
    expect(observed(await enrichLandscapeScan(scan(), overBudget.octokit, ["alice"])).team_commits_90d).toBeNull();
    expect(overBudget.graphql).toHaveBeenCalledTimes(1);
  });

  it("distinguishes verified zero commits from unavailable history on an empty observed file set", async () => {
    const api = fakeApi({ recent: 0, team: {
      totalCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
    } });
    api.graphql.mockImplementationOnce(async (_query: string, vars: Record<string, string>) => ({
      repository: { nameWithOwner: "acme/public", isPrivate: false,
        object: { oid: vars.head, month: { totalCount: 0 }, recent: { totalCount: 0 },
          team: { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } },
    }));
    const result = observed(await enrichLandscapeScan(scan(0), api.octokit, ["alice"]));
    expect(result).toMatchObject({
      commits_30d: 0, commits_90d: 0, team_commits_30d: 0, team_commits_90d: 0,
    });
    expect(api.getContent).not.toHaveBeenCalled();
  });

  it("does not score unverified, oversized, or inaccessible content as zero", async () => {
    const tooLarge = fakeApi({ content: "x".repeat(64 * 1024 + 1) });
    expect(observed(await enrichLandscapeScan(scan(), tooLarge.octokit))
      .ai_files[0].content_signal).toBeNull();
    const denied = fakeApi();
    denied.getContent.mockRejectedValueOnce({ status: 403 });
    expect(observed(await enrichLandscapeScan(scan(), denied.octokit))
      .ai_files[0].content_signal).toBeNull();
  });

  it("processes 139 files in bounded history batches and marks files beyond the per-repo budget unknown", async () => {
    const api = fakeApi();
    const many = observed(await enrichLandscapeScan(scan(139), api.octokit));
    expect(many.ai_files).toHaveLength(139);
    expect(many.ai_files.every((file) => file.content_signal?.score === 100 &&
      file.commits_since_change === 3)).toBe(true);
    expect(api.graphql).toHaveBeenCalledTimes(7);
    expect(api.getContent).toHaveBeenCalledTimes(139);

    const limited = observed(await enrichLandscapeScan(scan(MAX_FILES_PER_REPO + 1), fakeApi().octokit));
    expect(limited.ai_files[MAX_FILES_PER_REPO - 1].commits_since_change).toBe(3);
    expect(limited.ai_files[MAX_FILES_PER_REPO].commits_since_change).toBeNull();
    expect(limited.ai_files[MAX_FILES_PER_REPO].content_signal).toBeNull();
  });
});

it("awards only the four documented content cues and never treats presence as quality", () => {
  expect(scoreLandscapeContent("# Scope\nOverview.").score).toBe(25);
  expect(scoreLandscapeContent("# Scope\n- Write documentation.").score).toBe(50);
  expect(scoreLandscapeContent("# Scope\n- Write documentation.\n# Checks").score).toBe(75);
  expect(scoreLandscapeContent("# Scope\n- Run npm test\n# Checks\nNever skip checks.").score).toBe(100);
  expect(scoreLandscapeContent("Hello world").score).toBe(0);
});
