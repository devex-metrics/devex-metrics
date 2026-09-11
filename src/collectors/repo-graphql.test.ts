import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import type { Octokit } from "@octokit/rest";
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
    commits: { totalCount: 1, nodes: [] },
    comments: { totalCount: 0 },
    reviewThreads: { totalCount: 0 },
    reviews: { nodes: [] },
    mergeCommit: null,
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


describe("collectRepoGraphQL open pull requests", () => {
  afterEach(() => resetOctokit());

  it("returns an empty list when the response carries no open-PR connection", async () => {
    setOctokit(buildMockOctokit([makeGraphQLResponse({ hasNextPage: false })]));
    const result = await collectRepoGraphQL("owner", "repo");
    expect(result!.openPRNodes).toEqual([]);
  });

  it("captures the open pull requests from the first page", async () => {
    const response = makeGraphQLResponse({ hasNextPage: false }) as {
      repository: Record<string, unknown>;
    };
    response.repository.openPRList = {
      nodes: [
        {
          number: 7,
          createdAt: "2026-01-01T00:00:00Z",
          author: { login: "amy", __typename: "User" },
        },
      ],
    };
    setOctokit(buildMockOctokit([response]));
    const result = await collectRepoGraphQL("owner", "repo");
    expect(result!.openPRNodes).toHaveLength(1);
    expect(result!.openPRNodes[0].number).toBe(7);
  });

  it("asks for the open-PR list only on the first page", async () => {
    const recentDate = new Date().toISOString();
    const seen: boolean[] = [];
    const responses = [
      makeGraphQLResponse({
        nodes: [makePRNode({ number: 1, updatedAt: recentDate })],
        hasNextPage: true,
        endCursor: "cursor1",
      }),
      makeGraphQLResponse({
        nodes: [makePRNode({ number: 2, updatedAt: recentDate })],
        hasNextPage: false,
      }),
    ];
    let callCount = 0;
    const graphql = async (_query: string, vars: { firstPage?: boolean }) => {
      seen.push(vars.firstPage === true);
      const response = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return response;
    };
    setOctokit({ graphql } as unknown as Octokit);

    await collectRepoGraphQL("owner", "repo", 2);
    expect(seen).toEqual([true, false]);
  });

  it("returns empty lists when maxPages is zero", async () => {
    setOctokit(buildMockOctokit([makeGraphQLResponse({ hasNextPage: false })]));
    const result = await collectRepoGraphQL("owner", "repo", 0);
    expect(result!.prNodes).toEqual([]);
    expect(result!.openPRNodes).toEqual([]);
  });
});

// ── Historical backfill with adaptive page sizing ────────────────────────────

import { fetchHistoricalPRPage, pageSizeReductionSequence } from "./repo-graphql.js";
import type { HistoricalPRNode } from "./repo-graphql.js";

function makeHistoricalNode(overrides: Partial<HistoricalPRNode> = {}): HistoricalPRNode {
  return {
    number: 1,
    state: "MERGED",
    createdAt: "2019-01-01T00:00:00Z",
    mergedAt: "2019-01-02T00:00:00Z",
    closedAt: "2019-01-02T00:00:00Z",
    author: { login: "alice", __typename: "User" },
    additions: 1,
    deletions: 1,
    body: null,
    reviews: { totalCount: 0, nodes: [] },
    ...overrides,
  };
}

function makeHistoricalResponse(opts: {
  nodes?: HistoricalPRNode[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}) {
  return {
    repository: {
      pullRequests: {
        pageInfo: { hasNextPage: opts.hasNextPage ?? false, endCursor: opts.endCursor ?? null },
        nodes: opts.nodes ?? [],
      },
    },
  };
}

const DEFAULT_OPTIONS = { pageSize: 50, minPageSize: 10, adaptive: true };

describe("pageSizeReductionSequence", () => {
  it("halves down to the minimum, matching the documented example", () => {
    expect(pageSizeReductionSequence(50, 10)).toEqual([50, 25, 12, 10]);
  });

  it("stops immediately when initial already equals the minimum", () => {
    expect(pageSizeReductionSequence(10, 10)).toEqual([10]);
  });

  it("never drops below the minimum even with an odd initial size", () => {
    const sizes = pageSizeReductionSequence(15, 10);
    expect(sizes[sizes.length - 1]).toBe(10);
    expect(sizes.every((s) => s >= 10)).toBe(true);
  });

  it("produces a strictly decreasing sequence until the minimum", () => {
    const sizes = pageSizeReductionSequence(100, 5);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
    expect(sizes[sizes.length - 1]).toBe(5);
  });
});

describe("fetchHistoricalPRPage", () => {
  afterEach(() => resetOctokit());

  it("uses the configured page size as the `first` GraphQL variable", async () => {
    let seenVars: Record<string, unknown> | undefined;
    const graphql = async (_query: string, vars: Record<string, unknown>) => {
      seenVars = vars;
      return makeHistoricalResponse({ nodes: [makeHistoricalNode()], hasNextPage: false });
    };
    setOctokit({ graphql } as unknown as Octokit);

    await fetchHistoricalPRPage("owner", "repo", null, DEFAULT_OPTIONS);
    expect(seenVars).toMatchObject({ owner: "owner", name: "repo", cursor: null, pageSize: 50 });
  });

  it("returns the configured page size unchanged on a normal successful page", async () => {
    setOctokit(
      buildMockOctokit([makeHistoricalResponse({ nodes: [makeHistoricalNode()], hasNextPage: false })])
    );
    const page = await fetchHistoricalPRPage("owner", "repo", null, DEFAULT_OPTIONS);
    expect(page).not.toBeNull();
    expect(page!.pageSize).toBe(50);
  });

  it("retries the same cursor at a smaller page size on a 502, and does not append or advance for the failed attempt", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Bad gateway"), { status: 502 });
    const success = makeHistoricalResponse({
      nodes: [makeHistoricalNode({ number: 2 })],
      hasNextPage: false,
      endCursor: "cursor-2",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(buildMockOctokit([err, success]));

    const pagePromise = fetchHistoricalPRPage("owner", "repo", "cursor-1", DEFAULT_OPTIONS);
    await vi.advanceTimersByTimeAsync(5_001);
    const page = await pagePromise;

    expect(page).not.toBeNull();
    expect(page!.pageSize).toBe(25);
    expect(page!.nodes).toHaveLength(1);
    expect(page!.endCursor).toBe("cursor-2");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("historical page timed out at size 50")
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("page size 25"));
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("retries the same cursor at a smaller page size on a 504", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Gateway timeout"), { status: 504 });
    const success = makeHistoricalResponse({ nodes: [], hasNextPage: false });
    setOctokit(buildMockOctokit([err, success]));
    const pagePromise = fetchHistoricalPRPage("owner", "repo", null, DEFAULT_OPTIONS);
    await vi.advanceTimersByTimeAsync(5_001);
    const page = await pagePromise;
    expect(page).not.toBeNull();
    expect(page!.pageSize).toBe(25);
    vi.useRealTimers();
  });

  it("reduces the page size on a generic GraphQL execution error with no usable data", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Something went wrong"), {
      errors: [{ message: "Something went wrong while executing your query. Please include `abc123` when reporting this issue." }],
    });
    const success = makeHistoricalResponse({ nodes: [], hasNextPage: false });
    setOctokit(buildMockOctokit([err, success]));
    const pagePromise = fetchHistoricalPRPage("owner", "repo", null, DEFAULT_OPTIONS);
    await vi.advanceTimersByTimeAsync(5_001);
    const page = await pagePromise;
    expect(page).not.toBeNull();
    expect(page!.pageSize).toBe(25);
    vi.useRealTimers();
  });

  it("does not reduce the page size for a GraphQL validation error — it is fatal instead", async () => {
    const err = Object.assign(new Error("Validation failed"), {
      errors: [{ type: "GRAPHQL_VALIDATION_FAILED", message: "Field 'bogus' doesn't exist on type 'PullRequest'" }],
    });
    setOctokit(buildMockOctokit([err]));
    await expect(fetchHistoricalPRPage("owner", "repo", null, DEFAULT_OPTIONS)).rejects.toThrow();
  });

  it("does not reduce the page size for a repository-not-found error — it returns null unchanged", async () => {
    const err = Object.assign(new Error("Not found"), {
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }],
    });
    setOctokit(buildMockOctokit([err]));
    const page = await fetchHistoricalPRPage("owner", "repo", null, DEFAULT_OPTIONS);
    expect(page).toBeNull();
  });

  it("stops reducing at the configured minimum and defers (returns null) when it keeps failing", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Bad gateway"), { status: 502 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(buildMockOctokit([err])); // every attempt fails, at every size

    const pagePromise = fetchHistoricalPRPage("owner", "repo", "cursor-1", DEFAULT_OPTIONS);
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 30_000 + 1);
    const page = await pagePromise;

    expect(page).toBeNull();
    // Bounded: exactly one attempt per size in the sequence [50, 25, 12, 10] = 4.
    expect((warnSpy.mock.calls as unknown[][]).length).toBe(4);
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("still timing out at the minimum page size")
    );
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("makes a single request and does not reduce when adaptive sizing is disabled", async () => {
    const err = Object.assign(new Error("Bad gateway"), { status: 502 });
    let callCount = 0;
    const graphql = async () => {
      callCount++;
      throw err;
    };
    setOctokit({ graphql } as unknown as Octokit);

    const page = await fetchHistoricalPRPage("owner", "repo", null, {
      pageSize: 50,
      minPageSize: 10,
      adaptive: false,
    });

    expect(page).toBeNull();
    expect(callCount).toBe(1);
  });

  it("does not advance past the failed page — a subsequent call with the same cursor is what the caller must retry", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error("Bad gateway"), { status: 502 });
    setOctokit(buildMockOctokit([err]));
    const pagePromise = fetchHistoricalPRPage("owner", "repo", "cursor-X", DEFAULT_OPTIONS);
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 30_000 + 1);
    const page = await pagePromise;
    expect(page).toBeNull();
    vi.useRealTimers();
  });
});
