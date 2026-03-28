import type { OrgMetrics, RepoMetrics } from "./types.js";

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
  lines.push("");

  // -- Per-repo --
  lines.push("## Repositories");
  lines.push("");
  for (const repo of metrics.repos) {
    lines.push(`### ${repo.fullName}`);
    lines.push("");
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

    if (repo.pullRequestDetails.length > 0) {
      lines.push(
        "| PR | Lines +/- | Comments | Commits | Actions min |"
      );
      lines.push(
        "| -- | --------- | -------- | ------- | ----------- |"
      );
      for (const pr of repo.pullRequestDetails) {
        lines.push(
          `| #${pr.number} ${pr.title} | +${pr.linesAdded}/-${pr.linesDeleted} | ${pr.commentCount} | ${pr.commitCount} | ${pr.actionsMinutes} |`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/* ---- helpers ---- */

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
