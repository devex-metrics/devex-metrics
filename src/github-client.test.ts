import { describe, it, expect, afterEach, vi } from "vitest";
import { getOctokit, resetOctokit, setOctokit, formatDuration, formatResumeTime } from "./github-client.js";
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

describe("formatDuration", () => {
  it("formats 0 seconds", () => {
    expect(formatDuration(0)).toBe("0 seconds");
  });

  it("formats 1 second", () => {
    expect(formatDuration(1)).toBe("1 second");
  });

  it("formats seconds only", () => {
    expect(formatDuration(30)).toBe("30 seconds");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(90)).toBe("1 minute 30 seconds");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3661)).toBe("1 hour 1 minute 1 second");
  });

  it("formats the real-world example (2757 s)", () => {
    expect(formatDuration(2757)).toBe("45 minutes 57 seconds");
  });

  it("formats whole hours with no remainder", () => {
    expect(formatDuration(7200)).toBe("2 hours");
  });
});

describe("formatResumeTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a UTC timestamp with the correct resume time", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-04-11T10:00:00.000Z").getTime(),
    );
    expect(formatResumeTime(2757)).toBe("2026-04-11 10:45:57 UTC");
  });

  it("returns a UTC timestamp for a short retry", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-04-11T10:00:00.000Z").getTime(),
    );
    expect(formatResumeTime(60)).toBe("2026-04-11 10:01:00 UTC");
  });
});
