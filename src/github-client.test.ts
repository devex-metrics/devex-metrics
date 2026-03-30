import { describe, it, expect, afterEach } from "vitest";
import { getOctokit, resetOctokit, setOctokit } from "./github-client.js";
import { Octokit } from "@octokit/rest";

describe("github-client", () => {
  afterEach(() => {
    resetOctokit();
    delete process.env.GITHUB_TOKEN;
    delete process.env.APP_ID;
    delete process.env.APP_PRIVATE_KEY;
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

  it("should prefer GitHub App auth over GITHUB_TOKEN when APP_ID and APP_PRIVATE_KEY are set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    process.env.APP_ID = "12345";
    process.env.APP_PRIVATE_KEY = "fake-private-key";
    // App auth path is taken; listInstallations will fail with a fake key
    // but the Octokit is created with the app auth strategy, confirming preference
    await expect(getOctokit()).rejects.toThrow();
  });

  it("should create an Octokit instance with rate-limit throttling enabled", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const octokit = await getOctokit();
    // The throttling plugin is registered on the constructor.
    const ctor = octokit.constructor as typeof Octokit & { plugins?: Array<{ name?: string }> };
    const pluginNames = ctor.plugins?.map((p) => p.name) ?? [];
    expect(pluginNames).toContain("throttling");
  });
});
