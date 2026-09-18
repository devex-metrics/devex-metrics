import { describe, it, expect } from "vitest";
import { buildRepoRow } from "./repo-row.js";
import type { RepoMetrics, PullRequestDetail, CopilotAgentMetrics } from "../types.js";

function pr(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: 1,
    title: "Some change",
    state: "merged",
    createdAt: "2026-01-01T00:00:00Z",
    author: "octocat",
    isCopilotAuthored: false,
    hasCopilotReview: false,
    linesAdded: 10,
    linesDeleted: 2,
    commentCount: 1,
    commitCount: 1,
    actionsMinutes: 5,
    ...overrides,
  };
}

function repo(overrides: Partial<RepoMetrics> = {}): RepoMetrics {
  return {
    name: "repo",
    fullName: "acme/repo",
    issues: { open: 2, closed: 3 },
    pullRequests: { open: 1, closed: 0, merged: 4 },
    pullRequestDetails: [],
    committerCount: 2,
    reviewerCount: 1,
    contributorCount: 3,
    dependentCount: 0,
    ...overrides,
  };
}

describe("buildRepoRow", () => {
  it("renders the data row and an initially hidden detail row", () => {
    const html = buildRepoRow(repo());
    expect(html).toContain('class="repo-row"');
    expect(html).toContain('class="repo-detail-row"');
    expect(html).toContain("hidden");
  });

  it("escapes the repository full name in links and data attributes", () => {
    const html = buildRepoRow(repo({ fullName: 'acme/<repo>"x"', name: '<repo>"x"' }));
    expect(html).not.toContain('<repo>"x"');
    expect(html).toContain("&lt;repo&gt;&quot;x&quot;");
  });

  it("builds a stable repo-id by stripping non-alphanumeric characters", () => {
    const html = buildRepoRow(repo({ fullName: "acme/my--repo.name" }));
    expect(html).toContain('data-repo-id="acme-my-repo-name"');
    expect(html).toContain('id="detail-acme-my-repo-name"');
  });

  it("shows open/closed issue counts and PR counts", () => {
    const html = buildRepoRow(repo({ issues: { open: 7, closed: 9 }, pullRequests: { open: 3, closed: 1, merged: 12 } }));
    expect(html).toContain("data-open-issues=\"7\"");
    expect(html).toContain("data-merged-prs=\"12\"");
    expect(html).toContain("data-open-prs=\"3\"");
  });

  it("omits the PR table when there are no PR details", () => {
    const html = buildRepoRow(repo({ pullRequestDetails: [] }));
    expect(html).not.toContain("Recent Pull Requests");
  });

  it("renders the PR table when PR details exist", () => {
    const html = buildRepoRow(repo({ pullRequestDetails: [pr({ number: 42, title: "Add feature" })] }));
    expect(html).toContain("Recent Pull Requests");
    expect(html).toContain("#42 Add feature");
  });

  it("sorts PR details by merged date, most recent first", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [
          pr({ number: 1, mergedAt: "2026-01-01T00:00:00Z" }),
          pr({ number: 2, mergedAt: "2026-06-01T00:00:00Z" }),
        ],
      }),
    );
    const idx1 = html.indexOf("#1 ");
    const idx2 = html.indexOf("#2 ");
    expect(idx2).toBeLessThan(idx1);
  });

  it("sorts unmerged PRs (no mergedAt) after merged ones", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [
          pr({ number: 1, mergedAt: undefined }),
          pr({ number: 2, mergedAt: "2026-06-01T00:00:00Z" }),
        ],
      }),
    );
    const idx1 = html.indexOf("#1 ");
    const idx2 = html.indexOf("#2 ");
    expect(idx2).toBeLessThan(idx1);
  });

  it("sorts an unmerged PR after a merged one when the merged PR appears earlier in the input", () => {
    // With the merged PR first in the input array, the sort comparator is
    // invoked as (unmerged, merged) — the mirror image of the previous test
    // — covering the `!a.mergedAt` early-return branch as well.
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [
          pr({ number: 1, mergedAt: "2026-06-01T00:00:00Z" }),
          pr({ number: 2, mergedAt: undefined }),
        ],
      }),
    );
    const idx1 = html.indexOf("#1 ");
    const idx2 = html.indexOf("#2 ");
    expect(idx1).toBeLessThan(idx2);
  });

  it("keeps relative order when neither PR has a mergedAt", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [pr({ number: 1, mergedAt: undefined }), pr({ number: 2, mergedAt: undefined })],
      }),
    );
    const idx1 = html.indexOf("#1 ");
    const idx2 = html.indexOf("#2 ");
    expect(idx1).toBeLessThan(idx2);
  });

  it("renders an empty merged-date cell for a PR still open", () => {
    const html = buildRepoRow(repo({ pullRequestDetails: [pr({ number: 5, mergedAt: undefined })] }));
    expect(html).toMatch(/<td><\/td>/);
  });

  it("exercises both comparator directions when sorting a mix of merged and unmerged PRs", () => {
    // A three-element mix forces the sort comparator to run in both
    // (unmerged, merged) and (merged, unmerged) argument orders, covering
    // both the `!a.mergedAt` and `!b.mergedAt` early-return branches.
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [
          pr({ number: 1, mergedAt: undefined }),
          pr({ number: 2, mergedAt: "2026-05-01T00:00:00Z" }),
          pr({ number: 3, mergedAt: "2026-06-01T00:00:00Z" }),
        ],
      }),
    );
    const idx1 = html.indexOf("#1 ");
    const idx2 = html.indexOf("#2 ");
    const idx3 = html.indexOf("#3 ");
    expect(idx3).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx1);
  });

  it("sums lines added/deleted from PR details when there is no merged-PR timeline", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [pr({ linesAdded: 10, linesDeleted: 2 }), pr({ number: 2, linesAdded: 5, linesDeleted: 1 })],
      }),
    );
    expect(html).toContain('data-lines-added="15"');
    expect(html).toContain('data-lines-deleted="3"');
  });

  it("prefers the merged-PR timeline's line counts over the PR-detail sample when both are present", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [pr({ linesAdded: 999, linesDeleted: 999 })],
        mergedPRTimeline: [
          {
            number: 1,
            createdAt: "2026-01-01T00:00:00Z",
            mergedAt: "2026-01-02T00:00:00Z",
            author: "octocat",
            isBotAuthor: false,
            isCopilotAuthored: false,
            timeToMergeHours: 24,
            closesIssues: [],
            linesAdded: 20,
            linesDeleted: 4,
          },
        ],
      }),
    );
    expect(html).toContain('data-lines-added="20"');
    expect(html).toContain('data-lines-deleted="4"');
  });

  it("falls back to PR-detail line counts when the timeline entries lack line data", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [pr({ linesAdded: 7, linesDeleted: 3 })],
        mergedPRTimeline: [
          {
            number: 1,
            createdAt: "2026-01-01T00:00:00Z",
            mergedAt: "2026-01-02T00:00:00Z",
            author: "octocat",
            isBotAuthor: false,
            isCopilotAuthored: false,
            timeToMergeHours: 24,
            closesIssues: [],
          },
        ],
      }),
    );
    expect(html).toContain('data-lines-added="7"');
    expect(html).toContain('data-lines-deleted="3"');
  });

  it("defaults a timeline entry's missing linesAdded/linesDeleted to 0 rather than dropping the entry", () => {
    const html = buildRepoRow(
      repo({
        pullRequestDetails: [],
        mergedPRTimeline: [
          {
            number: 1,
            createdAt: "2026-01-01T00:00:00Z",
            mergedAt: "2026-01-02T00:00:00Z",
            author: "octocat",
            isBotAuthor: false,
            isCopilotAuthored: false,
            timeToMergeHours: 24,
            closesIssues: [],
            linesAdded: 12,
            // linesDeleted intentionally absent: entry still counts (linesAdded
            // is defined) but must contribute 0, not NaN/undefined, to the total.
          },
          {
            number: 2,
            createdAt: "2026-01-03T00:00:00Z",
            mergedAt: "2026-01-04T00:00:00Z",
            author: "octocat",
            isBotAuthor: false,
            isCopilotAuthored: false,
            timeToMergeHours: 24,
            closesIssues: [],
            linesDeleted: 5,
            // linesAdded intentionally absent, mirroring the above.
          },
        ],
      }),
    );
    expect(html).toContain('data-lines-added="12"');
    expect(html).toContain('data-lines-deleted="5"');
  });

  it("renders an empty pushed date when pushedAt is absent", () => {
    const html = buildRepoRow(repo({ pushedAt: undefined }));
    expect(html).toContain('data-pushed=""');
  });

  it("truncates the visible pushed date to the day while keeping the full timestamp in the data attribute", () => {
    const html = buildRepoRow(repo({ pushedAt: "2026-03-15T08:30:00Z" }));
    expect(html).toContain('data-pushed="2026-03-15T08:30:00Z"');
    expect(html).toContain("<td>2026-03-15</td>");
  });

  it("shows an em-dash placeholder for agent tasks when there are none", () => {
    const html = buildRepoRow(repo());
    expect(html).toContain('data-agent-tasks="0"');
    expect(html).toContain("&ndash;");
  });

  it("shows the agent task count when present", () => {
    const html = buildRepoRow(
      repo({
        copilotAgentMetrics: {
          totalTasks: 3,
          completedTasks: 3,
          failedTasks: 0,
          cancelledTasks: 0,
          timedOutTasks: 0,
          activeTasksCount: 0,
          totalSessions: 3,
          cloudAgentSessions: 3,
          cliRemoteSessions: 0,
          totalCreditsUsed: 0,
          agentCreatedPRs: 0,
          agentActionsMinutes: 0,
        },
      }),
    );
    expect(html).toContain('data-agent-tasks="3"');
    expect(html).toContain(">3</td>");
  });

  it("omits the agent-task detail panel when totalTasks is 0 even if the object is present", () => {
    const html = buildRepoRow(
      repo({
        copilotAgentMetrics: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          cancelledTasks: 0,
          timedOutTasks: 0,
          activeTasksCount: 0,
          totalSessions: 0,
          cloudAgentSessions: 0,
          cliRemoteSessions: 0,
          totalCreditsUsed: 0,
          agentCreatedPRs: 0,
          agentActionsMinutes: 0,
        },
      }),
    );
    expect(html).not.toContain("Agent Tasks (30 d)");
  });

  it("renders the full agent-task detail panel with every optional row present", () => {
    const html = buildRepoRow(
      repo({
        copilotAgentMetrics: {
          totalTasks: 10,
          completedTasks: 5,
          failedTasks: 2,
          cancelledTasks: 1,
          timedOutTasks: 1,
          activeTasksCount: 1,
          totalSessions: 12,
          cloudAgentSessions: 10,
          cliRemoteSessions: 2,
          totalCreditsUsed: 4.567,
          avgCompletedSessionHours: 2.5,
          agentCreatedPRs: 3,
          agentActionsMinutes: 15.25,
        },
      }),
    );
    expect(html).toContain("Agent Tasks (30 d)");
    expect(html).toContain('aria-label="Optional metric. Requires a token with the Agent tasks permission."');
    expect(html).toContain("<dt>Failed</dt><dd>2</dd>");
    expect(html).toContain("<dt>Cancelled</dt><dd>1</dd>");
    expect(html).toContain("<dt>Timed out</dt><dd>1</dd>");
    expect(html).toContain("<dt>Active</dt><dd>1</dd>");
    expect(html).toContain("<dt>Credits</dt><dd>4.6</dd>");
    expect(html).toContain("Avg&nbsp;duration");
    expect(html).toContain("<dt>PRs created</dt><dd>3</dd>");
    expect(html).toContain("Actions&nbsp;min");
    expect(html).toContain("<dd>15.3</dd>");
  });

  it("defaults a missing agentActionsMinutes to 0 rather than rendering it (older cached data)", () => {
    const html = buildRepoRow(
      repo({
        copilotAgentMetrics: {
          totalTasks: 2,
          completedTasks: 2,
          failedTasks: 0,
          cancelledTasks: 0,
          timedOutTasks: 0,
          activeTasksCount: 0,
          totalSessions: 2,
          cloudAgentSessions: 2,
          cliRemoteSessions: 0,
          totalCreditsUsed: 0,
          agentCreatedPRs: 0,
          // agentActionsMinutes intentionally omitted to simulate data
          // collected before this field existed.
        } as Omit<CopilotAgentMetrics, "agentActionsMinutes"> as CopilotAgentMetrics,
      }),
    );
    expect(html).not.toContain("Actions&nbsp;min");
  });

  it("omits each optional agent-task row when its value is zero or absent", () => {
    const html = buildRepoRow(
      repo({
        copilotAgentMetrics: {
          totalTasks: 5,
          completedTasks: 5,
          failedTasks: 0,
          cancelledTasks: 0,
          timedOutTasks: 0,
          activeTasksCount: 0,
          totalSessions: 5,
          cloudAgentSessions: 5,
          cliRemoteSessions: 0,
          totalCreditsUsed: 0,
          agentCreatedPRs: 0,
          agentActionsMinutes: 0,
        },
      }),
    );
    expect(html).not.toContain("<dt>Failed</dt>");
    expect(html).not.toContain("<dt>Cancelled</dt>");
    expect(html).not.toContain("<dt>Timed out</dt>");
    expect(html).not.toContain("<dt>Active</dt>");
    expect(html).not.toContain("<dt>Credits</dt>");
    expect(html).not.toContain("Avg&nbsp;duration");
    expect(html).not.toContain("<dt>PRs created</dt>");
    expect(html).not.toContain("Actions&nbsp;min");
  });
});
