import { describe, it, expect, afterEach } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectPullRequestCounts } from "./pull-requests.js";

/** Build a fake Octokit whose pulls.list returns controlled data. */
function buildMockOctokit(opts: {
  openPrsTotal: number;
  closedPrs: Array<{ merged_at: string | null }>;
}) {
  function fakeListResponse(total: number) {
    const data = total > 0 ? [{ id: 1 }] : [];
    const headers: Record<string, string> = {};
    if (total > 1) {
      headers.link = `<https://api.github.com/fake?page=${total}>; rel="last"`;
    }
    return Promise.resolve({ data, headers });
  }

  const mock = {
    rest: {
      pulls: {
        list: ({ state, per_page }: { state: string; per_page: number }) => {
          if (state === "open") {
            return fakeListResponse(opts.openPrsTotal);
          }
          // For closed, return the full array (paginate path)
          return fakeListResponse(opts.closedPrs.length);
        },
      },
    },
    paginate: (_method: unknown, _params: unknown) => {
      // Returns the full closed PR list
      return Promise.resolve(opts.closedPrs);
    },
  } as unknown as Octokit;

  return mock;
}

describe("collectPullRequestCounts", () => {
  afterEach(() => resetOctokit());

  it("should return correct open/closed/merged counts", async () => {
    setOctokit(
      buildMockOctokit({
        openPrsTotal: 4,
        closedPrs: [
          { merged_at: "2026-01-01T00:00:00Z" },
          { merged_at: "2026-01-02T00:00:00Z" },
          { merged_at: null }, // closed but not merged
        ],
      })
    );

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 4, closed: 1, merged: 2 });
  });

  it("should return zeros for an empty repo", async () => {
    setOctokit(
      buildMockOctokit({
        openPrsTotal: 0,
        closedPrs: [],
      })
    );

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0, merged: 0 });
  });

  it("should count all closed as merged when all have merged_at", async () => {
    setOctokit(
      buildMockOctokit({
        openPrsTotal: 0,
        closedPrs: [
          { merged_at: "2026-01-01T00:00:00Z" },
          { merged_at: "2026-01-02T00:00:00Z" },
        ],
      })
    );

    const counts = await collectPullRequestCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0, merged: 2 });
  });
});
