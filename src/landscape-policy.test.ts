import * as fs from "node:fs";
import * as path from "node:path";
import type { Octokit } from "@octokit/rest";
import { assertLandscapePublication, markPrivateLandscapeStore } from "./landscape-policy.js";

describe("private landscape publication policy", () => {
  let root: string;
  const env = {
    GITHUB_REPOSITORY: "acme/dashboard",
    DEVEX_PUBLICATION_TOKEN: "synthetic-destination-token",
  };
  beforeEach(() => {
    fs.mkdirSync("data", { recursive: true });
    root = fs.mkdtempSync(path.resolve("data", "landscape-policy-test-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function api(isPrivate: unknown = true, pagesPublic: unknown = false, name = "acme/dashboard") {
    const get = vi.fn().mockResolvedValue({ data: { private: isPrivate, full_name: name } });
    const getPages = vi.fn().mockResolvedValue({ data: { public: pagesPublic } });
    const client = { rest: { repos: { get, getPages } } } as unknown as Pick<Octokit, "rest">;
    return { client, get, getPages };
  }

  it("leaves existing public-only deployments offline and credential-free", async () => {
    const { client, get, getPages } = api();
    await assertLandscapePublication(root, false, {}, client);
    expect(get).not.toHaveBeenCalled();
    expect(getPages).not.toHaveBeenCalled();
  });

  it("requires both a private repository and private Pages, verified with destination credentials", async () => {
    const { client, get, getPages } = api(true, false, "ACME/Dashboard");
    await assertLandscapePublication(root, true, env, client);
    expect(get).toHaveBeenCalledWith({ owner: "acme", repo: "dashboard" });
    expect(getPages).toHaveBeenCalledWith({ owner: "acme", repo: "dashboard" });
  });

  it.each([false, undefined, "true"])("rejects non-private or unknown destination visibility (%s)", async (value) => {
    const { client, get, getPages } = api();
    get.mockResolvedValueOnce({
      data: { private: value, full_name: "acme/dashboard" },
    });
    await expect(assertLandscapePublication(root, true, env, client)).rejects.toThrow(/private destination/);
    expect(getPages).not.toHaveBeenCalled();
  });

  it.each([true, undefined, "false"])("rejects public or unknown Pages visibility (%s)", async (value) => {
    const { client, getPages } = api();
    getPages.mockResolvedValueOnce({ data: { public: value } });
    await expect(assertLandscapePublication(root, true, env, client)).rejects.toThrow(/access-controlled/);
  });

  it("rejects mismatched destination identity and unavailable APIs", async () => {
    const other = api(true, false, "another/dashboard");
    await expect(assertLandscapePublication(root, true, env, other.client)).rejects.toThrow(/private destination/);
    const denied = api();
    denied.getPages.mockRejectedValueOnce(new Error("403 Pages read permission required"));
    await expect(assertLandscapePublication(root, true, env, denied.client)).rejects.toThrow(/403/);
    denied.get.mockRejectedValueOnce(new Error("404 destination not accessible"));
    await expect(assertLandscapePublication(root, true, env, denied.client)).rejects.toThrow(/404/);
  });

  it.each([
    {}, { GITHUB_REPOSITORY: "acme/dashboard" },
    { ...env, GITHUB_REPOSITORY: "invalid" },
    { ...env, GITHUB_REPOSITORY: "acme/dashboard/extra" },
  ])("cannot opt in using unverifiable local claims or source credentials", async (settings) => {
    await expect(assertLandscapePublication(root, true, settings)).rejects.toThrow(/DEVEX_PUBLICATION_TOKEN/);
  });

  it("keeps guarding private history after the opt-in or feature is disabled", async () => {
    markPrivateLandscapeStore(root);
    const { client, get } = api();
    await assertLandscapePublication(root, false, env, client);
    expect(get).toHaveBeenCalledOnce();
    await expect(assertLandscapePublication(root, false, {})).rejects.toThrow(/DEVEX_PUBLICATION_TOKEN/);
    const publicDestination = api(false);
    await expect(assertLandscapePublication(root, false, env, publicDestination.client))
      .rejects.toThrow(/private destination/);
  });
});
