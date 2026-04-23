import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectRepoGraphQL } from "./repo-graphql.js";
import type { GraphQLPRNode } from "./repo-graphql.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePRNode(overrides: Partial<GraphQLPRNode> = {}): GraphQLPRNode {
  const now = new Date().toISOString();
  return {
    number: 1,
    title: "Test PR",
    state: "MERGED",
    createdAt: now,
    mergedAt: now,
    closedAt: now,
    updatedAt: now,
    headRefOid: "abc123",
    body: null,
    author: { login: "alice", __typename: "User" },
    additions: 10,
    deletions: 5,
    commits: { totalCount: 1 },
    comments: { totalCount: 0 },
    reviewThreads: { totalCount: 0 },
    reviews: { nodes: [] },
    ...overrides,
  };
}

function makeGraphQLResponse(opts: {
  isFork?: boolean;
  openIssues?: number;
  closedIssues?: number;
  openPRs?: number;
  closedPRs?: number;
  mergedPRs?: number;
  nodes?: GraphQLPRNode[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}) {
  return {
    repository: {
      isFork: opts.isFork ?? false,
      openIssues: { totalCount: opts.openIssues ?? 0 },
      closedIssues: { totalCount: opts.closedIssues ?? 0 },
      openPRs: { totalCount: opts.openPRs ?? 0 },
      closedPRs: { totalCount: opts.closedPRs ?? 0 },
      mergedPRs: { totalCount: opts.mergedPRs ?? 0 },
      pullRequests: {
        pageInfo: {
          hasNextPage: opts.hasNextPage ?? false,
          endCursor: opts.endCursor ?? null,
        },
        nodes: opts.nodes ?? [],
      },
    },
  };
}

function buildMockOctokit(responses: unknown[]): Octokit {
  let callCount = 0;
  const graphql = async (_query: string, _vars: unknown) => {
    const response = responses[Math.min(callCount, responses.length - 1)];
    callCount++;
    if (response instanceof Error) throw response;
    return response;
  };
  return { graphql } as unknown as Octokit;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("collectRepoGraphQL", () => {
  afterEach(() => resetOctokit());

  it("returns counts and nodes from a single-page response", async () => {
    const node = makePRNode({ number: 42, state: "MERGED" });
    setOctokit(
      buildMockOctokit([
        makeGraphQLResponse({
          isFork: false,
          openIssues: 3,
          closedIssues: 10,
          openPRs: 1,
          closedPRs: 2,
          mergedPRs: 5,
          nodes: [node],
          hasNextPage: false,
        }),
      ])
    );

    const result = await collectRepoGraphQL("owner", "repo");
    expect(result).not.toBeNull();
    expect(result!.isFork).toBe(false);
    expect(result!.openIssueCount).toBe(3);
    expect(result!.closedIssueCount).toBe(10);
    expect(result!.openPRCount).toBe(1);
    expect(result!.closedPRCount).toBe(2);
    expect(result!.mergedPRCount).toBe(5);
    expect(result!.prNodes).toHaveLength(1);
    expect(result!.prNodes[0].number).toBe(42);
  });

  it("paginates through multiple pages and accumulates nodes", async () => {
    const recentDate = new Date().toISOString();
    const node1 = makePRNode({ number: 1, updatedAt: recentDate });
    const node2 = makePRNode({ number: 2, updatedAt: recentDate });

    setOctokit(
      buildMockOctokit([
        makeGraphQLResponse({
          nodes: [node1],
          hasNextPage: true,
          endCursor: "cursor1",
        }),
        makeGraphQLResponse({
          nodes: [node2],
          hasNextPage: false,
          endCursor: null,
        }),
      ])
    );

    const result = await collectRepoGraphQL("owner", "repo", 5);
    expect(result!.prNodes).toHaveLength(2);
    expect(result!.prNodes.map((n) => n.number)).toEqual([1, 2]);
  });

  it("stops paginating when a node's updatedAt is beyond the cutoff", async () => {
    const recentDate = new Date().toISOString();
    // An old date (2 years ago) — beyond the ~13-month cutoff
    const oldDate = new Date(Date.now() - 760 * 24 * 60 * 60 * 1000).toISOString();
    const node1 = makePRNode({ number: 1, updatedAt: recentDate });
    const node2 = makePRNode({ number: 2, updatedAt: oldDate });

    setOctokit(
      buildMockOctokit([
        makeGraphQLResponse({
          nodes: [node1, node2],
          hasNextPage: true,
          endCursor: "cursor1",
        }),
        // Should never be called because cutoff was hit on page 1
        makeGraphQLResponse({ nodes: [makePRNode({ number: 3, updatedAt: recentDate })], hasNextPage: false }),
      ])
    );

    const result = await collectRepoGraphQL("owner", "repo", 10);
    // node2 is beyond cutoff, so it and subsequent pages are skipped
    expect(result!.prNodes).toHaveLength(1);
    expect(result!.prNodes[0].number).toBe(1);
  });

  it("returns null on a NOT_FOUND GraphQL error", async () => {
    const err = Object.assign(new Error("Not found"), {
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }],
    });
    setOctokit(buildMockOctokit([err]));

    const result = await collectRepoGraphQL("owner", "missing-repo");
    expect(result).toBeNull();
  });

  it("returns null and warns on a FORBIDDEN GraphQL error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("Forbidden"), {
      errors: [{ type: "FORBIDDEN", message: "forbidden" }],
    });
    setOctokit(buildMockOctokit([err]));

    const result = await collectRepoGraphQL("owner", "private-repo");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    warnSpy.mockRestore();
  });

  it("returns null on HTTP 404 error", async () => {
    const err = Object.assign(new Error("Not found"), { status: 404 });
    setOctokit(buildMockOctokit([err]));

    const result = await collectRepoGraphQL("owner", "repo");
    expect(result).toBeNull();
  });

  it("re-throws non-transient errors (e.g. 400) immediately without retrying", async () => {
    const err = Object.assign(new Error("Bad request"), { status: 400 });
    setOctokit(buildMockOctokit([err]));

    await expect(collectRepoGraphQL("owner", "repo")).rejects.toMatchObject({ status: 400 });
  });

  it("retries on transient 502 error and succeeds on the retry", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Bad gateway"), { status: 502 });
    const success = makeGraphQLResponse({ nodes: [], hasNextPage: false });
    setOctokit(buildMockOctokit([err, success]));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const p = collectRepoGraphQL("owner", "repo");
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await p;

    expect(result).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("transient"));
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns null and warns after exhausting all transient retries", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Bad gateway"), { status: 502 });
    setOctokit(buildMockOctokit([err])); // clamped — all attempts throw
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultPromise = collectRepoGraphQL("owner", "repo");
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 30_000 + 1);
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("falling back to REST"));
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns empty prNodes for a repo with no PRs", async () => {
    setOctokit(
      buildMockOctokit([
        makeGraphQLResponse({
          openIssues: 5,
          closedIssues: 2,
          nodes: [],
          hasNextPage: false,
        }),
      ])
    );

    const result = await collectRepoGraphQL("owner", "repo");
    expect(result).not.toBeNull();
    expect(result!.prNodes).toHaveLength(0);
    expect(result!.openIssueCount).toBe(5);
  });

  it("respects maxPages limit", async () => {
    let callCount = 0;
    const recentDate = new Date().toISOString();
    const graphql = async () => {
      callCount++;
      return makeGraphQLResponse({
        nodes: [makePRNode({ number: callCount, updatedAt: recentDate })],
        hasNextPage: true,
        endCursor: `cursor${callCount}`,
      });
    };
    setOctokit({ graphql } as unknown as Octokit);

    const result = await collectRepoGraphQL("owner", "repo", 3);
    expect(callCount).toBe(3);
    expect(result!.prNodes).toHaveLength(3);
  });

  it("marks isFork correctly", async () => {
    setOctokit(
      buildMockOctokit([
        makeGraphQLResponse({ isFork: true, nodes: [], hasNextPage: false }),
      ])
    );

    const result = await collectRepoGraphQL("owner", "forked-repo");
    expect(result!.isFork).toBe(true);
  });

  it("returns null and warns when API returns an empty/undefined response body", async () => {
    // GitHub occasionally returns HTTP 200 with data: null or no data field;
    // @octokit/graphql passes through undefined in that case.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(buildMockOctokit([undefined]));

    const result = await collectRepoGraphQL("owner", "repo");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("empty response"));
    warnSpy.mockRestore();
  });
});

