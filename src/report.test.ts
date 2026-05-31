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

  it("should include Copilot agent metrics in the summary and per-repo sections", () => {
    const metrics: OrgMetrics = {
      owner: "test-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "agent-repo",
          fullName: "test-org/agent-repo",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 0 },
          pullRequestDetails: [],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
          copilotAgentMetrics: {
            totalTasks: 10,
            completedTasks: 6,
            failedTasks: 2,
            cancelledTasks: 1,
            timedOutTasks: 0,
            activeTasksCount: 1,
            totalSessions: 12,
            cloudAgentSessions: 8,
            cliRemoteSessions: 4,
            totalCreditsUsed: 42.5,
            avgCompletedSessionHours: 1.5,
            agentCreatedPRs: 5,
            agentActionsMinutes: 33.25,
          },
        },
      ],
    };
    const report = generateReport(metrics);

    // Summary block
    expect(report).toContain("Copilot agent tasks | 10");
    expect(report).toContain("Agent tasks completed | 6");
    expect(report).toContain("Agent tasks failed | 2");
    expect(report).toContain("Agent sessions | 12 (8 cloud / 4 CLI)");
    expect(report).toContain("Agent credits used | 42.5");
    expect(report).toContain("PRs created by agent | 5");
    expect(report).toContain("Agent PR Actions minutes | 33.3");

    // Per-repo block
    expect(report).toContain("**Copilot Agent (30-day window)**");
    expect(report).toContain("| Total tasks | 10 |");
    expect(report).toContain("| Completed | 6 |");
    expect(report).toContain("| Failed | 2 |");
    expect(report).toContain("| Cancelled | 1 |");
    expect(report).toContain("| Active | 1 |");
    expect(report).toContain("| Sessions | 12 |");
    expect(report).toContain("| Cloud agent sessions | 8 |");
    expect(report).toContain("| Credits used | 42.5 |");
    expect(report).toContain("| Avg session duration | 1.5h |");
    expect(report).toContain("| PRs created | 5 |");
    expect(report).toContain("| Actions minutes (agent PRs) | 33.3 |");
  });

  it("should omit optional agent rows when their values are zero or undefined", () => {
    const metrics: OrgMetrics = {
      owner: "test-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "agent-repo",
          fullName: "test-org/agent-repo",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 0 },
          pullRequestDetails: [],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
          copilotAgentMetrics: {
            totalTasks: 3,
            completedTasks: 3,
            failedTasks: 0,
            cancelledTasks: 0,
            timedOutTasks: 0,
            activeTasksCount: 0,
            totalSessions: 3,
            cloudAgentSessions: 0,
            cliRemoteSessions: 3,
            totalCreditsUsed: 0,
            agentCreatedPRs: 0,
            agentActionsMinutes: 0,
          },
        },
      ],
    };
    const report = generateReport(metrics);

    // Required rows still present
    expect(report).toContain("Copilot agent tasks | 3");
    expect(report).toContain("| Total tasks | 3 |");
    // Optional rows omitted
    expect(report).not.toContain("Agent credits used");
    expect(report).not.toContain("PRs created by agent");
    expect(report).not.toContain("Agent PR Actions minutes");
    expect(report).not.toContain("| Failed |");
    expect(report).not.toContain("| Cancelled |");
    expect(report).not.toContain("| Active |");
    expect(report).not.toContain("| Cloud agent sessions |");
    expect(report).not.toContain("| Credits used |");
    expect(report).not.toContain("| Avg session duration |");
    expect(report).not.toContain("| PRs created |");
    expect(report).not.toContain("| Actions minutes (agent PRs) |");
  });

  it("should not throw when optional numeric agent fields are undefined", () => {
    const metrics: OrgMetrics = {
      owner: "test-org",
      ownerType: "org",
      collectedAt: "2026-03-28T12:00:00Z",
      repoCount: 1,
      repos: [
        {
          name: "agent-repo",
          fullName: "test-org/agent-repo",
          issues: { open: 0, closed: 0 },
          pullRequests: { open: 0, closed: 0, merged: 0 },
          pullRequestDetails: [],
          committerCount: 0,
          reviewerCount: 0,
          contributorCount: 0,
          dependentCount: 0,
          // agentActionsMinutes intentionally omitted to mirror real cached data
          copilotAgentMetrics: {
            totalTasks: 5,
            completedTasks: 3,
            failedTasks: 1,
            cancelledTasks: 0,
            timedOutTasks: 0,
            activeTasksCount: 1,
            totalSessions: 8,
            cloudAgentSessions: 6,
            cliRemoteSessions: 2,
            totalCreditsUsed: 12.5,
            avgCompletedSessionHours: 0.75,
            agentCreatedPRs: 3,
          } as OrgMetrics["repos"][number]["copilotAgentMetrics"],
        },
      ],
    };

    let report = "";
    expect(() => {
      report = generateReport(metrics);
    }).not.toThrow();
    // The actions-minutes row must be skipped, not rendered as "NaN" or "undefined"
    expect(report).not.toContain("Actions minutes (agent PRs)");
    expect(report).not.toContain("Agent PR Actions minutes");
    expect(report).toContain("| Total tasks | 5 |");
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
