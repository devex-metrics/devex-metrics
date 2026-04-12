import { describe, it, expect, afterEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectIssueCounts } from "./issues.js";

/** Build a fake Octokit whose issues list endpoint returns controlled Link headers. */
function buildMockOctokit(opts: {
  openIssuesTotal: number;
  closedIssuesTotal: number;
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
    },
  } as unknown as Octokit;
}

describe("collectIssueCounts", () => {
  afterEach(() => resetOctokit());

  it("should return issue counts directly from the issues API", async () => {
    setOctokit(
      buildMockOctokit({
        openIssuesTotal: 7,
        closedIssuesTotal: 15,
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
      })
    );

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });

  it("should return zero counts when repo is not found (404)", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listForRepo: () => Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectIssueCounts("owner", "missing-repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
  });

  it("should rethrow errors that are not 404", async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listForRepo: () => Promise.reject(Object.assign(new Error("Server Error"), { status: 500 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    await expect(collectIssueCounts("owner", "repo")).rejects.toMatchObject({ status: 500 });
  });

  it("should return zero counts on 403 and emit a console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockOctokit = {
      rest: {
        issues: {
          listForRepo: () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 })),
        },
      },
    } as unknown as Octokit;
    setOctokit(mockOctokit);

    const counts = await collectIssueCounts("owner", "repo");
    expect(counts).toEqual({ open: 0, closed: 0 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    warnSpy.mockRestore();
  });
});
