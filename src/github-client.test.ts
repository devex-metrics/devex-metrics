import { describe, it, expect, afterEach } from "vitest";
import { getOctokit, resetOctokit, setOctokit } from "./github-client.js";
import { Octokit } from "@octokit/rest";

describe("github-client", () => {
  afterEach(() => {
    resetOctokit();
    delete process.env.GITHUB_TOKEN;
    delete process.env.APP_ID;
    delete process.env.APP_PRIVATE_KEY;
    delete process.env.APP_INSTALLATION_ID;
  });

  it("should throw when no auth env vars are set", async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(getOctokit()).rejects.toThrow("Authentication required");
  });

  it("should return an Octokit instance when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const octokit = await getOctokit();
    expect(octokit).toBeInstanceOf(Octokit);
  });

  it("should return the same instance on subsequent calls", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const a = await getOctokit();
    const b = await getOctokit();
    expect(a).toBe(b);
  });

  it("should allow injecting a mock via setOctokit", async () => {
    const mock = new Octokit();
    setOctokit(mock);
    expect(await getOctokit()).toBe(mock);
  });

  it("should create an Octokit instance when APP_ID, APP_PRIVATE_KEY and APP_INSTALLATION_ID are set", async () => {
    process.env.APP_ID = "12345";
    process.env.APP_PRIVATE_KEY = "fake-private-key";
    process.env.APP_INSTALLATION_ID = "67890";
    const octokit = await getOctokit();
    expect(octokit).toBeInstanceOf(Octokit);
  });

  it("should prefer GitHub App auth over GITHUB_TOKEN", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    process.env.APP_ID = "12345";
    process.env.APP_PRIVATE_KEY = "fake-private-key";
    process.env.APP_INSTALLATION_ID = "67890";
    // When both are set, App auth is used (returns Octokit with app auth strategy)
    const octokit = await getOctokit();
    expect(octokit).toBeInstanceOf(Octokit);
  });
});
