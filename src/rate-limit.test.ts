import type { Octokit } from "@octokit/rest";
import { isRateLimitError } from "./rate-limit.js";
import { resetAgentOctokit, resetOctokit, setAgentOctokit, setOctokit } from "./github-client.js";
import { describeTransientError, isTransientCollectionError, collectRepoGraphQL } from "./collectors/repo-graphql.js";
import { collectIssueLeadTimes } from "./collectors/issues.js";
import { collectMergedPRTimeline, collectPullRequestDetails } from "./collectors/pull-requests.js";
import { countSearchMatches } from "./collectors/search-counts.js";
import { collectWeeklyTrends } from "./collectors/trends.js";
import { fetchWorkflowRunPage } from "./collectors/workflow-runs.js";
import { collectCopilotAgentMetrics } from "./collectors/copilot-agent.js";
import { collectRepos } from "./collectors/repos.js";

/** The error Octokit throws for a primary limit the throttling plugin gave up on. */
function primaryLimit(): Error {
  return Object.assign(new Error("API rate limit exceeded for installation."), {
    status: 403,
    response: { headers: { "x-ratelimit-remaining": "0" }, data: {} },
  });
}

/** The error Octokit throws for a secondary limit the throttling plugin gave up on. */
function secondaryLimit(): Error {
  return Object.assign(new Error("You have exceeded a secondary rate limit."), {
    status: 403,
    response: { headers: { "x-ratelimit-remaining": "4000" }, data: {} },
  });
}

/** The error the throttling plugin throws for a GraphQL `RATE_LIMITED` response. */
function graphqlLimit(): Error {
  const data = { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] };
  return Object.assign(new Error("GraphQL Rate Limit Exceeded"), { response: { headers: {}, data }, data });
}

/** A genuine permission failure: must still be treated as "access denied". */
function permissionDenied(): Error {
  return Object.assign(new Error("Resource not accessible by integration"), {
    status: 403,
    response: { headers: { "x-ratelimit-remaining": "4000" }, data: {} },
  });
}

describe("isRateLimitError", () => {
  it.each([
    ["a 403 with no requests remaining", primaryLimit()],
    ["a 403 secondary limit", secondaryLimit()],
    ["a 429", Object.assign(new Error("Too Many Requests"), { status: 429 })],
    ["a GraphQL RATE_LIMITED response", graphqlLimit()],
    ["a GraphQL RATE_LIMITED error list", Object.assign(new Error("x"), { errors: [{ type: "RATE_LIMITED" }] })],
  ])("recognises %s", (_label, err) => {
    expect(isRateLimitError(err)).toBe(true);
  });

  it.each([
    ["a permission 403", permissionDenied()],
    ["a 404", Object.assign(new Error("Not Found"), { status: 404 })],
    ["a 500", Object.assign(new Error("Server Error"), { status: 500 })],
    ["a GraphQL FORBIDDEN error", Object.assign(new Error("x"), { errors: [{ type: "FORBIDDEN" }] })],
    ["null", null],
    ["a string", "rate limit"],
  ])("does not treat %s as a rate limit", (_label, err) => {
    expect(isRateLimitError(err)).toBe(false);
  });

  it("makes an exhausted rate limit a per-repository transient failure", () => {
    expect(isTransientCollectionError(primaryLimit())).toBe(true);
    expect(describeTransientError(primaryLimit())).toMatch(/rate limit/);
    expect(isTransientCollectionError(permissionDenied())).toBe(false);
  });
});

/**
 * An Octokit stand-in on which every call — REST method, `request`, `graphql`,
 * `paginate` or `paginate.iterator` — fails with `err`.
 */
function failingOctokit(err: Error): Octokit {
  const fail = (): unknown => {
    const rejected = Promise.reject(err);
    rejected.catch(() => undefined);
    return Object.assign(rejected, {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(err) }),
    });
  };
  const proxy: unknown = new Proxy(function () {}, {
    get: (_target, prop) => (prop === "then" ? undefined : proxy),
    apply: fail,
  });
  return proxy as Octokit;
}

/**
 * Every collector that skips a repository on 403 must not read an exhausted
 * rate limit as "access denied": the repository would be recorded with zeros
 * instead of a collection warning.
 */
describe("403 handlers do not swallow rate limits", () => {
  const timeline = [
    { number: 1, createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-02T00:00:00Z", closesIssues: [7] },
  ] as unknown as Parameters<typeof collectIssueLeadTimes>[2];

  const collectors: Array<[string, () => Promise<unknown>]> = [
    ["countSearchMatches", () => countSearchMatches("o", "r", "test", ["is:issue"])],
    ["collectIssueLeadTimes", () => collectIssueLeadTimes("o", "r", timeline)],
    ["collectPullRequestDetails", () => collectPullRequestDetails("o", "r")],
    ["collectMergedPRTimeline", () => collectMergedPRTimeline("o", "r", 1)],
    ["fetchWorkflowRunPage", () => fetchWorkflowRunPage("o", "r", "main", "2026-01-01T00:00:00Z", 1)],
    ["collectCopilotAgentMetrics", () => collectCopilotAgentMetrics("o", "r")],
    ["collectRepos (user)", () => collectRepos("o", "user")],
  ];

  afterEach(() => {
    resetOctokit();
    resetAgentOctokit();
    vi.restoreAllMocks();
  });

  for (const [name, make] of [
    ["primary", primaryLimit],
    ["secondary", secondaryLimit],
  ] as const) {
    it.each(collectors)(`%s re-throws a ${name} rate limit`, async (_label, run) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const err = make();
      setOctokit(failingOctokit(err));
      setAgentOctokit(failingOctokit(err));
      await expect(run()).rejects.toBe(err);
    });
  }

  it.each(collectors.filter(([label]) => label !== "collectRepos (user)"))(
    "%s still skips a genuine permission 403",
    async (_label, run) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      setOctokit(failingOctokit(permissionDenied()));
      setAgentOctokit(failingOctokit(permissionDenied()));
      await expect(run()).resolves.not.toThrow();
    }
  );

  it("collectWeeklyTrends marks the repository failed rather than skipping it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setOctokit(failingOctokit(primaryLimit()));
    const result = await collectWeeklyTrends([{ owner: "o", name: "r" }], 2);
    expect(result.failedRepos.has("o/r")).toBe(true);
  });

  it("collectRepoGraphQL reports a rate limit as unavailable, not as an inaccessible repository", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setOctokit(failingOctokit(graphqlLimit()));
    const result = await collectRepoGraphQL("o", "r", 1);
    expect(result).toMatchObject({ unavailable: true, category: expect.stringMatching(/rate limit/) });
  });
});
