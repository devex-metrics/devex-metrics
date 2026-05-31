import type { OrgMetrics, RepoMetrics } from "../types.js";
import { escapeHtml, computeMedian, weekToDate, formatDurationHtml } from "./utils.js";
import { getCSS } from "./styles.js";
import { getJS } from "./scripts.js";
import { buildRepoRow } from "./repo-row.js";

interface Totals {
  openIssues: number;
  closedIssues: number;
  openPRs: number;
  mergedPRs: number;
  closedPRs: number;
  committers: number;
  reviewers: number;
}

function aggregate(repos: RepoMetrics[]): Totals {
  let openIssues = 0,
    closedIssues = 0,
    openPRs = 0,
    mergedPRs = 0,
    closedPRs = 0,
    committers = 0,
    reviewers = 0;
  for (const r of repos) {
    openIssues += Math.max(0, r.issues.open);
    closedIssues += Math.max(0, r.issues.closed);
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

export function buildDashboardHtml(
  data: OrgMetrics,
  date: string,
  branch?: string,
  runUrl?: string,
): string {
  const totals = aggregate(data.repos);

  // Compute data date range from merged PR details
  let oldestDataDate = '';
  let newestDataDate = '';
  for (const repo of data.repos) {
    for (const pr of repo.pullRequestDetails) {
      if (pr.mergedAt) {
        const d = pr.mergedAt.slice(0, 10);
        if (!oldestDataDate || d < oldestDataDate) oldestDataDate = d;
        if (!newestDataDate || d > newestDataDate) newestDataDate = d;
      }
    }
  }
  // Fall back to weekly trends if no PR details have dates
  if (!oldestDataDate && data.weeklyTrends && data.weeklyTrends.length > 0) {
    oldestDataDate = data.weeklyTrends[0].week;
    newestDataDate = data.weeklyTrends[data.weeklyTrends.length - 1].week;
  }
  const dataRangeHtml = oldestDataDate
    ? `<span class="data-range">&#x1F4C5; ${escapeHtml(oldestDataDate)} &rarr; ${escapeHtml(newestDataDate || data.collectedAt.slice(0, 10))}</span>`
    : '';
  const ownerLink = `<a href="https://github.com/${escapeHtml(data.owner)}" class="hero-owner-link" target="_blank" rel="noopener noreferrer">${escapeHtml(data.owner)}</a>`;
  const ownerLine = `${ownerLink} &middot; ${escapeHtml(data.ownerType)}`;
  const collectedLine = `collected ${escapeHtml(data.collectedAt)}`;

  let deployedFrom = "";
  if (branch) {
    deployedFrom = ` Deployed from branch <strong>${escapeHtml(branch)}</strong>`;
    if (runUrl) {
      deployedFrom += ` (<a href="${escapeHtml(runUrl)}">workflow run</a>)`;
    }
    deployedFrom += ".";
  }

  const topRepos = [...data.repos]
    .map((r) => ({
      name: r.name,
      issues: Math.max(0, r.issues.open) + Math.max(0, r.issues.closed),
      prs:
        r.pullRequests.open + r.pullRequests.merged + r.pullRequests.closed,
    }))
    .sort((a, b) => b.issues + b.prs - (a.issues + a.prs))
    .slice(0, 15);

  const repoRows = data.repos.map((repo) => buildRepoRow(repo)).join("\n");

  // Build enriched PR details for charts — prefer the mergedPRTimeline
  // (wider history, 1 cheap API call) over the 10-entry pullRequestDetails.
  const allPRDetails = data.repos.flatMap((r) => {
    if (r.mergedPRTimeline && r.mergedPRTimeline.length > 0) {
      return r.mergedPRTimeline.map((p) => ({
        repo: r.name,
        mergedAt: p.mergedAt,
        createdAt: p.createdAt,
        author: p.author,
        isBotAuthor: p.isBotAuthor,
        isCopilotAuthored: p.isCopilotAuthored,
        aiAuthorType: p.aiAuthorType,
        timeToMergeHours: p.timeToMergeHours,
        linesAdded: p.linesAdded,
        linesDeleted: p.linesDeleted,
      }));
    }
    return r.pullRequestDetails
      .filter((pr) => !!pr.mergedAt)
      .map((pr) => ({
        repo: r.name,
        mergedAt: pr.mergedAt!,
        createdAt: pr.createdAt,
        author: pr.author,
        isBotAuthor: false,
        isCopilotAuthored: pr.isCopilotAuthored,
        aiAuthorType: pr.aiAuthorType,
        timeToMergeHours: pr.timeToMergeHours ?? 0,
        linesAdded: pr.linesAdded,
        linesDeleted: pr.linesDeleted,
      }));
  });

  // Aggregate Copilot adoption
  let copilotAuthored = 0, copilotReviewed = 0, copilotTotalMerged = 0, copilotTotalDetailed = 0, copilotHumanMerged = 0;
  for (const r of data.repos) {
    if (r.copilotAdoption) {
      copilotAuthored += r.copilotAdoption.copilotAuthoredPRs;
      copilotReviewed += r.copilotAdoption.copilotReviewedPRs;
      copilotTotalMerged += r.copilotAdoption.totalMergedPRs;
      copilotTotalDetailed += r.copilotAdoption.totalDetailedPRs;
      copilotHumanMerged += r.copilotAdoption.humanMergedPRs ?? (r.copilotAdoption.totalMergedPRs - r.copilotAdoption.copilotAuthoredPRs);
    }
  }

  // AI author breakdown by tool (computed from the full merged-PR timeline)
  const aiByType = { copilot: 0, claude: 0, codex: 0 };
  for (const p of allPRDetails) {
    if (p.aiAuthorType === "copilot") aiByType.copilot++;
    else if (p.aiAuthorType === "claude") aiByType.claude++;
    else if (p.aiAuthorType === "codex") aiByType.codex++;
  }

  // Aggregate Copilot agent metrics
  let agentTotalTasks = 0, agentCompleted = 0, agentFailed = 0, agentCancelled = 0,
    agentTimedOut = 0, agentActive = 0, agentTotalSessions = 0, agentCloudSessions = 0,
    agentCliSessions = 0, agentCredits = 0, agentPRs = 0, agentActionsMinutes = 0;
  const agentByRepo: Record<string, {
    totalTasks: number; completed: number; failed: number;
    cancelled: number; timedOut: number; active: number;
    sessions: number; credits: number; agentPRs: number; actionsMinutes: number;
  }> = {};
  for (const r of data.repos) {
    const a = r.copilotAgentMetrics;
    if (!a || a.totalTasks === 0) continue;
    agentTotalTasks += a.totalTasks;
    agentCompleted += a.completedTasks;
    agentFailed += a.failedTasks;
    agentCancelled += a.cancelledTasks;
    agentTimedOut += a.timedOutTasks;
    agentActive += a.activeTasksCount;
    agentTotalSessions += a.totalSessions;
    agentCloudSessions += a.cloudAgentSessions;
    agentCliSessions += a.cliRemoteSessions;
    agentCredits += a.totalCreditsUsed;
    agentPRs += a.agentCreatedPRs;
    agentActionsMinutes += a.agentActionsMinutes ?? 0;
    agentByRepo[r.name] = {
      totalTasks: a.totalTasks,
      completed: a.completedTasks,
      failed: a.failedTasks,
      cancelled: a.cancelledTasks,
      timedOut: a.timedOutTasks,
      active: a.activeTasksCount,
      sessions: a.totalSessions,
      credits: a.totalCreditsUsed,
      agentPRs: a.agentCreatedPRs,
      actionsMinutes: a.agentActionsMinutes ?? 0,
    };
  }

  // Aggregate issue lead times
  const allIssueLeadTimes = data.repos.flatMap((r) =>
    (r.issueLeadTimes ?? []).map((lt) => ({
      issueNumber: lt.issueNumber,
      prNumber: lt.prNumber,
      leadTimeHours: lt.leadTimeHours,
      prMergedAt: lt.prMergedAt,
      repo: r.name,
    })),
  );

  // Median cycle time (all-time)
  const cycleTimes = allPRDetails.map((p) => p.timeToMergeHours).filter((h) => h > 0);
  const medianCycleHrs = computeMedian(cycleTimes);

  // Pre-compute 30-day initial values so the HTML is already correct for the
  // default "Last 30 Days" filter, preventing a visible flicker on page load.
  // This mirrors getCutoffDate("30days") + applyFilter logic in the client JS.
  const collected = new Date(data.collectedAt);
  const cutoff30d = new Date(collected);
  cutoff30d.setUTCDate(cutoff30d.getUTCDate() - 30);
  const trends30d = (data.weeklyTrends ?? []).filter(
    (t) => weekToDate(t.week) >= cutoff30d,
  );
  const issuesOpened30 = trends30d.reduce((s, t) => s + (t.issuesOpened ?? 0), 0);
  const issuesClosed30 = trends30d.reduce((s, t) => s + (t.issuesClosed ?? 0), 0);
  const prsOpened30 = trends30d.reduce((s, t) => s + (t.prsOpened ?? 0), 0);
  const filtered30d = allPRDetails.filter((p) => new Date(p.mergedAt) >= cutoff30d);
  const prsMerged30 = filtered30d.length;
  const medianCycle30d = computeMedian(
    filtered30d.map((p) => p.timeToMergeHours).filter((h) => h > 0),
  );

  const repoSummaries = data.repos.map((r) => ({
    name: r.name,
    issues: Math.max(0, r.issues.open) + Math.max(0, r.issues.closed),
    prs: r.pullRequests.open + r.pullRequests.merged + r.pullRequests.closed,
  }));

  const chartPayload = JSON.stringify({
    owner: data.owner,
    issues: { open: totals.openIssues, closed: totals.closedIssues },
    prs: {
      open: totals.openPRs,
      merged: totals.mergedPRs,
      closed: totals.closedPRs,
    },
    topRepos,
    repoSummaries,
    repoNames: data.repos.map((r) => r.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    weeklyTrends: (data.weeklyTrends ?? []).map((t) => ({
      ...t,
      linesAdded: t.linesAdded ?? 0,
      linesDeleted: t.linesDeleted ?? 0,
    })),
    repoWeeklyTrends: Object.fromEntries(
      data.repos
        .filter((r) => r.weeklyTrends && r.weeklyTrends.length > 0)
        .map((r) => [
          r.name,
          r.weeklyTrends!.map((t) => ({
            week: t.week,
            issuesOpened: t.issuesOpened ?? 0,
            issuesClosed: t.issuesClosed ?? 0,
            prsOpened: t.prsOpened ?? 0,
            prsMerged: t.prsMerged ?? 0,
            linesAdded: t.linesAdded ?? 0,
            linesDeleted: t.linesDeleted ?? 0,
          })),
        ])
    ),
    allPRDetails,
    allIssueLeadTimes,
    copilot: {
      authored: copilotAuthored,
      reviewed: copilotReviewed,
      totalMerged: copilotTotalMerged,
      humanMerged: copilotHumanMerged,
      totalDetailed: copilotTotalDetailed,
      byType: aiByType,
    },
    copilotAgent: {
      totalTasks: agentTotalTasks,
      completed: agentCompleted,
      failed: agentFailed,
      cancelled: agentCancelled,
      timedOut: agentTimedOut,
      active: agentActive,
      totalSessions: agentTotalSessions,
      cloudSessions: agentCloudSessions,
      cliSessions: agentCliSessions,
      totalCredits: Math.round(agentCredits * 100) / 100,
      agentPRs,
      totalActionsMinutes: Math.round(agentActionsMinutes * 100) / 100,
      byRepo: agentByRepo,
    },
    collectedAt: data.collectedAt,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DevEx Metrics &ndash; ${escapeHtml(data.owner)}</title>
  <script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js"></script>
  <style>${getCSS()}</style>
</head>
<body>

<header class="hero">
  <div class="hero-meta-bar">
    <div class="subtitle">
      <div class="subtitle-top">${ownerLine}</div>
      <div class="subtitle-mid">${collectedLine}</div>
      ${dataRangeHtml ? `<div class="subtitle-bottom">${dataRangeHtml}</div>` : ''}
    </div>
    <nav class="hero-nav">
      <a href="https://github.com/rajbos" class="hero-nav-link">Made with &#x2764;&#xFE0F; by rajbos</a>
    </nav>
  </div>
  <h1>DevEx Metrics</h1>
</header>

<div class="filter-bar" role="toolbar" aria-label="Time period filter">
  <div class="filter-bar-inner">
    <span class="filter-label">Period:</span>
    <div class="filter-btns">
      <button class="filter-btn" data-period="all">All Time</button>
      <button class="filter-btn" data-period="year">This Year</button>
      <button class="filter-btn" data-period="90days">Last 90 Days</button>
      <button class="filter-btn active" data-period="30days">Last 30 Days</button>
    </div>
    <label class="filter-toggle" title="Exclude PRs authored by bots (dependabot, renovate, etc.) from charts and KPIs">
      <input type="checkbox" id="excludeBots" /> Exclude bots
    </label>
    <div class="repo-picker" id="repoPicker">
      <button class="repo-picker-btn" id="repoPickerBtn" aria-haspopup="true" aria-expanded="false" title="Filter charts by repository">
        <span id="repoPickerLabel">All repos</span> <span class="repo-picker-caret" aria-hidden="true">&#9660;</span>
      </button>
      <div class="repo-picker-panel" id="repoPickerPanel" hidden>
        <div class="repo-picker-toolbar">
          <button class="repo-picker-action" id="repoPickerReset">Reset</button>
          <button class="repo-picker-action" id="repoPickerClear">Clear</button>
          <input type="search" class="repo-picker-search" id="repoPickerSearch" placeholder="Search repos&hellip;" autocomplete="off" />
        </div>
        <div class="repo-picker-list" id="repoPickerList"></div>
      </div>
    </div>
  </div>
</div>

<main>
  <section class="kpis" aria-label="Key metrics">
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F4E6;</div>
      <div class="kpi-val">${data.repoCount}</div>
      <div class="kpi-lbl">Repositories</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x26A0;&#xFE0F;</div>
      <div class="kpi-val" id="kpiIssueVal">${issuesOpened30}</div>
      <div class="kpi-lbl" id="kpiIssueLbl">Issues Opened</div>
      <div class="kpi-sub" id="kpiIssueSub">${issuesClosed30} closed</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F500;</div>
      <div class="kpi-val" id="kpiPRVal">${prsMerged30}</div>
      <div class="kpi-lbl" id="kpiPRLbl">Merged PRs</div>
      <div class="kpi-sub" id="kpiPRSub">${prsOpened30} opened</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F465;</div>
      <div class="kpi-val">${totals.committers}</div>
      <div class="kpi-lbl">Committers</div>
      <div class="kpi-sub">${totals.reviewers} reviewers (90&nbsp;d)</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F916;</div>
      <div class="kpi-val" id="kpiCopilotVal">${copilotTotalMerged > 0 ? ((copilotAuthored / copilotTotalMerged) * 100).toFixed(1) + '%' : '–'}</div>
      <div class="kpi-lbl" id="kpiCopilotLbl">AI PRs</div>
      <div class="kpi-sub" id="kpiCopilotSub">${copilotAuthored} AI-authored &middot; ${copilotReviewed} reviewed</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F6E0;&#xFE0F;</div>
      <div class="kpi-val" id="kpiAgentVal">${agentTotalTasks > 0 ? agentTotalTasks : '–'}</div>
      <div class="kpi-lbl">Agent Tasks (30d)</div>
      <div class="kpi-sub" id="kpiAgentSub">${agentTotalTasks > 0 ? `${agentCompleted} completed &middot; ${agentPRs} PRs` : 'no agent data'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x23F1;&#xFE0F;</div>
      <div class="kpi-val" id="kpiCycleVal">${medianCycle30d > 0 ? formatDurationHtml(medianCycle30d) : '–'}</div>
      <div class="kpi-lbl" id="kpiCycleLbl">Median Cycle Time</div>
      <div class="kpi-sub" id="kpiCycleSub">PR created &rarr; merged</div>
    </div>
  </section>

  <section class="charts" aria-label="Charts">
    <div class="card card-chart"><h2>Issues</h2><canvas id="chartIssues"></canvas></div>
    <div class="card card-chart"><h2>Pull Requests</h2><canvas id="chartPRs"></canvas></div>
    <div class="card card-chart card-wide"><h2 id="chartReposTitle">Top Repositories</h2><canvas id="chartRepos"></canvas></div>
  </section>

  <section class="charts" aria-label="Trend charts">
    <div class="card card-chart card-wide"><h2>PR Trends (per week)</h2><canvas id="chartPRTrends"></canvas></div>
    <div class="card card-chart card-wide"><h2>Issue Trends (per week)</h2><canvas id="chartIssueTrends"></canvas></div>
    <div class="card card-chart card-wide"><h2>PR Size Trends (lines/week)</h2><canvas id="chartPRSizeTrends"></canvas></div>
  </section>

  <section class="charts" aria-label="Delivery metric charts">
    <div class="card card-chart card-wide"><h2>PR Cycle Time (weekly median, hours)</h2><canvas id="chartCycleTime"></canvas></div>
    <div class="card card-chart card-wide"><h2>Actor Breakdown (PRs merged per week)</h2><canvas id="chartActorBreakdown"></canvas></div>
    <div class="card card-chart"><h2>AI Adoption</h2><canvas id="chartCopilotAdoption"></canvas></div>
    <div class="card card-chart"><h2>AI Author Breakdown</h2><canvas id="chartAIAuthorBreakdown"></canvas></div>
    <div class="card card-chart"><h2>Issue &rarr; PR Lead Time</h2><canvas id="chartLeadTime"></canvas></div>
  </section>

  <section class="charts" aria-label="Copilot and Agent metrics">
    <div class="card card-chart card-wide"><h2>Copilot-authored PRs merged per week</h2><canvas id="chartCopilotPRTrend"></canvas></div>
    <div class="card card-chart card-wide"><h2>Agent Tasks by Repository (30&nbsp;d)</h2><canvas id="chartAgentTasks"></canvas></div>
  </section>

  <section class="repos-section" aria-label="Repositories">
    <div class="repos-toolbar">
      <h2>Repositories</h2>
      <div class="toolbar-ctrls">
        <input type="search" id="repoFilter" placeholder="Filter&hellip;" aria-label="Filter repositories" />
        <select id="repoSort" aria-label="Sort repositories">
          <option value="name">Name</option>
          <option value="openIssues">Open Issues</option>
          <option value="mergedPrs">Merged PRs</option>
          <option value="openPrs">Open PRs</option>
          <option value="contributors">Contributors</option>
          <option value="dependents">Dependents</option>
          <option value="pushed">Last Updated</option>
          <option value="linesAdded">Lines Added</option>
          <option value="agentTasks">Agent Tasks</option>
        </select>
      </div>
    </div>
    <p class="repos-period-note" id="reposPeriodNote">&#9432; The <strong>merged PR</strong> count reflects the selected period. Expand a row for all-time details.</p>
    <div class="table-wrap">
      <table class="repo-table" aria-label="Repositories">
        <thead><tr>
          <th class="col-repo th-sortable" data-sort="name">Repository <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-num th-sortable" data-sort="openIssues">Issues <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-num th-sortable" data-sort="mergedPrs">Merged PRs <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-num th-sortable" data-sort="openPrs">Open PRs <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-num th-sortable" data-sort="contributors">Contributors <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-num th-sortable" data-sort="dependents">Dependents <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-date th-sortable" data-sort="pushed">Last Updated <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-lines th-sortable" data-sort="linesAdded" title="Total lines added/removed across merged PRs in the last ~13 months (or last 10 detailed PRs when full timeline data is unavailable)">Lines +/- <span class="sort-ind" aria-hidden="true"></span></th>
          <th class="col-num th-sortable" data-sort="agentTasks" title="Copilot agent tasks in the 30-day collection window">Agent Tasks <span class="sort-ind" aria-hidden="true"></span></th>
        </tr></thead>
        <tbody id="repoList">${repoRows}</tbody>
      </table>
    </div>
    <p class="repo-count"><span id="shown">${data.repos.length}</span> of ${data.repos.length} repositories</p>
  </section>
</main>

<footer>Data cached on ${escapeHtml(date)}.${deployedFrom} Served via GitHub Pages. <a href="data.json">Raw JSON</a> &middot; <a href="report.md">Markdown</a></footer>

<script>
var CHART_DATA=${chartPayload};
${getJS()}
</script>

<a href="https://github.com/devex-metrics/devex-metrics" class="github-corner" aria-label="View source on GitHub" target="_blank" rel="noopener noreferrer">
  <svg width="80" height="80" viewBox="0 0 250 250" aria-hidden="true">
    <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"/>
    <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"/>
    <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"/>
  </svg>
</a>
</body>
</html>`;
}
