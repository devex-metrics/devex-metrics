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
            linesAdded: 120,
            linesDeleted: 30,
            commentCount: 8,
            commitCount: 3,
            actionsMinutes: 4.5,
          },
        ],
        committerCount: 4,
        reviewerCount: 3,
        dependentCount: 10,
      },
      {
        name: "repo-b",
        fullName: "test-org/repo-b",
        issues: { open: 0, closed: 5 },
        pullRequests: { open: 0, closed: 0, merged: 3 },
        pullRequestDetails: [],
        committerCount: 1,
        reviewerCount: 1,
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
});
