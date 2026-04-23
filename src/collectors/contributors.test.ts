import { describe, it, expect, afterEach } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectContributors } from "./contributors.js";

type CommitEntry = {
  author: { login: string } | null;
  commit: { author: { email: string } | null };
};
type PREntry = { number: number };
type ReviewEntry = { user: { login: string } | null };

function buildMockOctokit(opts: {
  commits?: CommitEntry[];
  commitsThrow?: boolean;
  prs?: PREntry[];
  prsThrow?: boolean;
  reviews?: Map<number, ReviewEntry[]>;
  reviewsThrow?: Set<number>;
}): Octokit {
  const commits = opts.commits ?? [];
  const prs = opts.prs ?? [];
  const reviews = opts.reviews ?? new Map<number, ReviewEntry[]>();
  const reviewsThrow = opts.reviewsThrow ?? new Set<number>();

  async function* commitsIterator(_method: unknown, _params: unknown) {
    if (opts.commitsThrow) throw new Error("Not accessible");
    yield { data: commits };
  }

  const paginateFn = Object.assign(() => Promise.resolve([]), {
    iterator: commitsIterator,
  });

  return {
    rest: {
      repos: { listCommits: {} },
      pulls: {
        list: async () => {
          if (opts.prsThrow) throw new Error("No pulls");
          return { data: prs };
        },
        listReviews: async ({ pull_number }: { pull_number: number }) => {
          if (reviewsThrow.has(pull_number)) throw new Error("Reviews inaccessible");
          return { data: reviews.get(pull_number) ?? [] };
        },
      },
    },
    paginate: paginateFn,
  } as unknown as Octokit;
}

describe("collectContributors", () => {
  afterEach(() => resetOctokit());

  it("counts unique committers by login", async () => {
    setOctokit(
      buildMockOctokit({
        commits: [
          { author: { login: "alice" }, commit: { author: { email: "a@x.com" } } },
          { author: { login: "bob" }, commit: { author: { email: "b@x.com" } } },
          { author: { login: "alice" }, commit: { author: { email: "a@x.com" } } }, // duplicate
        ],
      })
    );

    const result = await collectContributors("owner", "repo");
    expect(result.committerCount).toBe(2);
  });

  it("falls back to commit.author.email when author.login is null", async () => {
    setOctokit(
      buildMockOctokit({
        commits: [
          { author: null, commit: { author: { email: "bot@ci.com" } } },
          { author: null, commit: { author: { email: "bot@ci.com" } } }, // same email – deduped
          { author: null, commit: { author: { email: "other@ci.com" } } },
        ],
      })
    );

    const result = await collectContributors("owner", "repo");
    expect(result.committerCount).toBe(2);
  });

  it("counts unique reviewers from PR reviews across multiple PRs", async () => {
    const reviews = new Map([
      [1, [{ user: { login: "alice" } }, { user: { login: "carol" } }]],
      [2, [{ user: { login: "bob" } }]],
    ]);
    setOctokit(buildMockOctokit({ prs: [{ number: 1 }, { number: 2 }], reviews }));

    const result = await collectContributors("owner", "repo");
    expect(result.reviewerCount).toBe(3);
  });

  it("deduplicates reviewers who appear on multiple PRs", async () => {
    const reviews = new Map([
      [1, [{ user: { login: "alice" } }]],
      [2, [{ user: { login: "alice" } }]],
    ]);
    setOctokit(buildMockOctokit({ prs: [{ number: 1 }, { number: 2 }], reviews }));

    const result = await collectContributors("owner", "repo");
    expect(result.reviewerCount).toBe(1);
  });

  it("does not count reviewers with no user login", async () => {
    const reviews = new Map([[1, [{ user: null }]]]);
    setOctokit(buildMockOctokit({ prs: [{ number: 1 }], reviews }));

    const result = await collectContributors("owner", "repo");
    expect(result.reviewerCount).toBe(0);
  });

  it("returns 0 committers but still counts reviewers when commit fetch fails", async () => {
    const reviews = new Map([[1, [{ user: { login: "alice" } }]]]);
    setOctokit(
      buildMockOctokit({ commitsThrow: true, prs: [{ number: 1 }], reviews })
    );

    const result = await collectContributors("owner", "repo");
    expect(result.committerCount).toBe(0);
    expect(result.reviewerCount).toBe(1);
  });

  it("preserves committer count but returns 0 reviewers when pulls.list fails", async () => {
    setOctokit(
      buildMockOctokit({
        commits: [{ author: { login: "alice" }, commit: { author: null } }],
        prsThrow: true,
      })
    );

    const result = await collectContributors("owner", "repo");
    expect(result.committerCount).toBe(1);
    expect(result.reviewerCount).toBe(0);
  });

  it("skips a PR whose listReviews throws and still counts reviewers for others", async () => {
    const reviews = new Map([[2, [{ user: { login: "bob" } }]]]);
    setOctokit(
      buildMockOctokit({
        prs: [{ number: 1 }, { number: 2 }],
        reviews,
        reviewsThrow: new Set([1]), // PR 1 throws, PR 2 succeeds
      })
    );

    const result = await collectContributors("owner", "repo");
    expect(result.reviewerCount).toBe(1);
  });

  it("returns zeros when both the commit and PR paths fail", async () => {
    setOctokit(buildMockOctokit({ commitsThrow: true, prsThrow: true }));

    const result = await collectContributors("owner", "repo");
    expect(result.committerCount).toBe(0);
    expect(result.reviewerCount).toBe(0);
  });

  it("uses pre-fetched reviewerLogins when provided and skips REST review calls", async () => {
    let reviewsCallCount = 0;
    const octokit = buildMockOctokit({
      commits: [{ author: { login: "alice" }, commit: { author: null } }],
      prs: [{ number: 1 }],
      reviews: new Map([[1, [{ user: { login: "shouldNotCount" } }]]]),
    });
    // Wrap listReviews to count calls
    const origListReviews = (octokit as unknown as { rest: { pulls: { listReviews: (...args: unknown[]) => unknown } } }).rest.pulls.listReviews;
    (octokit as unknown as { rest: { pulls: { listReviews: (...args: unknown[]) => unknown } } }).rest.pulls.listReviews = async (...args: unknown[]) => {
      reviewsCallCount++;
      return origListReviews(...args);
    };
    setOctokit(octokit);

    const prefetched = new Set(["bob", "carol"]);
    const result = await collectContributors("owner", "repo", prefetched);
    expect(result.committerCount).toBe(1);
    expect(result.reviewerCount).toBe(2);
    // Should not have called REST listReviews at all
    expect(reviewsCallCount).toBe(0);
  });

  it("returns 0 reviewerCount when pre-fetched set is empty", async () => {
    setOctokit(buildMockOctokit({ commits: [] }));

    const result = await collectContributors("owner", "repo", new Set());
    expect(result.reviewerCount).toBe(0);
  });
});
