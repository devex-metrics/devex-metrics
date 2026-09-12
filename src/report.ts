import type { OrgMetrics, RepoMetrics, CopilotAdoption, CopilotAgentMetrics } from "./types.js";
import { gini, quantiles, shareAtLeast } from "./stats.js";
import { LARGE_PR_LINES } from "./history.js";

/**
 * Measurement windows a summary metric can be reported over. Metrics counted
 * from different windows are not directly comparable (e.g. a repository-
 * lifetime total versus a percentage over the last ~2 years of collected
 * PRs), so every summary row is explicitly labelled with one of these.
 */
const WINDOW = {
  /** State as of the moment the data was collected (e.g. currently-open PRs). */
  snapshot: "Current snapshot",
  /** Cumulative total since the repository was created. */
  lifetime: "Repository lifetime",
  /**
   * The enriched PR timeline the collector keeps: up to ~1,000 most recently
   * updated PRs per repo, roughly the last ~2 years. Not the full lifetime
   * for older or very active repositories.
   */
  collected: "Collected history",
  last30d: "Last 30 days",
  last90d: "Last 90 days",
} as const;

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
  lines.push(
    "> Metrics are measured over different windows — see the **Window** " +
      "column. Counts from different windows are not directly comparable " +
      "(e.g. a repository-lifetime total versus a share of the collected " +
      "history)."
  );
  lines.push("");
  lines.push(
    "> **Reviewer counts are two different populations.** " +
      "*Unique reviewers* counts every distinct account that submitted a " +
      "pull request review — including bot accounts — across the sampled " +
      "PR history. *Review load concentration* (Gini) counts only " +
      "individual review submissions by human reviewers (bots excluded), " +
      "and only from repositories whose enriched review timeline was " +
      "collected. The two are not meant to add up to the same denominator."
  );
  lines.push("");
  lines.push(`| Metric | Value | Window |`);
  lines.push(`| ------ | ----- | ------ |`);
  lines.push(`| Repositories | ${metrics.repoCount} | ${WINDOW.snapshot} |`);

  const totals = aggregate(metrics.repos);
  lines.push(`| Open issues | ${totals.openIssues} | ${WINDOW.snapshot} |`);
  lines.push(`| Closed issues | ${totals.closedIssues} | ${WINDOW.lifetime} |`);
  lines.push(`| Open PRs | ${totals.openPRs} | ${WINDOW.snapshot} |`);
  lines.push(`| Merged PRs | ${totals.mergedPRs} | ${WINDOW.lifetime} |`);
  lines.push(`| Closed (unmerged) PRs | ${totals.closedPRs} | ${WINDOW.lifetime} |`);
  lines.push(`| Unique committers | ${totals.committers} | ${WINDOW.last90d} |`);
  lines.push(`| Unique reviewers, incl. bots | ${totals.reviewers} | ${WINDOW.collected} |`);

  // AI authorship summary. "Copilot-authored" is misleading on its own: the
  // combined figure includes Claude and Codex too, so the tool breakdown and
  // an explicit note on attribution rules / denominator / window are shown
  // alongside it rather than leaving readers to guess.
  // Notes are collected separately and emitted after the summary table to
  // avoid breaking GitHub-flavored Markdown table rendering.
  const summaryNotes: string[] = [];
  const copilotTotals = aggregateCopilot(metrics.repos);
  if (copilotTotals.totalMergedPRs > 0) {
    lines.push(
      `| AI-authored PRs (Copilot + Claude + Codex) | ` +
        `${copilotTotals.copilotAuthoredPRs} (${pct(copilotTotals.copilotAuthoredPRs, copilotTotals.totalMergedPRs)}% ` +
        `of ${copilotTotals.totalMergedPRs} ${copilotTotals.totalMergedPRs === 1 ? "merged PR" : "merged PRs"} in the collected history) | ${WINDOW.collected} |`
    );
    const byTool = aggregateAIAuthorshipByTool(metrics.repos);
    pushIf(lines, byTool.copilot > 0, () => `| — of which Copilot | ${byTool.copilot} | ${WINDOW.collected} |`);
    pushIf(lines, byTool.claude > 0, () => `| — of which Claude | ${byTool.claude} | ${WINDOW.collected} |`);
    pushIf(lines, byTool.codex > 0, () => `| — of which Codex | ${byTool.codex} | ${WINDOW.collected} |`);
    summaryNotes.push(
      "> An AI-authored PR is one where a human-opened PR containing even a " +
        "single AI-assisted commit still counts, not only PRs opened by an " +
        "AI account itself. Matched via PR-author login, `Co-authored-by:` " +
        "commit trailers, or known PR-body phrasing (the latter two only " +
        "on the GraphQL collection path; the REST fallback checks author " +
        "login and merge-commit trailers). The denominator is " +
        "every merged PR in the collected history (~2 years / up to " +
        "1,000 PRs per repo), including bot-authored ones such as " +
        "`dependabot[bot]`. Generic dependency bots are not expected to be " +
        "misclassified as AI-authored unless their commit/PR text happens " +
        "to match one of these patterns."
    );
  }
  if (copilotTotals.totalDetailedPRs > 0) {
    lines.push(
      `| Copilot-reviewed PRs | ${copilotTotals.copilotReviewedPRs} ` +
        `(${pct(copilotTotals.copilotReviewedPRs, copilotTotals.totalDetailedPRs)}% ` +
        `of ${copilotTotals.totalDetailedPRs} ${copilotTotals.totalDetailedPRs === 1 ? "sampled PR" : "sampled PRs"}) | ${WINDOW.collected} |`
    );
    summaryNotes.push(
      "> Unlike the row above, this one really is Copilot-only (a review " +
        "from `copilot[bot]`) and is sampled from up to 10 of the most " +
        "recently updated closed PRs per repository (filtered to merged), " +
        "not necessarily the most recently merged — a much smaller " +
        "population than the collected-history figure above."
    );
  }

  // Copilot agent tasks summary
  const agentTotals = aggregateAgentMetrics(metrics.repos);
  if (agentTotals.totalTasks > 0) {
    lines.push(`| Copilot agent tasks | ${agentTotals.totalTasks} | ${WINDOW.last30d} |`);
    lines.push(`| Agent tasks completed | ${agentTotals.completedTasks} | ${WINDOW.last30d} |`);
    lines.push(`| Agent tasks failed | ${agentTotals.failedTasks} | ${WINDOW.last30d} |`);
    lines.push(`| Agent sessions | ${agentTotals.totalSessions} (${agentTotals.cloudAgentSessions} cloud / ${agentTotals.cliRemoteSessions} CLI) | ${WINDOW.last30d} |`);
    pushIf(lines, agentTotals.totalCreditsUsed > 0, () => `| Agent credits used | ${agentTotals.totalCreditsUsed.toFixed(1)} | ${WINDOW.last30d} |`);
    if (agentTotals.agentCreatedPRs > 0) {
      lines.push(`| PRs created by agent | ${agentTotals.agentCreatedPRs} | ${WINDOW.last30d} |`);
      summaryNotes.push(
        "> A different measurement from the AI-authored row above: this " +
          "counts only PRs traced to a Copilot coding-agent task (via the " +
          "Task API, not commit/PR text matching), over the last 30 days " +
          "only, and Copilot-agent specifically — not Claude or Codex."
      );
    }
    pushIf(lines, agentTotals.agentActionsMinutes > 0, () => `| Agent PR Actions minutes | ${agentTotals.agentActionsMinutes.toFixed(1)} | ${WINDOW.last30d} |`);
  }

  // Median cycle time
  const allCycleTimes = metrics.repos.flatMap(
    (r) => (r.mergedPRTimeline ?? []).map((p) => p.timeToMergeHours),
  );
  if (allCycleTimes.length > 0) {
    const medianHrs = median(allCycleTimes);
    lines.push(`| Median cycle time | ${formatDuration(medianHrs)} | ${WINDOW.collected} |`);
  }

  // Size, review latency, abandonment and review concentration. Every one of
  // these is derived from data the collection already holds, so a row is
  // emitted only when there is something behind it rather than a hopeful zero.
  const flow = aggregateFlow(metrics.repos);
  if (flow.sizes.length > 0) {
    lines.push(`| Median PR size | ${Math.round(quantiles(flow.sizes).p50)} lines | ${WINDOW.collected} |`);
    lines.push(
      `| PRs over ${LARGE_PR_LINES} lines | ` +
        `${shareAtLeast(flow.sizes, LARGE_PR_LINES).toFixed(1)}% | ${WINDOW.collected} |`
    );
  }
  if (flow.reviewWaits.length > 0) {
    const rw = quantiles(flow.reviewWaits);
    lines.push(
      `| Wait for first review | ${formatDuration(rw.p50)} p50 · ` +
        `${formatDuration(rw.p75)} p75 · ${formatDuration(rw.p90)} p90 (n=${rw.n}) | ${WINDOW.collected} |`
    );
  }
  // A single "first review → approval" median collapses to 0 whenever the
  // first review submitted is itself an approval, which is indistinguishable
  // from broken timestamps without more context. These four rows replace it.
  if (flow.reviewedPRs > 0) {
    lines.push(
      `| Approved on first review | ` +
        `${pct(flow.approvedOnFirstReview, flow.reviewedPRs)}% (n=${flow.reviewedPRs}) | ${WINDOW.collected} |`
    );
  }
  if (flow.revisionApprovalWaits.length > 0) {
    lines.push(
      `| Time to approval (PRs requiring revisions) | ` +
        `${formatDuration(quantiles(flow.revisionApprovalWaits).p50)} p50 ` +
        `(n=${flow.revisionApprovalWaits.length}) | ${WINDOW.collected} |`
    );
  }
  if (flow.reviewRounds.length > 0) {
    lines.push(
      `| Median review submissions per PR | ` +
        `${median(flow.reviewRounds)} (n=${flow.reviewRounds.length}) | ${WINDOW.collected} |`
    );
  }
  if (flow.changesRequestedKnownPRs > 0) {
    lines.push(
      `| PRs receiving "changes requested" | ` +
        `${pct(flow.changesRequestedPRs, flow.changesRequestedKnownPRs)}% ` +
        `(n=${flow.changesRequestedKnownPRs}) | ${WINDOW.collected} |`
    );
  }
  if (flow.mergeWaits.length > 0) {
    lines.push(
      `| Approval → merge | ` +
        `${formatDuration(quantiles(flow.mergeWaits).p50)} p50 (n=${flow.mergeWaits.length}) | ${WINDOW.collected} |`
    );
  }
  const concluded = flow.merged + flow.abandoned;
  if (concluded > 0 && flow.abandoned > 0) {
    lines.push(
      `| PRs closed unmerged | ${flow.abandoned} (${pct(flow.abandoned, concluded)}%) | ${WINDOW.collected} |`
    );
  }
  if (flow.openAges.length > 0) {
    lines.push(
      `| Median age of open PRs | ` +
        `${formatDuration(quantiles(flow.openAges).p50)} (${flow.openAges.length} open) | ${WINDOW.snapshot} |`
    );
  }
  const reviewCounts = [...flow.reviewsBy.values()];
  if (reviewCounts.length > 1) {
    lines.push(
      `| Review load concentration (human reviewers only, bots excluded) | Gini ${gini(reviewCounts).toFixed(2)} ` +
        `across ${reviewCounts.length} reviewers | ${WINDOW.collected} |`
    );
  }
  if (agentTotals.agentCreatedPRs > 0 && agentTotals.totalCreditsUsed > 0) {
    lines.push(
      `| Credits per agent PR | ` +
        `${(agentTotals.totalCreditsUsed / agentTotals.agentCreatedPRs).toFixed(1)} | ${WINDOW.last30d} |`
    );
  }

  lines.push("");

  // Emit explanatory notes after the summary table to avoid breaking
  // GitHub-flavored Markdown table rendering.
  for (const note of summaryNotes) {
    lines.push(note);
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
      `Issues: ${repo.issues.open} open (${WINDOW.snapshot.toLowerCase()}) / ` +
        `${repo.issues.closed} closed (${WINDOW.lifetime.toLowerCase()})`
    );
    lines.push(
      `PRs: ${repo.pullRequests.open} open (${WINDOW.snapshot.toLowerCase()}) / ` +
        `${repo.pullRequests.merged} merged / ${repo.pullRequests.closed} closed ` +
        `(${WINDOW.lifetime.toLowerCase()})`
    );
    lines.push(
      `Contributors: ${repo.committerCount} committers (${WINDOW.last90d.toLowerCase()}) · ` +
        `${repo.reviewerCount} reviewers, incl. bots (${WINDOW.collected.toLowerCase()})`
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
      lines.push(`_Sampled from the most recently updated PRs (${WINDOW.collected.toLowerCase()})._`);
      lines.push("");
      lines.push(
        "| PR | Merged | Lines +/- | Comments | Commits | Actions min |"
      );
      lines.push(
        "| -- | ------ | --------- | -------- | ------- | ----------- |"
      );
      for (const pr of sortedPRs) {
        const mergedDate = pr.mergedAt ? pr.mergedAt.slice(0, 10) : "";
        lines.push(
          `| #${pr.number} ${escapeTableCell(pr.title)} | ${mergedDate} | +${pr.linesAdded}/-${pr.linesDeleted} | ${pr.commentCount} | ${pr.commitCount} | ${pr.actionsMinutes} |`
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

/** Escape characters that would otherwise break a Markdown table row: `|` and newlines. */
function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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

/**
 * Break the "AI-authored" total down by tool, from the same merged-PR
 * timeline `aggregateCopilot`'s `copilotAuthoredPRs` is summed from. Answers
 * "which usernames or markers count as Copilot-authored" concretely: only
 * the `copilot` count below is Copilot specifically — Claude and Codex are
 * counted separately even though they roll up into the combined AI total.
 */
function aggregateAIAuthorshipByTool(repos: RepoMetrics[]) {
  let copilot = 0;
  let claude = 0;
  let codex = 0;
  for (const r of repos) {
    for (const pr of r.mergedPRTimeline ?? []) {
      if (pr.aiAuthorType === "copilot") copilot++;
      else if (pr.aiAuthorType === "claude") claude++;
      else if (pr.aiAuthorType === "codex") codex++;
    }
  }
  return { copilot, claude, codex };
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

/**
 * The raw samples behind the flow section of the summary.
 *
 * Durations are computed from the stored timestamps here rather than read from
 * a stored latency, so the report and the dashboard cannot drift apart on what
 * "wait for review" means.
 */
function aggregateFlow(repos: RepoMetrics[]) {
  const sizes: number[] = [];
  const reviewWaits: number[] = [];
  const mergeWaits: number[] = [];
  const openAges: number[] = [];
  const reviewsBy = new Map<string, number>();
  let merged = 0;
  let abandoned = 0;
  const now = Date.now();

  // Review-outcome samples. Population is every merged PR that received at
  // least one review (`firstReviewAt` present) — a raw "first review →
  // approval" median collapses to 0 whenever the first review submitted is
  // itself an approval, which reads as broken rather than as "reviewers
  // mostly approve outright". These four numbers replace that single median
  // with an unambiguous breakdown.
  let reviewedPRs = 0;
  let approvedOnFirstReview = 0;
  const revisionApprovalWaits: number[] = [];
  const reviewRounds: number[] = [];
  let changesRequestedPRs = 0;
  let changesRequestedKnownPRs = 0;

  const hours = (from?: string, to?: string): number | undefined => {
    if (!from || !to) return undefined;
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : undefined;
  };

  for (const repo of repos) {
    for (const pr of repo.mergedPRTimeline ?? []) {
      merged++;
      const size = (pr.linesAdded ?? 0) + (pr.linesDeleted ?? 0);
      if (size > 0) sizes.push(size);
      const toReview = hours(pr.createdAt, pr.firstReviewAt);
      if (toReview !== undefined) reviewWaits.push(toReview);
      const toMerge = hours(pr.firstApprovalAt, pr.mergedAt);
      if (toMerge !== undefined) mergeWaits.push(toMerge);

      if (pr.firstReviewAt !== undefined) {
        reviewedPRs++;
        if (pr.firstApprovalAt !== undefined) {
          if (pr.firstApprovalAt === pr.firstReviewAt) {
            approvedOnFirstReview++;
          } else {
            const toApproval = hours(pr.firstReviewAt, pr.firstApprovalAt);
            if (toApproval !== undefined) revisionApprovalWaits.push(toApproval);
          }
        }
      }
      if (pr.reviewCount !== undefined && pr.reviewCount > 0) {
        reviewRounds.push(pr.reviewCount);
      }
      if (pr.changesRequestedCount !== undefined) {
        changesRequestedKnownPRs++;
        if (pr.changesRequestedCount > 0) changesRequestedPRs++;
      }
    }
    abandoned += (repo.closedPRTimeline ?? []).length;
    for (const pr of repo.openPRTimeline ?? []) {
      const age = (now - new Date(pr.createdAt).getTime()) / 3_600_000;
      if (Number.isFinite(age) && age >= 0) openAges.push(age);
    }
    for (const entry of repo.reviewerLoad ?? []) {
      reviewsBy.set(entry.reviewer, (reviewsBy.get(entry.reviewer) ?? 0) + entry.reviews);
    }
  }

  return {
    sizes,
    reviewWaits,
    mergeWaits,
    openAges,
    reviewsBy,
    merged,
    abandoned,
    reviewedPRs,
    approvedOnFirstReview,
    revisionApprovalWaits,
    reviewRounds,
    changesRequestedPRs,
    changesRequestedKnownPRs,
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
