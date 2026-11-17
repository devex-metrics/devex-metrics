import { describe, expect, it } from "vitest";
import { summarizeCommitAttribution } from "./commit-attribution.js";
import type { MergedPRSummary } from "./types.js";

function pr(overrides: Partial<MergedPRSummary> = {}): MergedPRSummary {
  return {
    number: 1,
    createdAt: "2026-01-01T00:00:00Z",
    mergedAt: "2026-01-02T00:00:00Z",
    author: "pr-author",
    isBotAuthor: false,
    isCopilotAuthored: false,
    timeToMergeHours: 24,
    closesIssues: [],
    ...overrides,
  };
}

describe("summarizeCommitAttribution", () => {
  it("matches logins case-insensitively and counts co-authored mixed commits once", () => {
    const result = summarizeCommitAttribution([
      pr({
        commitAuthorSamples: [
          { authors: ["FOCUS"], authorCount: 1, complete: true },
          { authors: ["other"], authorCount: 1, complete: true },
          { authors: ["focus", "other"], authorCount: 2, complete: true },
        ],
        commitAuthorSampleTotalCount: 3,
        commitAuthorSampleComplete: true,
      }),
    ], ["Focus"]);

    expect(result).toMatchObject({
      focusCommits: 1,
      restCommits: 1,
      mixedCommits: 1,
      unavailableCommits: 0,
      incompletePRs: 0,
    });
  });

  it("separates unavailable identities and capped samples from the rest", () => {
    const result = summarizeCommitAttribution([
      pr({
        commitAuthorSamples: [
          { authors: [], authorCount: 1, complete: true },
          { authors: ["focus"], authorCount: 2, complete: false },
        ],
        commitAuthorSampleTotalCount: 4,
        commitAuthorSampleComplete: false,
      }),
      pr({ number: 2, commitAuthorSampleTotalCount: 2 }),
    ], ["focus"]);

    expect(result).toMatchObject({
      focusCommits: 0,
      restCommits: 0,
      mixedCommits: 0,
      unavailableCommits: 6,
      unavailablePRs: 1,
      incompletePRs: 1,
    });
  });

  it("does not claim completeness when a legacy sample lacks a total", () => {
    const result = summarizeCommitAttribution([
      pr({
        commitAuthorSamples: [{ authors: ["focus"], authorCount: 1, complete: true }],
      }),
    ], ["focus"]);

    expect(result.focusCommits).toBe(1);
    expect(result.incompletePRs).toBe(1);
  });

  it("counts a capped co-author sample as an incomplete PR", () => {
    const result = summarizeCommitAttribution([
      pr({
        commitAuthorSamples: [
          { authors: ["focus"], authorCount: 11, complete: false },
        ],
        commitAuthorSampleTotalCount: 1,
        commitAuthorSampleComplete: true,
      }),
    ], ["focus"]);

    expect(result).toMatchObject({
      focusCommits: 0,
      unavailableCommits: 1,
      incompletePRs: 1,
    });
  });
});
