import type { RepoMetrics } from "../types.js";
import { escapeHtml, formatDurationHtml } from "./utils.js";

export function buildRepoRow(repo: RepoMetrics): string {
  const sortedPRDetails = [...repo.pullRequestDetails].sort((a, b) => {
    if (!a.mergedAt && !b.mergedAt) return 0;
    if (!a.mergedAt) return 1;
    if (!b.mergedAt) return -1;
    return b.mergedAt.localeCompare(a.mergedAt);
  });

  const prRows = sortedPRDetails
    .map(
      (pr) =>
        `<tr><td>#${pr.number} ${escapeHtml(pr.title)}</td>` +
        `<td>${pr.mergedAt ? pr.mergedAt.slice(0, 10) : ""}</td>` +
        `<td class="td-lines"><span class="add">+${pr.linesAdded}</span><span class="del">-${pr.linesDeleted}</span></td>` +
        `<td>${pr.commentCount}</td><td>${pr.commitCount}</td><td>${pr.actionsMinutes}</td></tr>`,
    )
    .join("");

  const prTable =
    sortedPRDetails.length > 0
      ? `<div class="pr-wrap"><h4>Recent Pull Requests</h4>
      <table class="pr-tbl"><thead><tr><th>PR</th><th>Merged</th><th>Lines</th><th>Comments</th><th>Commits</th><th>CI&nbsp;min</th></tr></thead>
      <tbody>${prRows}</tbody></table></div>`
      : "";

  const totalContrib = repo.contributorCount;
  // Prefer the full merged-PR timeline (covers ~13 months) over the
  // 10-PR detailed sample so the per-repo Lines +/- column reflects all
  // recent activity. Fall back to the detailed sample when the timeline
  // lacks line counts (REST fallback path doesn't fetch them).
  const timelineLineEntries =
    repo.mergedPRTimeline?.filter(
      (pr) => pr.linesAdded !== undefined || pr.linesDeleted !== undefined,
    ) ?? [];
  const useTimeline = timelineLineEntries.length > 0;
  const linesAdded = useTimeline
    ? timelineLineEntries.reduce((s, pr) => s + (pr.linesAdded ?? 0), 0)
    : repo.pullRequestDetails.reduce((s, pr) => s + pr.linesAdded, 0);
  const linesDeleted = useTimeline
    ? timelineLineEntries.reduce((s, pr) => s + (pr.linesDeleted ?? 0), 0)
    : repo.pullRequestDetails.reduce((s, pr) => s + pr.linesDeleted, 0);
  const pushedDate = repo.pushedAt ? repo.pushedAt.slice(0, 10) : "";
  const repoUrl = `https://github.com/${escapeHtml(repo.fullName)}`;
  const repoId = repo.fullName
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-");

  const agentTaskCount = repo.copilotAgentMetrics?.totalTasks ?? 0;
  const dataRow =
    `<tr class="repo-row" ` +
    `data-name="${escapeHtml(repo.fullName.toLowerCase())}" ` +
    `data-repo-name="${escapeHtml(repo.name.toLowerCase())}" ` +
    `data-open-issues="${repo.issues.open}" ` +
    `data-merged-prs="${repo.pullRequests.merged}" ` +
    `data-merged-prs-all="${repo.pullRequests.merged}" ` +
    `data-open-prs="${repo.pullRequests.open}" ` +
    `data-contributors="${totalContrib}" ` +
    `data-dependents="${repo.dependentCount}" ` +
    `data-pushed="${escapeHtml(repo.pushedAt ?? "")}" ` +
    `data-lines-added="${linesAdded}" ` +
    `data-lines-deleted="${linesDeleted}" ` +
    `data-agent-tasks="${agentTaskCount}" ` +
    `data-repo-id="${repoId}">` +
    `<td><div class="repo-name-cell">` +
    `<button class="repo-expand-btn" onclick="toggleRepo(this)" aria-expanded="false" aria-label="Toggle details for ${escapeHtml(repo.fullName)}"><span class="chev" aria-hidden="true">&rsaquo;</span></button>` +
    `<a class="rname" href="${repoUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo.fullName)}</a>` +
    `<span class="bdg bdg-age"></span>` +
    `</div></td>` +
    `<td>${repo.issues.open}<span class="col-muted"> / ${repo.issues.closed}</span></td>` +
    `<td class="td-merged-prs">${repo.pullRequests.merged}</td>` +
    `<td>${repo.pullRequests.open}</td>` +
    `<td title="${repo.committerCount} committers, ${repo.reviewerCount} reviewers">${totalContrib}</td>` +
    `<td>${repo.dependentCount}</td>` +
    `<td>${pushedDate}</td>` +
    `<td class="td-lines"><span class="add">+${linesAdded}</span><span class="del">-${linesDeleted}</span></td>` +
    `<td>${agentTaskCount > 0 ? agentTaskCount : '<span class="col-muted">&ndash;</span>'}</td>` +
    `</tr>`;

  const detailRow =
    `<tr class="repo-detail-row" id="detail-${repoId}" hidden>` +
    `<td colspan="9" class="repo-detail-cell">` +
    `<div class="stats-grid">` +
    `<div class="sg"><h4>Issues</h4><dl><div class="dr"><dt>Open</dt><dd>${repo.issues.open}</dd></div><div class="dr"><dt>Closed</dt><dd>${repo.issues.closed}</dd></div></dl></div>` +
    `<div class="sg"><h4>Pull Requests</h4><dl><div class="dr"><dt>Open</dt><dd>${repo.pullRequests.open}</dd></div><div class="dr"><dt>Merged</dt><dd>${repo.pullRequests.merged}</dd></div><div class="dr"><dt>Closed</dt><dd>${repo.pullRequests.closed}</dd></div></dl></div>` +
    `<div class="sg"><h4>People (90 d)</h4><dl><div class="dr"><dt>Committers</dt><dd>${repo.committerCount}</dd></div><div class="dr"><dt>Reviewers</dt><dd>${repo.reviewerCount}</dd></div></dl></div>` +
    `<div class="sg"><h4>Dependents</h4><dl><div class="dr"><dt>Repos</dt><dd>${repo.dependentCount}</dd></div></dl></div>` +
    (repo.copilotAgentMetrics && repo.copilotAgentMetrics.totalTasks > 0
      ? `<div class="sg"><h4>Agent Tasks (30 d)</h4><dl>` +
        `<div class="dr"><dt>Total</dt><dd>${repo.copilotAgentMetrics.totalTasks}</dd></div>` +
        `<div class="dr"><dt>Completed</dt><dd>${repo.copilotAgentMetrics.completedTasks}</dd></div>` +
        (repo.copilotAgentMetrics.failedTasks > 0 ? `<div class="dr"><dt>Failed</dt><dd>${repo.copilotAgentMetrics.failedTasks}</dd></div>` : "") +
        (repo.copilotAgentMetrics.cancelledTasks > 0 ? `<div class="dr"><dt>Cancelled</dt><dd>${repo.copilotAgentMetrics.cancelledTasks}</dd></div>` : "") +
        (repo.copilotAgentMetrics.timedOutTasks > 0 ? `<div class="dr"><dt>Timed out</dt><dd>${repo.copilotAgentMetrics.timedOutTasks}</dd></div>` : "") +
        (repo.copilotAgentMetrics.activeTasksCount > 0 ? `<div class="dr"><dt>Active</dt><dd>${repo.copilotAgentMetrics.activeTasksCount}</dd></div>` : "") +
        `<div class="dr"><dt>Sessions</dt><dd>${repo.copilotAgentMetrics.totalSessions}</dd></div>` +
        (repo.copilotAgentMetrics.totalCreditsUsed > 0 ? `<div class="dr"><dt>Credits</dt><dd>${repo.copilotAgentMetrics.totalCreditsUsed.toFixed(1)}</dd></div>` : "") +
        (repo.copilotAgentMetrics.avgCompletedSessionHours != null ? `<div class="dr"><dt>Avg&nbsp;duration</dt><dd>${formatDurationHtml(repo.copilotAgentMetrics.avgCompletedSessionHours)}</dd></div>` : "") +
        (repo.copilotAgentMetrics.agentCreatedPRs > 0 ? `<div class="dr"><dt>PRs created</dt><dd>${repo.copilotAgentMetrics.agentCreatedPRs}</dd></div>` : "") +
        ((repo.copilotAgentMetrics.agentActionsMinutes ?? 0) > 0 ? `<div class="dr"><dt>Actions&nbsp;min</dt><dd>${(repo.copilotAgentMetrics.agentActionsMinutes ?? 0).toFixed(1)}</dd></div>` : "") +
        `</dl></div>`
      : "") +
    `</div>` +
    prTable +
    `</td>` +
    `</tr>`;

  return dataRow + "\n" + detailRow;
}
