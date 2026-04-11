import { describe, it, expect, vi, afterEach } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import { Octokit } from "@octokit/rest";
import { collectDependentCount } from "./dependents.js";

function buildMockOctokit(opts: { fork: boolean; throws?: boolean }) {
  return {
    rest: {
      repos: {
        get: () => {
          if (opts.throws) {
            return Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }));
          }
          return Promise.resolve({ data: { fork: opts.fork } });
        },
      },
    },
  } as unknown as Octokit;
}

/** Minimal HTML that matches the GitHub dependents page structure. */
function dependentsHtml(count: string): string {
  return `<html><body>
    <a class="btn-link selected" href="/owner/repo/network/dependents?dependent_type=REPOSITORY">
      <svg><path d="M0"></path></svg>
      ${count}
      Repositories
    </a>
  </body></html>`;
}

/** Same count but on a single line (no newline between count and label). */
function dependentsHtmlSameLine(count: string): string {
  return `<html><body>
    <a class="btn-link selected" href="/owner/repo/network/dependents?dependent_type=REPOSITORY">
      <svg><path d="M0"></path></svg> ${count} Repositories
    </a>
  </body></html>`;
}

const LOGIN_HTML = `<html><body><form action="/session"><input type="submit"></form></body></html>`;
const LOGIN_REDIRECT_HTML = `<html><body><a href="/login?return_to=%2Fowner%2Frepo">Sign in</a></body></html>`;

describe("collectDependentCount", () => {
  afterEach(() => {
    resetOctokit();
    vi.restoreAllMocks();
  });

  it("returns 0 for fork repos without making a fetch request", async () => {
    setOctokit(buildMockOctokit({ fork: true }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const count = await collectDependentCount("owner", "forked-repo");

    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses a simple dependent count from HTML", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(dependentsHtml("5")),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(5);
  });

  it("parses large counts with commas", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(dependentsHtml("22,371")),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(22371);
  });

  it("parses count when count and label are on the same line", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(dependentsHtmlSameLine("42")),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(42);
  });

  it("returns 0 when dependent count is 0", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(dependentsHtml("0")),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(0);
  });

  it("returns 0 when fetch returns non-200 status", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(0);
  });

  it("returns 0 when page is a login form (action=/session)", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(LOGIN_HTML),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(0);
  });

  it("returns 0 when page contains a login redirect link", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(LOGIN_REDIRECT_HTML),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(0);
  });

  it("returns 0 when HTML contains no matching dependents pattern", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html><body>Empty page</body></html>"),
    } as Response);

    expect(await collectDependentCount("owner", "repo")).toBe(0);
  });

  it("returns 0 when repos.get throws (e.g. 404)", async () => {
    setOctokit(buildMockOctokit({ fork: false, throws: true }));

    expect(await collectDependentCount("owner", "missing-repo")).toBe(0);
  });

  it("does not match the PACKAGE tab count (only REPOSITORY tab)", async () => {
    setOctokit(buildMockOctokit({ fork: false }));
    // PACKAGE tab is selected, REPOSITORY tab is not — should return 0.
    const html = `<html><body>
      <a class="btn-link " href="/owner/repo/network/dependents?dependent_type=REPOSITORY">
        <svg></svg> 3 Repositories
      </a>
      <a class="btn-link selected" href="/owner/repo/network/dependents?dependent_type=PACKAGE">
        <svg></svg> 99 Packages
      </a>
    </body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    } as Response);

    // Still returns 3 because we look for the REPOSITORY href, not the selected class.
    expect(await collectDependentCount("owner", "repo")).toBe(3);
  });

  it("passes GITHUB_TOKEN as Authorization header when set", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token-xyz";
    setOctokit(buildMockOctokit({ fork: false }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(dependentsHtml("3")),
    } as Response);

    await collectDependentCount("owner", "repo");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "token test-token-xyz"
    );

    if (originalToken !== undefined) {
      process.env.GITHUB_TOKEN = originalToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });
});
