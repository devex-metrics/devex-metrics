import { describe, it, expect, afterEach } from "vitest";
import { getOctokit, resetOctokit, setOctokit } from "./github-client.js";
import { Octokit } from "@octokit/rest";

describe("github-client", () => {
  afterEach(() => {
    resetOctokit();
    delete process.env.GITHUB_TOKEN;
  });

  it("should throw when GITHUB_TOKEN is not set", () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => getOctokit()).toThrow("GITHUB_TOKEN");
  });

  it("should return an Octokit instance when token is set", () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const octokit = getOctokit();
    expect(octokit).toBeInstanceOf(Octokit);
  });

  it("should return the same instance on subsequent calls", () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const a = getOctokit();
    const b = getOctokit();
    expect(a).toBe(b);
  });

  it("should allow injecting a mock via setOctokit", () => {
    const mock = new Octokit();
    setOctokit(mock);
    expect(getOctokit()).toBe(mock);
  });
});
