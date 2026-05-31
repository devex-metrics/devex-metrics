import type { OrgMetrics, RepoMetrics, CopilotAdoption, CopilotAgentMetrics } from "./types.js";

/**
 * Produce a human-readable Markdown report from collected metrics.
 */
export function generateReport(metrics: OrgMetrics): string {
  const lines: string[] = [];

  lines.push(`# DevEx Metrics – ${metrics.owner}`);
  lines.push("");
  lines.push(
    `> Collected at ${metrics.collectedAt} · ` +
      `Owner type: **${metrics.ownerType}**`
  );
  lines.push("");

  // -- Summary --
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| ------ | ----- |`);
  lines.push(`| Repositories | ${metrics.repoCount} |`);

  const totals = aggregate(metrics.repos);
  lines.push(`| Open issues | ${totals.openIssues} |`);
  lines.push(`| Closed issues | ${totals.closedIssues} |`);
  lines.push(`| Open PRs | ${totals.openPRs} |`);
  lines.push(`| Merged PRs | ${totals.mergedPRs} |`);
  lines.push(`| Closed (unmerged) PRs | ${totals.closedPRs} |`);
  lines.push(`| Unique committers (90 d) | ${totals.committers} |`);
  lines.push(`| Unique reviewers (90 d) | ${totals.reviewers} |`);

  // Copilot adoption summary
  const copilotTotals = aggregateCopilot(metrics.repos);
  if (copilotTotals.totalMergedPRs > 0) {
    lines.push(`| Copilot-authored PRs | ${copilotTotals.copilotAuthoredPRs} (${pct(copilotTotals.copilotAuthoredPRs, copilotTotals.totalMergedPRs)}%) |`);
  }
  if (copilotTotals.totalDetailedPRs > 0) {
    lines.push(`| Copilot-reviewed PRs | ${copilotTotals.copilotReviewedPRs} (${pct(copilotTotals.copilotReviewedPRs, copilotTotals.totalDetailedPRs)}%) |`);
  }

  // Copilot agent tasks summary
  const agentTotals = aggregateAgentMetrics(metrics.repos);
  if (agentTotals.totalTasks > 0) {
    lines.push(`| Copilot agent tasks | ${agentTotals.totalTasks} |`);
    lines.push(`| Agent tasks completed | ${agentTotals.completedTasks} |`);
    lines.push(`| Agent tasks failed | ${agentTotals.failedTasks} |`);
    lines.push(`| Agent sessions | ${agentTotals.totalSessions} (${agentTotals.cloudAgentSessions} cloud / ${agentTotals.cliRemoteSessions} CLI) |`);
    pushIf(lines, agentTotals.totalCreditsUsed > 0, () => `| Agent credits used | ${agentTotals.totalCreditsUsed.toFixed(1)} |`);
    pushIf(lines, agentTotals.agentCreatedPRs > 0, () => `| PRs created by agent | ${agentTotals.agentCreatedPRs} |`);
    pushIf(lines, agentTotals.agentActionsMinutes > 0, () => `| Agent PR Actions minutes | ${agentTotals.agentActionsMinutes.toFixed(1)} |`);
  }

  // Median cycle time
  const allCycleTimes = metrics.repos.flatMap(
    (r) => (r.mergedPRTimeline ?? []).map((p) => p.timeToMergeHours),
  );
  if (allCycleTimes.length > 0) {
    const medianHrs = median(allCycleTimes);
    lines.push(`| Median cycle time | ${formatDuration(medianHrs)} |`);
  }

  lines.push("");

  // -- Per-repo --
  lines.push("## Repositories");
  lines.push("");
  for (const repo of metrics.repos) {
    lines.push(`### ${repo.fullName}`);
    lines.push("");
    if (repo.pushedAt) {
      lines.push(`Last pushed: ${repo.pushedAt.slice(0, 10)}`);
    }
    lines.push(
      `Issues: ${repo.issues.open} open / ${repo.issues.closed} closed`
    );
    lines.push(
      `PRs: ${repo.pullRequests.open} open / ${repo.pullRequests.merged} merged / ${repo.pullRequests.closed} closed`
    );
    lines.push(
      `Contributors: ${repo.committerCount} committers · ${repo.reviewerCount} reviewers`
    );
    lines.push(`Dependents: ${repo.dependentCount}`);
    lines.push("");

    // Copilot agent metrics for this repo
    if (repo.copilotAgentMetrics && repo.copilotAgentMetrics.totalTasks > 0) {
      const am = repo.copilotAgentMetrics;
      lines.push("**Copilot Agent (30-day window)**");
      lines.push("");
      lines.push(`| Metric | Value |`);
      lines.push(`| ------ | ----- |`);
      lines.push(`| Total tasks | ${am.totalTasks} |`);
      lines.push(`| Completed | ${am.completedTasks} |`);
      pushIf(lines, am.failedTasks > 0, () => `| Failed | ${am.failedTasks} |`);
      pushIf(lines, am.cancelledTasks > 0, () => `| Cancelled | ${am.cancelledTasks} |`);
      pushIf(lines, am.activeTasksCount > 0, () => `| Active | ${am.activeTasksCount} |`);
      lines.push(`| Sessions | ${am.totalSessions} |`);
      pushIf(lines, am.cloudAgentSessions > 0, () => `| Cloud agent sessions | ${am.cloudAgentSessions} |`);
      pushIf(lines, am.totalCreditsUsed > 0, () => `| Credits used | ${am.totalCreditsUsed.toFixed(1)} |`);
      if (am.avgCompletedSessionHours !== undefined)
        lines.push(`| Avg session duration | ${formatDuration(am.avgCompletedSessionHours)} |`);
      pushIf(lines, am.agentCreatedPRs > 0, () => `| PRs created | ${am.agentCreatedPRs} |`);
      pushIf(lines, am.agentActionsMinutes > 0, () => `| Actions minutes (agent PRs) | ${am.agentActionsMinutes.toFixed(1)} |`);
      lines.push("");
    }

    if (repo.pullRequestDetails.length > 0) {
      const sortedPRs = [...repo.pullRequestDetails].sort((a, b) => {
        if (!a.mergedAt && !b.mergedAt) return 0;
        if (!a.mergedAt) return 1;
        if (!b.mergedAt) return -1;
        return b.mergedAt.localeCompare(a.mergedAt);
      });
      lines.push(
        "| PR | Merged | Lines +/- | Comments | Commits | Actions min |"
      );
      lines.push(
        "| -- | ------ | --------- | -------- | ------- | ----------- |"
      );
      for (const pr of sortedPRs) {
        const mergedDate = pr.mergedAt ? pr.mergedAt.slice(0, 10) : "";
        lines.push(
          `| #${pr.number} ${pr.title} | ${mergedDate} | +${pr.linesAdded}/-${pr.linesDeleted} | ${pr.commentCount} | ${pr.commitCount} | ${pr.actionsMinutes} |`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/* ---- helpers ---- */

/** Append a line to `lines` only when `condition` is truthy. The line is built lazily so its expression is not evaluated when skipped. */
function pushIf(lines: string[], condition: boolean, line: () => string): void {
  if (condition) lines.push(line());
}

/** Format a part/total ratio as a one-decimal percentage string (without the `%`). */
function pct(part: number, total: number): string {
  return ((part / total) * 100).toFixed(1);
}

function aggregate(repos: RepoMetrics[]) {
  let openIssues = 0;
  let closedIssues = 0;
  let openPRs = 0;
  let mergedPRs = 0;
  let closedPRs = 0;
  let committers = 0;
  let reviewers = 0;

  for (const r of repos) {
    openIssues += r.issues.open;
    closedIssues += r.issues.closed;
    openPRs += r.pullRequests.open;
    mergedPRs += r.pullRequests.merged;
    closedPRs += r.pullRequests.closed;
    committers += r.committerCount;
    reviewers += r.reviewerCount;
  }
  return {
    openIssues,
    closedIssues,
    openPRs,
    mergedPRs,
    closedPRs,
    committers,
    reviewers,
  };
}

function aggregateCopilot(repos: RepoMetrics[]): CopilotAdoption {
  let copilotAuthoredPRs = 0;
  let copilotReviewedPRs = 0;
  let totalMergedPRs = 0;
  let totalDetailedPRs = 0;
  let humanMergedPRs = 0;

  for (const r of repos) {
    if (r.copilotAdoption) {
      copilotAuthoredPRs += r.copilotAdoption.copilotAuthoredPRs;
      copilotReviewedPRs += r.copilotAdoption.copilotReviewedPRs;
      totalMergedPRs += r.copilotAdoption.totalMergedPRs;
      totalDetailedPRs += r.copilotAdoption.totalDetailedPRs;
      humanMergedPRs += r.copilotAdoption.humanMergedPRs ?? (r.copilotAdoption.totalMergedPRs - r.copilotAdoption.copilotAuthoredPRs);
    }
  }
  return { copilotAuthoredPRs, copilotReviewedPRs, totalMergedPRs, totalDetailedPRs, humanMergedPRs };
}

function aggregateAgentMetrics(repos: RepoMetrics[]): CopilotAgentMetrics {
  let totalTasks = 0, completedTasks = 0, failedTasks = 0, cancelledTasks = 0,
    timedOutTasks = 0, activeTasksCount = 0, totalSessions = 0,
    cloudAgentSessions = 0, cliRemoteSessions = 0, totalCreditsUsed = 0,
    agentCreatedPRs = 0, agentActionsMinutes = 0;

  for (const r of repos) {
    if (!r.copilotAgentMetrics) continue;
    const a = r.copilotAgentMetrics;
    totalTasks += a.totalTasks;
    completedTasks += a.completedTasks;
    failedTasks += a.failedTasks;
    cancelledTasks += a.cancelledTasks;
    timedOutTasks += a.timedOutTasks;
    activeTasksCount += a.activeTasksCount;
    totalSessions += a.totalSessions;
    cloudAgentSessions += a.cloudAgentSessions;
    cliRemoteSessions += a.cliRemoteSessions;
    totalCreditsUsed += a.totalCreditsUsed;
    agentCreatedPRs += a.agentCreatedPRs;
    agentActionsMinutes += a.agentActionsMinutes ?? 0;
  }
  return {
    totalTasks,
    completedTasks,
    failedTasks,
    cancelledTasks,
    timedOutTasks,
    activeTasksCount,
    totalSessions,
    cloudAgentSessions,
    cliRemoteSessions,
    totalCreditsUsed: Math.round(totalCreditsUsed * 100) / 100,
    agentCreatedPRs,
    agentActionsMinutes: Math.round(agentActionsMinutes * 100) / 100,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
