import { describe, it, expect, afterEach } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectIssueCounts } from "./issues.js";

/** Build a fake Octokit whose list endpoints return controlled Link headers. */
function buildMockOctokit(opts: {
  openIssuesTotal: number;
  closedIssuesTotal: number;
  openPrsTotal: number;
  closedPrsTotal: number;
}) {
  function fakeResponse(total: number) {
    const data = total > 0 ? [{ id: 1 }] : [];
    const headers: Record<string, string> = {};
    if (total > 1) {
      headers.link = `<https://api.github.com/fake?page=${total}>; rel="last"`;
    }
    return Promise.resolve({ data, headers });
  }

  return {
    rest: {
      issues: {
        listForRepo: ({ state }: { state: string }) =>
          fakeResponse(state === "open" ? opts.openIssuesTotal : opts.closedIssuesTotal),
      },
      pulls: {
        list: ({ state }: { state: string }) =>
          fakeResponse(state === "open" ? opts.openPrsTotal : opts.closedPrsTotal),
      },
    },
  } as unknown as Octokit;
}

describe("collectIssueCounts", () => {
  afterEach(() => resetOctokit());

  it("should return correct counts when issues and PRs exist", async () => {
    setOctokit(
      buildMockOctokit({
        openIssuesTotal: 10,  // includes PRs
        closedIssuesTotal: 20,
        openPrsTotal: 3,
        closedPrsTotal: 5,
      })
    );

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 7, closed: 15 });
  });

  it("should return zero counts for an empty repo", async () => {
    setOctokit(
      buildMockOctokit({
        openIssuesTotal: 0,
        closedIssuesTotal: 0,
        openPrsTotal: 0,
        closedPrsTotal: 0,
      })
    );

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });

  it("should return zero issues when all items are PRs", async () => {
    setOctokit(
      buildMockOctokit({
        openIssuesTotal: 5,
        closedIssuesTotal: 3,
        openPrsTotal: 5,
        closedPrsTotal: 3,
      })
    );

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });
});
