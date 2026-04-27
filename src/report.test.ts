import { describe, it, expect } from "vitest";
import { generateReport } from "./report.js";
import type { OrgMetrics } from "./types.js";

function makeSampleMetrics(): OrgMetrics {
  return {
    owner: "test-org",
    ownerType: "org",
    collectedAt: "2026-03-28T12:00:00Z",
    repoCount: 2,
    repos: [
      {
        name: "repo-a",
        fullName: "test-org/repo-a",
        issues: { open: 5, closed: 20 },
        pullRequests: { open: 2, closed: 1, merged: 15 },
        pullRequestDetails: [
          {
            number: 42,
            title: "Add feature X",
            state: "merged",
            createdAt: "2026-03-01T00:00:00Z",
            author: "dev1",
            isCopilotAuthored: false,
            hasCopilotReview: true,
            linesAdded: 120,
            linesDeleted: 30,
            commentCount: 8,
            commitCount: 3,
            actionsMinutes: 4.5,
            timeToMergeHours: 48,
            mergedAt: "2026-03-03T00:00:00Z",
          },
        ],
        mergedPRTimeline: [
          { number: 42, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-03T00:00:00Z", author: "dev1", isBotAuthor: false, isCopilotAuthored: false, timeToMergeHours: 48, closesIssues: [] },
          { number: 43, createdAt: "2026-03-02T00:00:00Z", mergedAt: "2026-03-04T00:00:00Z", author: "copilot[bot]", isBotAuthor: true, isCopilotAuthored: true, timeToMergeHours: 48, closesIssues: [] },
        ],
        copilotAdoption: { copilotAuthoredPRs: 1, copilotReviewedPRs: 1, totalMergedPRs: 2, totalDetailedPRs: 1 },
        issueLeadTimes: [],
        committerCount: 4,
        reviewerCount: 3,
        contributorCount: 5,
        dependentCount: 10,
      },
      {
        name: "repo-b",
        fullName: "test-org/repo-b",
        issues: { open: 0, closed: 5 },
        pullRequests: { open: 0, closed: 0, merged: 3 },
        pullRequestDetails: [],
        mergedPRTimeline: [],
        copilotAdoption: { copilotAuthoredPRs: 0, copilotReviewedPRs: 0, totalMergedPRs: 0, totalDetailedPRs: 0 },
        issueLeadTimes: [],
        committerCount: 1,
        reviewerCount: 1,
        contributorCount: 1,
        dependentCount: 0,
      },
    ],
  };
}

describe("generateReport", () => {
  it("should produce a Markdown report with a summary", () => {
    const report = generateReport(makeSampleMetrics());

    expect(report).toContain("# DevEx Metrics – test-org");
    expect(report).toContain("Repositories | 2");
    expect(report).toContain("Open issues | 5");
    expect(report).toContain("Closed issues | 25");
    expect(report).toContain("Merged PRs | 18");
  });

  it("should include Copilot adoption metrics in the summary", () => {
    const report = generateReport(makeSampleMetrics());

    expect(report).toContain("Copilot-authored PRs | 1 (50.0%)");
    expect(report).toContain("Copilot-reviewed PRs | 1 (100.0%)");
  });

  it("should include median cycle time in the summary", () => {
    const report = generateReport(makeSampleMetrics());

    expect(report).toContain("Median cycle time");
  });

  it("should list per-repo details", () => {
    const report = generateReport(makeSampleMetrics());

    expect(report).toContain("### test-org/repo-a");
    expect(report).toContain("### test-org/repo-b");
    expect(report).toContain("#42 Add feature X");
    expect(report).toContain("+120/-30");
  });

  it("should handle an empty repos list", () => {
    const metrics: OrgMetrics = {
      owner: "empty-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 0,
      repos: [],
    };
    const report = generateReport(metrics);
    expect(report).toContain("Repositories | 0");
  });

  it("should display pushedAt when present in the repo section", () => {
    const metrics: OrgMetrics = {
      owner: "test-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "pushed-repo",
          fullName: "test-org/pushed-repo",
          pushedAt: "2025-11-15T08:30:00Z",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 0 },
          pullRequestDetails: [],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
        },
      ],
    };
    const report = generateReport(metrics);
    expect(report).toContain("Last pushed: 2025-11-15");
  });

  it("should sort PR details by mergedAt descending in the table", () => {
    const metrics: OrgMetrics = {
      owner: "test-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "repo-a",
          fullName: "test-org/repo-a",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 2 },
          pullRequestDetails: [
            { number: 10, title: "Older PR", state: "merged", mergedAt: "2026-01-01T00:00:00Z", linesAdded: 10, linesDeleted: 2, commentCount: 1, commitCount: 1, actionsMinutes: 0 },
            { number: 20, title: "Newer PR", state: "merged", mergedAt: "2026-03-01T00:00:00Z", linesAdded: 20, linesDeleted: 4, commentCount: 2, commitCount: 2, actionsMinutes: 1 },
          ],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
        },
      ],
    };
    const report = generateReport(metrics);
    const posNewer = report.indexOf("#20 Newer PR");
    const posOlder = report.indexOf("#10 Older PR");
    expect(posNewer).toBeGreaterThanOrEqual(0);
    expect(posOlder).toBeGreaterThanOrEqual(0);
    expect(posNewer).toBeLessThan(posOlder);
  });

  it("should place PRs without mergedAt after those with mergedAt", () => {
    const metrics: OrgMetrics = {
      owner: "test-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "repo-a",
          fullName: "test-org/repo-a",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 2 },
          pullRequestDetails: [
            { number: 5, title: "No date PR", state: "merged", linesAdded: 5, linesDeleted: 1, commentCount: 0, commitCount: 1, actionsMinutes: 0 },
            { number: 6, title: "Has date PR", state: "merged", mergedAt: "2026-03-01T00:00:00Z", linesAdded: 6, linesDeleted: 2, commentCount: 0, commitCount: 1, actionsMinutes: 0 },
          ],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
        },
      ],
    };
    const report = generateReport(metrics);
    const posHasDate = report.indexOf("#6 Has date PR");
    const posNoDate = report.indexOf("#5 No date PR");
    expect(posHasDate).toBeLessThan(posNoDate);
  });
});
