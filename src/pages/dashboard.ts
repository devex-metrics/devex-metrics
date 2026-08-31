import type { CiRunSample, OrgMetrics, RepoMetrics } from "../types.js";
import type { BrandingConfig } from "../config.js";
import type { RollupRow } from "../history.js";
import { LARGE_PR_LINES } from "../history.js";
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

/** Optional extras threaded in from the site build. */
export interface DashboardExtras {
  /** Site branding. Falls back to the built-in defaults when absent. */
  branding?: BrandingConfig;
  /** Rollup history rows, used by the trial view's baseline. */
  history?: RollupRow[];
  /**
   * Completed CI runs inside the configured window. Empty when the CI crawl
   * is off, which is its default — the card is then not rendered at all.
   */
  ciSamples?: CiRunSample[];
  /** How many days of CI history `ciSamples` covers, for the card's label. */
  ciWindowDays?: number;
}

const DEFAULT_BRANDING: BrandingConfig = {
  title: "DevEx Metrics",
  attribution: "Made with \u2764\uFE0F by rajbos",
  attributionUrl: "https://github.com/rajbos",
};

export function buildDashboardHtml(
  data: OrgMetrics,
  date: string,
  branch?: string,
  runUrl?: string,
  extras: DashboardExtras = {},
): string {
  const branding = extras.branding ?? DEFAULT_BRANDING;
  const history = extras.history ?? [];
  const ciSamples = extras.ciSamples ?? [];
  const ciWindowDays = extras.ciWindowDays ?? 90;
  const totals = aggregate(data.repos);
  const teamRepos = data.repos.filter((r) => r.isTeamRepo);
  const teamRepoNames = teamRepos.map((r) => r.name);
  // History rows are keyed by full name; match on the team resolved for *this*
  // build rather than the flag stored when the row was written, so re-scoping a
  // team also re-scopes its history.
  const teamFullNames = new Set(teamRepos.map((r) => r.fullName));

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
        number: p.number,
        mergedAt: p.mergedAt,
        createdAt: p.createdAt,
        author: p.author,
        isBotAuthor: p.isBotAuthor,
        isCopilotAuthored: p.isCopilotAuthored,
        aiAuthorType: p.aiAuthorType,
        timeToMergeHours: p.timeToMergeHours,
        linesAdded: p.linesAdded,
        linesDeleted: p.linesDeleted,
        firstReviewAt: p.firstReviewAt,
        firstApprovalAt: p.firstApprovalAt,
        reviewCount: p.reviewCount,
        changesRequestedCount: p.changesRequestedCount,
        revertsPR: p.revertsPR,
      }));
    }
    return r.pullRequestDetails
      .filter((pr) => !!pr.mergedAt)
      .map((pr) => ({
        repo: r.name,
        number: pr.number,
        mergedAt: pr.mergedAt!,
        createdAt: pr.createdAt,
        author: pr.author,
        isBotAuthor: false,
        isCopilotAuthored: pr.isCopilotAuthored,
        aiAuthorType: pr.aiAuthorType,
        timeToMergeHours: pr.timeToMergeHours ?? 0,
        linesAdded: pr.linesAdded,
        linesDeleted: pr.linesDeleted,
        firstReviewAt: undefined as string | undefined,
        firstApprovalAt: undefined as string | undefined,
        reviewCount: undefined as number | undefined,
        changesRequestedCount: undefined as number | undefined,
        revertsPR: undefined as number | undefined,
      }));
  });

  // Pull requests closed without merging, and those still open. Both come from
  // the same GraphQL page as the merged ones, so neither costs an extra call.
  const allClosedPRs = data.repos.flatMap((r) =>
    (r.closedPRTimeline ?? []).map((p) => ({
      repo: r.name,
      number: p.number,
      createdAt: p.createdAt,
      closedAt: p.closedAt,
      author: p.author,
      isBotAuthor: p.isBotAuthor,
      aiAuthorType: p.aiAuthorType,
      linesAdded: p.linesAdded,
      linesDeleted: p.linesDeleted,
    })),
  );
  const allOpenPRs = data.repos.flatMap((r) =>
    (r.openPRTimeline ?? []).map((p) => ({
      repo: r.name,
      number: p.number,
      createdAt: p.createdAt,
      author: p.author,
      isBotAuthor: p.isBotAuthor,
    })),
  );
  const reviewerLoadByRepo = Object.fromEntries(
    data.repos
      .filter((r) => r.reviewerLoad && r.reviewerLoad.length > 0)
      .map((r) => [r.name, r.reviewerLoad!]),
  );

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

  // Median cycle time (all-time) — computed for completeness; 30-day median used in HTML.
  const cycleTimes = allPRDetails.map((p) => p.timeToMergeHours).filter((h) => h > 0);
  const _medianCycleHrs = computeMedian(cycleTimes);

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
  // Pre-rendered 30-day values for the metrics added alongside cycle time, so
  // the first paint already matches the default filter.
  const sizes30d = filtered30d
    .map((p) => (p.linesAdded ?? 0) + (p.linesDeleted ?? 0))
    .filter((n) => n > 0);
  const medianSize30d = computeMedian(sizes30d);
  const largeShare30d =
    sizes30d.length > 0
      ? (sizes30d.filter((n) => n >= LARGE_PR_LINES).length / sizes30d.length) * 100
      : 0;
  const reviewWaits30d = filtered30d
    .map((p) =>
      p.firstReviewAt
        ? (new Date(p.firstReviewAt).getTime() - new Date(p.createdAt).getTime()) /
          3_600_000
        : -1,
    )
    .filter((h) => h >= 0);
  const medianReviewWait30d = computeMedian(reviewWaits30d);
  const abandoned30d = allClosedPRs.filter(
    (p) => new Date(p.closedAt) >= cutoff30d,
  ).length;
  const abandonRate30d =
    prsMerged30 + abandoned30d > 0
      ? (abandoned30d / (prsMerged30 + abandoned30d)) * 100
      : 0;
  const openAges30d = allOpenPRs.map(
    (p) => (collected.getTime() - new Date(p.createdAt).getTime()) / 3_600_000,
  );
  const medianOpenAge = computeMedian(openAges30d.filter((h) => h >= 0));
  const creditsPerAgentPR = agentPRs > 0 ? agentCredits / agentPRs : 0;

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
    ciSamples,
    allPRDetails,
    allClosedPRs,
    allOpenPRs,
    reviewerLoadByRepo,
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
    teamRepos: teamRepoNames,
    team: data.team ?? null,
    trial: data.trial ?? null,
    // Only the org-level rollup rows are needed for the trial baseline; the
    // per-repo rows would multiply the payload by the repo count for no gain.
    history: history
      .filter((r) => r.repo === "*" || teamFullNames.has(r.repo))
      .map((r) => ({
        date: r.date,
        repo: r.repo,
        isTeamRepo: r.isTeamRepo,
        mergedPRs30d: r.mergedPRs30d,
        cycleP50: r.cycleP50,
        cycleP75: r.cycleP75,
        cycleP90: r.cycleP90,
        sizeP50: r.sizeP50,
        aiPRs30d: r.aiPRs30d,
        humanPRs30d: r.humanPRs30d,
        reviewWaitP50: r.reviewWaitP50,
        abandonedPRs30d: r.abandonedPRs30d,
        reviewGini: r.reviewGini,
      })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(branding.title)} &ndash; ${escapeHtml(data.owner)}</title>
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
      <a href="${escapeHtml(branding.attributionUrl)}" class="hero-nav-link">${escapeHtml(branding.attribution)}</a>
    </nav>
  </div>
  <h1>${escapeHtml(branding.title)}</h1>
</header>

${buildTrialBanner(data, teamRepoNames.length)}

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
    ${teamRepoNames.length > 0 ? `<div class="scope-btns" role="group" aria-label="Repository scope">
      <button class="scope-btn active" data-scope="all" title="Every collected repository — the baseline">All repos</button>
      <button class="scope-btn" data-scope="team" title="Only the repositories in ${escapeHtml(data.team?.name ?? "the team")}">${escapeHtml(data.team?.name ?? "Team")}</button>
    </div>` : ""}
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
    <button class="share-btn" id="shareBtn" title="Copy a link to this exact slice — period, repositories and bot filter included">
      <span id="shareBtnLabel">Copy link</span>
    </button>
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
    <div class="kpi" title="Lines added plus deleted. Large changes are slower to review and likelier to be reverted.">
      <div class="kpi-icon" aria-hidden="true">&#x1F4CF;</div>
      <div class="kpi-val" id="kpiSizeVal">${medianSize30d > 0 ? Math.round(medianSize30d).toLocaleString() : '–'}</div>
      <div class="kpi-lbl">Median PR Size</div>
      <div class="kpi-sub" id="kpiSizeSub">${sizes30d.length > 0 ? `${largeShare30d.toFixed(0)}% over ${LARGE_PR_LINES} lines` : 'no sized PRs'}</div>
    </div>
    <div class="kpi" title="Time from a pull request being opened to its first review. Usually the longest leg of the trip.">
      <div class="kpi-icon" aria-hidden="true">&#x1F440;</div>
      <div class="kpi-val" id="kpiReviewWaitVal">${medianReviewWait30d > 0 ? formatDurationHtml(medianReviewWait30d) : '–'}</div>
      <div class="kpi-lbl">Wait for Review</div>
      <div class="kpi-sub" id="kpiReviewWaitSub">${reviewWaits30d.length > 0 ? `n=${reviewWaits30d.length} reviewed PRs` : 'no reviewed PRs'}</div>
    </div>
    <div class="kpi" title="Share of concluded pull requests that were closed without merging, and how old the still-open ones are.">
      <div class="kpi-icon" aria-hidden="true">&#x1F5D1;&#xFE0F;</div>
      <div class="kpi-val" id="kpiAbandonVal">${prsMerged30 + abandoned30d > 0 ? `${abandonRate30d.toFixed(1)}%` : '–'}</div>
      <div class="kpi-lbl">PRs Abandoned</div>
      <div class="kpi-sub" id="kpiAbandonSub">${allOpenPRs.length > 0 ? `${allOpenPRs.length} open &middot; median age ${formatDurationHtml(medianOpenAge)}` : `${abandoned30d} closed unmerged`}</div>
    </div>
    <div class="kpi" title="Copilot agent credits divided by the pull requests those agent tasks produced.">
      <div class="kpi-icon" aria-hidden="true">&#x1F4B3;</div>
      <div class="kpi-val" id="kpiAgentCostVal">${agentPRs > 0 ? creditsPerAgentPR.toFixed(1) : '–'}</div>
      <div class="kpi-lbl">Credits / Agent PR</div>
      <div class="kpi-sub" id="kpiAgentCostSub">${agentPRs > 0 ? `${agentCredits.toFixed(1)} credits &middot; ${agentPRs} PRs` : 'no agent data'}</div>
    </div>
  </section>

  ${buildFlowSection()}
  ${buildAIHumanSection()}
  ${buildCiSection(ciSamples.length > 0, ciWindowDays)}

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
    <div class="card card-chart card-wide"><h2>Wait for First Review (weekly median, hours)</h2><canvas id="chartReviewWait"></canvas></div>
    <div class="card card-chart card-wide">
      <h2>Review Load Concentration <span class="gini-badge" id="giniBadge">&ndash;</span></h2>
      <p class="metric-lede" id="giniNote">Reviews per reviewer. A Gini near 0 means the load is shared; near 1 means one person carries it.</p>
      <canvas id="chartReviewerLoad"></canvas>
    </div>
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

/**
 * The three legs of a pull request's life after it is opened.
 *
 * A single "review latency" number says the process is slow; the split says
 * which handoff is slow, which is the only version a team can act on. The
 * cells are filled by the client so they follow the period, repo and bot
 * filters like everything else.
 */
function buildFlowSection(): string {
  const legs = [
    { id: "review", label: "Waiting for a first review", hint: "opened → first review" },
    { id: "approval", label: "Waiting for approval", hint: "first review → first approval" },
    { id: "merge", label: "Waiting for a merge", hint: "first approval → merged" },
  ]
    .map(
      (leg) => `<tr data-leg="${leg.id}">
        <th scope="row">${leg.label}<span class="trial-hint">${leg.hint}</span></th>
        <td id="flowP50-${leg.id}">&ndash;</td>
        <td id="flowP75-${leg.id}">&ndash;</td>
        <td id="flowP90-${leg.id}">&ndash;</td>
        <td id="flowN-${leg.id}">&ndash;</td>
      </tr>`
    )
    .join("\n");

  return `<section class="card card-wide metric-card" aria-label="Review flow">
  <h2>Where the time goes</h2>
  <p class="metric-lede">Every leg of a merged pull request's life after it was opened. Medians, not
  means &mdash; one pull request left open over a holiday would move a mean and tell you nothing.</p>
  <div class="trial-table-wrap">
    <table class="trial-table">
      <thead><tr>
        <th scope="col">Leg</th>
        <th scope="col">p50</th>
        <th scope="col">p75</th>
        <th scope="col">p90</th>
        <th scope="col">n</th>
      </tr></thead>
      <tbody>
${legs}
      </tbody>
    </table>
  </div>
  <p class="trial-note" id="flowNote"></p>
</section>`;
}

/**
 * CI health: how often the trunk is green, how long a build takes, how long it
 * waits for a runner, and how often it needs a second attempt.
 *
 * Rendered only when the CI crawl has collected something. The alternative —
 * an empty card promising numbers that will never arrive because the feature
 * is off — is worse than no card.
 */
function buildCiSection(hasData: boolean, windowDays: number): string {
  if (!hasData) return "";
  const rows = [
    { id: "green", label: "Default-branch builds green", hint: "successful runs, excluding cancelled" },
    { id: "duration", label: "Build duration", hint: "runner pickup → conclusion" },
    { id: "queue", label: "Waiting for a runner", hint: "queued → picked up" },
    { id: "flaky", label: "Flaky runs", hint: "passed only on a re-run of the same commit" },
  ]
    .map(
      (r) => `<tr data-ci="${r.id}">
        <th scope="row">${r.label}<span class="trial-hint">${r.hint}</span></th>
        <td id="ciVal-${r.id}">&ndash;</td>
        <td id="ciDetail-${r.id}" class="thin">&ndash;</td>
      </tr>`
    )
    .join("\n");

  return `<section class="card card-wide metric-card" aria-label="CI health">
  <h2>CI health</h2>
  <p class="metric-lede">Workflow runs on each repository's default branch, collected by a budgeted
  crawl rather than by asking for every commit's checks. Covers the last ${windowDays} days.</p>
  <div class="trial-table-wrap">
    <table class="trial-table">
      <thead><tr>
        <th scope="col">Measure</th>
        <th scope="col">Value</th>
        <th scope="col">Detail</th>
      </tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
  <p class="trial-note" id="ciNote"></p>
</section>`;
}

/**
 * AI-authored against human-authored pull requests, side by side.
 *
 * The comparison every team asks for and almost none can answer from their own
 * data. Both columns are computed from the same filtered set, so the only
 * difference between them is who wrote the pull request.
 */
function buildAIHumanSection(): string {
  const rows = [
    { id: "merged", label: "Merged PRs", hint: "in the selected period" },
    { id: "cycle", label: "Median cycle time", hint: "opened → merged" },
    { id: "cycle75", label: "Cycle time p75", hint: "the slow quarter" },
    { id: "size", label: "Median PR size", hint: "lines added + deleted" },
    { id: "large", label: "Large PRs", hint: `share over ${LARGE_PR_LINES} lines` },
    { id: "reviewWait", label: "Wait for first review", hint: "opened → first review" },
    { id: "rounds", label: "Review rounds", hint: "median changes-requested reviews" },
    { id: "revert", label: "Reverted", hint: "share later reverted by another PR" },
  ]
    .map(
      (r) => `<tr data-metric="${r.id}">
        <th scope="row">${r.label}<span class="trial-hint">${r.hint}</span></th>
        <td class="trial-baseline" id="aiHumanAI-${r.id}">&ndash;</td>
        <td class="trial-team" id="aiHumanHuman-${r.id}">&ndash;</td>
        <td class="trial-delta" id="aiHumanDelta-${r.id}">&ndash;</td>
      </tr>`
    )
    .join("\n");

  return `<section class="card card-wide metric-card" aria-label="AI versus human pull requests">
  <h2>AI vs human pull requests</h2>
  <p class="metric-lede">The same measurements, split by who authored the pull request. Bot authors
  that are not AI tools (Dependabot and friends) are excluded from both columns.</p>
  <div class="trial-table-wrap">
    <table class="trial-table">
      <thead><tr>
        <th scope="col">Metric</th>
        <th scope="col">AI-authored</th>
        <th scope="col">Human-authored</th>
        <th scope="col">Difference</th>
      </tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
  <p class="trial-note" id="aiHumanNote"></p>
</section>`;
}

/**
 * The trial banner: what the intervention is, when it started, and how the
 * team's current numbers sit against the org-wide baseline.
 *
 * The numbers themselves are filled in by the client so they follow the period
 * and bot filters; this renders the frame and the static context.
 */
function buildTrialBanner(data: OrgMetrics, teamRepoCount: number): string {
  const trial = data.trial;
  if (!trial) return "";

  const teamName = data.team?.name ?? "the team";
  const started = trial.interventionStart
    ? `<span class="trial-date" title="Intervention start">started ${escapeHtml(trial.interventionStart)}</span>`
    : "";
  const baseline =
    trial.baselineFrom && trial.baselineTo
      ? `<span class="trial-baseline-window">baseline ${escapeHtml(trial.baselineFrom)} &rarr; ${escapeHtml(trial.baselineTo)}</span>`
      : `<span class="trial-baseline-window">baseline: all repositories, all time</span>`;
  const hypothesis = trial.hypothesis
    ? `<p class="trial-hypothesis">${escapeHtml(trial.hypothesis)}</p>`
    : "";
  const milestones =
    trial.milestones.length > 0
      ? `<ul class="trial-milestones">${trial.milestones
          .map(
            (m) =>
              `<li><span class="trial-milestone-date">${escapeHtml(m.date)}</span> ${escapeHtml(m.label)}</li>`
          )
          .join("")}</ul>`
      : "";

  // One row per metric: baseline (all repos) vs the team's current numbers.
  const rows = [
    { id: "cycle", label: "Median cycle time", hint: "PR created → merged" },
    { id: "cycle75", label: "Cycle time p75", hint: "the slow quarter of PRs" },
    { id: "cycle90", label: "Cycle time p90", hint: "the worst tenth" },
    { id: "size", label: "Median PR size", hint: "lines added + deleted" },
    { id: "merged", label: "Merged PRs", hint: "in the selected period" },
    { id: "ai", label: "AI-authored PRs", hint: "share of human + AI PRs" },
  ]
    .map(
      (r) => `<tr data-metric="${r.id}">
        <th scope="row">${r.label}<span class="trial-hint">${r.hint}</span></th>
        <td class="trial-baseline" id="trialBaseline-${r.id}">&ndash;</td>
        <td class="trial-team" id="trialTeam-${r.id}">&ndash;</td>
        <td class="trial-delta" id="trialDelta-${r.id}">&ndash;</td>
      </tr>`
    )
    .join("\n");

  return `<section class="trial" aria-label="Improvement trial">
  <div class="trial-head">
    <div>
      <div class="trial-eyebrow">Improvement trial</div>
      <h2 class="trial-title">${escapeHtml(trial.title)}</h2>
      ${hypothesis}
    </div>
    <div class="trial-facts">
      <div class="trial-team-name">${escapeHtml(teamName)} &middot; ${teamRepoCount} repo${teamRepoCount === 1 ? "" : "s"}</div>
      ${started}
      ${baseline}
    </div>
  </div>
  ${milestones}
  <div class="trial-table-wrap">
    <table class="trial-table">
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col">Baseline<span class="trial-hint">all ${data.repoCount} repos</span></th>
          <th scope="col">${escapeHtml(teamName)}<span class="trial-hint">current period</span></th>
          <th scope="col">Difference</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
  <p class="trial-note" id="trialNote"></p>
</section>`;
}
