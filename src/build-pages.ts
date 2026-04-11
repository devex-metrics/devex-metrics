import * as fs from "node:fs";
import * as path from "node:path";
import { generateReport } from "./report.js";
import type { CacheEnvelope, OrgMetrics, RepoMetrics } from "./types.js";

/**
 * Build a static GitHub Pages site from cached metrics data.
 *
 * Usage:
 *   node dist/build-pages.js <owner>
 *
 * Reads data/<owner>.json and writes:
 *   _site/index.html  – interactive dashboard
 *   _site/report.md   – Markdown report
 *   _site/data.json   – raw JSON API
 */
function main(): void {
  const owner = process.argv[2];
  if (!owner) {
    console.error("Usage: build-pages <owner>");
    process.exit(1);
  }

  const dataDir = path.resolve(process.cwd(), "data");
  const cacheFile = path.join(dataDir, `${owner}.json`);
  const siteDir = path.resolve(process.cwd(), "_site");

  if (!fs.existsSync(cacheFile)) {
    console.error(`No cached data found at ${cacheFile}`);
    process.exit(1);
  }

  const envelope: CacheEnvelope = JSON.parse(
    fs.readFileSync(cacheFile, "utf-8")
  );
  const markdown = generateReport(envelope.data);

  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, "report.md"), markdown);
  fs.writeFileSync(
    path.join(siteDir, "data.json"),
    JSON.stringify(envelope.data, null, 2)
  );

  const branch = process.env.GITHUB_REF_NAME;
  const runUrl = buildRunUrl();
  const html = buildDashboardHtml(
    envelope.data,
    envelope.date,
    branch,
    runUrl,
  );
  fs.writeFileSync(path.join(siteDir, "index.html"), html);

  console.log(`GitHub Pages site built in ${siteDir}/`);
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

// GitHub mark SVG icon (used in hero nav and repo card links)
const GITHUB_MARK_SVG = '<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRunUrl(): string | undefined {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`;
  }
  return undefined;
}

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

/* ------------------------------------------------------------------ */
/*  Dashboard HTML builder                                            */
/* ------------------------------------------------------------------ */

function buildDashboardHtml(
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
    ? ` &middot; <span class="data-range">&#x1F4C5; ${escapeHtml(oldestDataDate)} &rarr; ${escapeHtml(newestDataDate || data.collectedAt.slice(0, 10))}</span>`
    : '';

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
      issues: r.issues.open + r.issues.closed,
      prs:
        r.pullRequests.open + r.pullRequests.merged + r.pullRequests.closed,
    }))
    .sort((a, b) => b.issues + b.prs - (a.issues + a.prs))
    .slice(0, 15);

  const repoRows = data.repos.map((repo) => buildRepoRow(repo)).join("\n");

  const allPRDetails = data.repos.flatMap((r) => {
    // Prefer mergedPRDates (wider history, 1 cheap API call) over the
    // 10-entry pullRequestDetails so the chart filter spans real time ranges.
    if (r.mergedPRDates && r.mergedPRDates.length > 0) {
      return r.mergedPRDates.map((date) => ({ repo: r.name, mergedAt: date }));
    }
    return r.pullRequestDetails
      .filter((pr) => !!pr.mergedAt)
      .map((pr) => ({ repo: r.name, mergedAt: pr.mergedAt! }));
  });

  const chartPayload = JSON.stringify({
    issues: { open: totals.openIssues, closed: totals.closedIssues },
    prs: {
      open: totals.openPRs,
      merged: totals.mergedPRs,
      closed: totals.closedPRs,
    },
    topRepos,
    weeklyTrends: (data.weeklyTrends ?? []).map((t) => ({
      ...t,
      linesAdded: t.linesAdded ?? 0,
      linesDeleted: t.linesDeleted ?? 0,
    })),
    allPRDetails,
    collectedAt: data.collectedAt,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DevEx Metrics &ndash; ${escapeHtml(data.owner)}</title>
  <script defer src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>${getCSS()}</style>
</head>
<body>

<header class="hero">
  <nav class="hero-nav">
    <a href="https://github.com/rajbos" class="hero-nav-link">Made with &#x2764;&#xFE0F; by rajbos</a>
  </nav>
  <h1>DevEx Metrics</h1>
  <p class="subtitle">${escapeHtml(data.owner)} &middot; ${escapeHtml(data.ownerType)} &middot; collected ${escapeHtml(data.collectedAt)}${dataRangeHtml}</p>
</header>

<main>
  <div class="filter-bar" role="toolbar" aria-label="Time period filter">
    <span class="filter-label">Period:</span>
    <div class="filter-btns">
      <button class="filter-btn" data-period="all">All Time</button>
      <button class="filter-btn" data-period="year">This Year</button>
      <button class="filter-btn" data-period="90days">Last 90 Days</button>
      <button class="filter-btn active" data-period="30days">Last 30 Days</button>
    </div>
  </div>

  <section class="kpis" aria-label="Key metrics">
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F4E6;</div>
      <div class="kpi-val">${data.repoCount}</div>
      <div class="kpi-lbl">Repositories</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x26A0;&#xFE0F;</div>
      <div class="kpi-val" id="kpiIssueVal">${totals.openIssues}</div>
      <div class="kpi-lbl" id="kpiIssueLbl">Open Issues</div>
      <div class="kpi-sub" id="kpiIssueSub">${totals.closedIssues} closed</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F500;</div>
      <div class="kpi-val" id="kpiPRVal">${totals.mergedPRs}</div>
      <div class="kpi-lbl" id="kpiPRLbl">Merged PRs</div>
      <div class="kpi-sub" id="kpiPRSub">${totals.openPRs} open &middot; ${totals.closedPRs} closed</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F465;</div>
      <div class="kpi-val">${totals.committers}</div>
      <div class="kpi-lbl">Committers</div>
      <div class="kpi-sub">${totals.reviewers} reviewers (90&nbsp;d)</div>
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
          <th class="col-lines th-sortable" data-sort="linesAdded">Lines +/- <span class="sort-ind" aria-hidden="true"></span></th>
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

/* ------------------------------------------------------------------ */
/*  Repo row builder (table layout)                                  */
/* ------------------------------------------------------------------ */

function buildRepoRow(repo: RepoMetrics): string {
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
        `<td><span class="add">+${pr.linesAdded}</span> <span class="del">-${pr.linesDeleted}</span></td>` +
        `<td>${pr.commentCount}</td><td>${pr.commitCount}</td><td>${pr.actionsMinutes}</td></tr>`,
    )
    .join("");

  const prTable =
    sortedPRDetails.length > 0
      ? `<div class="pr-wrap"><h4>Recent Pull Requests</h4>
      <table class="pr-tbl"><thead><tr><th>PR</th><th>Merged</th><th>Lines</th><th>Comments</th><th>Commits</th><th>CI&nbsp;min</th></tr></thead>
      <tbody>${prRows}</tbody></table></div>`
      : "";

  const totalContrib = repo.committerCount + repo.reviewerCount;
  const linesAdded = repo.pullRequestDetails.reduce(
    (s, pr) => s + pr.linesAdded,
    0,
  );
  const linesDeleted = repo.pullRequestDetails.reduce(
    (s, pr) => s + pr.linesDeleted,
    0,
  );
  const pushedDate = repo.pushedAt ? repo.pushedAt.slice(0, 10) : "";
  const repoUrl = `https://github.com/${escapeHtml(repo.fullName)}`;
  const repoId = repo.fullName
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-");

  const dataRow =
    `<tr class="repo-row" ` +
    `data-name="${escapeHtml(repo.fullName.toLowerCase())}" ` +
    `data-repo-name="${escapeHtml(repo.name.toLowerCase())}" ` +
    `data-open-issues="${repo.issues.open}" ` +
    `data-merged-prs="${repo.pullRequests.merged}" ` +
    `data-open-prs="${repo.pullRequests.open}" ` +
    `data-contributors="${totalContrib}" ` +
    `data-dependents="${repo.dependentCount}" ` +
    `data-pushed="${escapeHtml(repo.pushedAt ?? "")}" ` +
    `data-lines-added="${linesAdded}" ` +
    `data-lines-deleted="${linesDeleted}" ` +
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
    `<td><span class="add">+${linesAdded}</span> <span class="del">-${linesDeleted}</span></td>` +
    `</tr>`;

  const detailRow =
    `<tr class="repo-detail-row" id="detail-${repoId}" hidden>` +
    `<td colspan="8" class="repo-detail-cell">` +
    `<div class="stats-grid">` +
    `<div class="sg"><h4>Issues</h4><dl><div class="dr"><dt>Open</dt><dd>${repo.issues.open}</dd></div><div class="dr"><dt>Closed</dt><dd>${repo.issues.closed}</dd></div></dl></div>` +
    `<div class="sg"><h4>Pull Requests</h4><dl><div class="dr"><dt>Open</dt><dd>${repo.pullRequests.open}</dd></div><div class="dr"><dt>Merged</dt><dd>${repo.pullRequests.merged}</dd></div><div class="dr"><dt>Closed</dt><dd>${repo.pullRequests.closed}</dd></div></dl></div>` +
    `<div class="sg"><h4>People (90 d)</h4><dl><div class="dr"><dt>Committers</dt><dd>${repo.committerCount}</dd></div><div class="dr"><dt>Reviewers</dt><dd>${repo.reviewerCount}</dd></div></dl></div>` +
    `<div class="sg"><h4>Dependents</h4><dl><div class="dr"><dt>Repos</dt><dd>${repo.dependentCount}</dd></div></dl></div>` +
    `</div>` +
    prTable +
    `</td>` +
    `</tr>`;

  return dataRow + "\n" + detailRow;
}

/* ------------------------------------------------------------------ */
/*  Embedded CSS                                                      */
/* ------------------------------------------------------------------ */

function getCSS(): string {
  return `
:root{--bg:#f0f3f6;--fg:#1f2328;--card:#fff;--muted:#656d76;--border:#d1d9e0;
  --accent:#0969da;--accent-s:#ddf4ff;--ok:#1a7f37;--ok-s:#dafbe1;
  --warn:#9a6700;--warn-s:#fff8c5;--err:#cf222e;--err-s:#ffebe9;
  --purple:#8250df;--sh:0 1px 3px rgba(31,35,40,.06);--sh-h:0 4px 12px rgba(31,35,40,.1);
  --r:12px;--rs:8px}
@media(prefers-color-scheme:dark){:root{--bg:#010409;--fg:#e6edf3;--card:#0d1117;
  --muted:#8b949e;--border:#30363d;--accent:#58a6ff;--accent-s:#0c2d6b;
  --ok:#3fb950;--ok-s:#0b3d1a;--warn:#d29922;--warn-s:#3d2a04;
  --err:#f85149;--err-s:#4c1119;--purple:#bc8cff;
  --sh:0 1px 3px rgba(0,0,0,.24);--sh-h:0 4px 12px rgba(0,0,0,.32)}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  color:var(--fg);background:var(--bg);line-height:1.55;min-height:100vh}
main{max-width:1400px;margin:0 auto;padding:0 1rem 2rem}
a{color:var(--accent)}
.hero{background:linear-gradient(135deg,#0969da 0%,#8250df 100%);color:#fff;
  padding:2.5rem 2rem;text-align:center;margin-bottom:2rem}
@media(prefers-color-scheme:dark){.hero{background:linear-gradient(135deg,#1158a7 0%,#6639ba 100%)}}
.hero h1{font-size:1.8rem;font-weight:700;margin-bottom:.35rem}
.subtitle{opacity:.88;font-size:.95rem}
.hero-nav{display:flex;justify-content:flex-end;gap:1rem;margin-bottom:1rem;padding-right:90px}
.hero-nav-link{color:#fff;opacity:.85;font-size:.85rem;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.4);padding-bottom:.1rem;transition:opacity .15s}
.hero-nav-link:hover{opacity:1;border-bottom-color:#fff}
.hero-nav-link{display:inline-flex;align-items:center;gap:.35rem}
.github-corner svg{position:fixed;top:0;right:0;border:0;z-index:999;fill:#24292f;color:#fff}
.github-corner:hover .octo-arm{animation:octocat-wave 560ms ease-in-out}
@keyframes octocat-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}}
@media(max-width:500px){.github-corner:hover .octo-arm{animation:none}.github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out}}
@media(prefers-color-scheme:dark){.github-corner svg{fill:#58a6ff;color:#010409}}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
.kpi{background:var(--card);border-radius:var(--r);padding:1.25rem 1rem;text-align:center;
  box-shadow:var(--sh);transition:transform .2s,box-shadow .2s}
.kpi:hover{transform:translateY(-2px);box-shadow:var(--sh-h)}
.kpi-icon{font-size:1.6rem;margin-bottom:.3rem}
.kpi-val{font-size:2rem;font-weight:700;line-height:1.1}
.kpi-lbl{font-size:.85rem;color:var(--muted);margin-top:.15rem}
.kpi-sub{font-size:.75rem;color:var(--muted);margin-top:.15rem}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:2rem}
.card{background:var(--card);border-radius:var(--r);padding:1.25rem;box-shadow:var(--sh)}
.card h2{font-size:1rem;font-weight:600;margin-bottom:.75rem}
.card-wide{grid-column:1/-1}
.card canvas{display:block;width:100%;max-height:260px}
.card-wide canvas{max-height:340px}
.card-trend canvas{max-height:240px}
.repos-section{margin-bottom:2rem}
.repos-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin-bottom:1rem}
.repos-toolbar h2{font-size:1.2rem;flex:1}
.toolbar-ctrls{display:flex;gap:.5rem}
#repoFilter,#repoSort{font:inherit;font-size:.85rem;padding:.45rem .7rem;
  border:1px solid var(--border);border-radius:var(--rs);background:var(--card);color:var(--fg)}
#repoFilter{width:220px}
#repoFilter:focus,#repoSort:focus{outline:2px solid var(--accent);outline-offset:-1px}
.table-wrap{overflow-x:auto;border-radius:var(--r);box-shadow:var(--sh)}
.repo-table{width:100%;border-collapse:collapse;background:var(--card);font-size:.85rem}
.repo-table thead tr{border-bottom:2px solid var(--border)}
.repo-table th{padding:.55rem .8rem;text-align:left;font-size:.75rem;text-transform:uppercase;
  letter-spacing:.04em;color:var(--muted);font-weight:600;white-space:nowrap;background:var(--card);position:sticky;top:0;z-index:1}
.repo-table td{padding:.5rem .8rem;border-bottom:1px solid var(--border);vertical-align:middle}
.repo-row:hover>td{background:var(--accent-s)}
.repo-row.expanded>td{background:var(--accent-s)}
.repo-detail-cell{background:var(--bg);padding:1rem 1.25rem}
.th-sortable{cursor:pointer;user-select:none}
.th-sortable:hover{color:var(--accent)}
.th-sortable.sort-active{color:var(--accent)}
.sort-ind{margin-left:.3rem;font-size:.8rem;display:inline-block;min-width:.7rem}
.repo-name-cell{display:flex;align-items:center;gap:.4rem;min-width:180px}
.repo-expand-btn{display:inline-flex;align-items:center;justify-content:center;
  width:1.4rem;height:1.4rem;border:none;background:none;color:var(--muted);
  cursor:pointer;padding:0;flex-shrink:0;font-size:1.1rem;line-height:1}
.repo-expand-btn:hover{color:var(--accent)}
.chev{display:inline-block;transition:transform .2s}
.repo-row.expanded .chev{transform:rotate(90deg)}
.rname{font-weight:600;color:var(--accent);text-decoration:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.85rem}
.rname:hover{text-decoration:underline}
.col-muted{color:var(--muted);font-size:.8rem}
.col-num{text-align:right}
.col-date,.col-lines{white-space:nowrap}
.grp-hdr-row{cursor:pointer;user-select:none}
.grp-hdr-cell{padding:.5rem .8rem;font-size:.82rem;font-weight:600;
  background:var(--bg);color:var(--muted);border-bottom:1px solid var(--border)}
.grp-hdr-row:hover .grp-hdr-cell{color:var(--fg);background:var(--border)}
.grp-chevron{display:inline-block;font-size:.75rem;transition:transform .2s;
  color:var(--muted);margin-right:.4rem}
.grp-hdr-row.expanded .grp-chevron{transform:rotate(90deg)}
.grp-count{color:var(--muted);font-size:.8rem;font-weight:400}
.bdg{font-size:.7rem;padding:.15rem .5rem;border-radius:999px;font-weight:500;white-space:nowrap}
.bdg-age{background:var(--border);color:var(--muted)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1rem}
.sg h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:.4rem}
dl{display:flex;flex-direction:column;gap:.15rem}
.dr{display:flex;justify-content:space-between;font-size:.85rem}
.dr dt{color:var(--muted)}.dr dd{font-weight:600}
.pr-wrap{margin-top:.5rem}.pr-wrap h4{font-size:.85rem;margin-bottom:.5rem}
.pr-tbl{width:100%;border-collapse:collapse;font-size:.8rem}
.pr-tbl th,.pr-tbl td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--border)}
.pr-tbl th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.03em}
.add{color:var(--ok);font-weight:600}.del{color:var(--err);font-weight:600}
.repo-count{text-align:center;font-size:.8rem;color:var(--muted);margin-top:.75rem}
.filter-bar{display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem;flex-wrap:wrap;
  background:var(--card);border-radius:var(--r);padding:.75rem 1rem;box-shadow:var(--sh)}
.filter-label{font-size:.85rem;color:var(--muted);font-weight:500;white-space:nowrap}
.filter-btns{display:flex;gap:.4rem;flex-wrap:wrap}
.repos-period-note{font-size:.78rem;color:var(--muted);margin:.25rem 0 .6rem;padding:.3rem .5rem;background:var(--accent-s);border-left:3px solid var(--accent);border-radius:0 var(--rs) var(--rs) 0}
.repos-period-note{font-size:.78rem;color:var(--muted);margin:.25rem 0 .6rem;padding:.3rem .5rem;background:var(--accent-s);border-left:3px solid var(--accent);border-radius:0 var(--rs) var(--rs) 0}
.filter-btn{font:inherit;font-size:.8rem;padding:.3rem .8rem;border:1px solid var(--border);
  border-radius:999px;background:transparent;color:var(--muted);cursor:pointer;transition:all .15s}
.filter-btn:hover{border-color:var(--accent);color:var(--accent)}
.filter-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.data-range{opacity:.82;font-size:.88rem}
footer{max-width:1400px;margin:0 auto;padding:1rem;text-align:center;font-size:.8rem;
  color:var(--muted);border-top:1px solid var(--border)}
@media(max-width:640px){
  .charts{grid-template-columns:1fr}
  .hero{padding:1.5rem 1rem}.hero h1{font-size:1.4rem}
  .toolbar-ctrls{flex-direction:column;width:100%}
  #repoFilter{width:100%}
  .col-date,.col-lines{display:none}
}`;
}

/* ------------------------------------------------------------------ */
/*  Embedded JavaScript                                               */
/* ------------------------------------------------------------------ */

function getJS(): string {
  return `
var charts={};
var cssColors={};
document.addEventListener("DOMContentLoaded",function(){
  var cs=getComputedStyle(document.documentElement);
  var cv=function(v){return cs.getPropertyValue(v).trim();};
  cssColors={warn:cv("--warn"),ok:cv("--ok"),accent:cv("--accent"),
    accentS:cv("--accent-s"),okS:cv("--ok-s"),warnS:cv("--warn-s"),
    err:cv("--err"),errS:cv("--err-s"),muted:cv("--muted"),border:cv("--border")};
  if(typeof Chart!=="undefined"){renderCharts();}
  setupGroups();
  setupControls();
  setupSortHeaders();
  setupFilter();
  applyFilter("30days");
});
function renderCharts(){
  Chart.register({id:"repoBarGrad",beforeUpdate:function(chart){
    if(chart.canvas.id!=="chartRepos")return;
    var ctx=chart.ctx,ca=chart.chartArea;
    if(!ca)return;
    chart.data.datasets.forEach(function(ds){
      var base=ds._gradBase;if(!base)return;
      var g=ctx.createLinearGradient(ca.left,0,ca.right,0);
      g.addColorStop(0,base);g.addColorStop(1,base+"55");
      ds.backgroundColor=g;
    });
  }});
  Chart.defaults.color=cssColors.muted;
  Chart.defaults.plugins.legend.labels.usePointStyle=true;
  Chart.defaults.plugins.legend.labels.padding=16;
  var dOpts={cutout:"62%",plugins:{legend:{position:"bottom"}},responsive:true,maintainAspectRatio:true};
  charts.issues=new Chart(document.getElementById("chartIssues"),{type:"doughnut",
    data:{labels:["Open","Closed"],datasets:[{data:[CHART_DATA.issues.open,CHART_DATA.issues.closed],
      backgroundColor:[cssColors.warn,cssColors.ok],borderWidth:0,hoverOffset:6}]},options:dOpts});
  charts.prs=new Chart(document.getElementById("chartPRs"),{type:"doughnut",
    data:{labels:["Open","Merged","Closed"],datasets:[{data:[CHART_DATA.prs.open,CHART_DATA.prs.merged,CHART_DATA.prs.closed],
      backgroundColor:[cssColors.accent,cssColors.ok,cssColors.muted],borderWidth:0,hoverOffset:6}]},options:dOpts});
  if(CHART_DATA.topRepos.length>0){
    charts.repos=new Chart(document.getElementById("chartRepos"),{type:"bar",
      data:{labels:CHART_DATA.topRepos.map(function(r){return r.name;}),
        datasets:[{label:"Issues",data:CHART_DATA.topRepos.map(function(r){return r.issues;}),_gradBase:cssColors.warn,backgroundColor:cssColors.warn,borderRadius:3},
          {label:"Pull Requests",data:CHART_DATA.topRepos.map(function(r){return r.prs;}),_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}]},
      options:{indexAxis:"y",responsive:true,
        scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{display:false}}},
        plugins:{legend:{position:"top",align:"end"}}}});
  }
  if(CHART_DATA.weeklyTrends&&CHART_DATA.weeklyTrends.length>0){
    var tLabels=CHART_DATA.weeklyTrends.map(function(t){return t.week;});
    var lineOpts={responsive:true,maintainAspectRatio:true,
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:cssColors.border}}},
      plugins:{legend:{position:"top",align:"end"}}};
    charts.prTrends=new Chart(document.getElementById("chartPRTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Opened",data:CHART_DATA.weeklyTrends.map(function(t){return t.prsOpened;}),
          borderColor:cssColors.accent,backgroundColor:cssColors.accentS,tension:0.3,fill:true,pointRadius:3},
        {label:"Merged",data:CHART_DATA.weeklyTrends.map(function(t){return t.prsMerged;}),
          borderColor:cssColors.ok,backgroundColor:cssColors.okS,tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
    charts.issueTrends=new Chart(document.getElementById("chartIssueTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Opened",data:CHART_DATA.weeklyTrends.map(function(t){return t.issuesOpened;}),
          borderColor:cssColors.warn,backgroundColor:cssColors.warnS,tension:0.3,fill:true,pointRadius:3},
        {label:"Closed",data:CHART_DATA.weeklyTrends.map(function(t){return t.issuesClosed;}),
          borderColor:cssColors.ok,backgroundColor:cssColors.okS,tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
    charts.prSizeTrends=new Chart(document.getElementById("chartPRSizeTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Lines Added",data:CHART_DATA.weeklyTrends.map(function(t){return t.linesAdded;}),
          borderColor:cssColors.ok,backgroundColor:cssColors.okS,tension:0.3,fill:true,pointRadius:3},
        {label:"Lines Removed",data:CHART_DATA.weeklyTrends.map(function(t){return t.linesDeleted;}),
          borderColor:cssColors.err,backgroundColor:cssColors.errS,tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
  }
}
function setupFilter(){
  document.querySelectorAll(".filter-btn").forEach(function(btn){
    btn.addEventListener("click",function(){
      document.querySelectorAll(".filter-btn").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active");
      applyFilter(btn.dataset.period);
    });
  });
}
function getCutoffDate(period){
  var collected=new Date(CHART_DATA.collectedAt);
  var d;
  if(period==="year")return new Date(Date.UTC(collected.getUTCFullYear(),0,1));
  d=new Date(collected);
  if(period==="90days"){d.setUTCDate(d.getUTCDate()-90);return d;}
  if(period==="30days"){d.setUTCDate(d.getUTCDate()-30);return d;}
  return null;
}
function weekToDate(weekStr){
  var parts=weekStr.split("-W");
  var year=parseInt(parts[0],10);var week=parseInt(parts[1],10);
  var jan4=new Date(Date.UTC(year,0,4));
  var dow=jan4.getUTCDay()||7;
  var mon=new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate()-dow+1+(week-1)*7);
  return mon;
}
function applyFilter(period){
  var cutoff=getCutoffDate(period);
  var trends=CHART_DATA.weeklyTrends||[];
  if(cutoff)trends=trends.filter(function(t){return weekToDate(t.week)>=cutoff;});
  var tLabels=trends.map(function(t){return t.week;});
  if(charts.prTrends){
    charts.prTrends.data.labels=tLabels;
    charts.prTrends.data.datasets[0].data=trends.map(function(t){return t.prsOpened;});
    charts.prTrends.data.datasets[1].data=trends.map(function(t){return t.prsMerged;});
    charts.prTrends.update();
  }
  if(charts.issueTrends){
    charts.issueTrends.data.labels=tLabels;
    charts.issueTrends.data.datasets[0].data=trends.map(function(t){return t.issuesOpened;});
    charts.issueTrends.data.datasets[1].data=trends.map(function(t){return t.issuesClosed;});
    charts.issueTrends.update();
  }
  if(charts.prSizeTrends){
    charts.prSizeTrends.data.labels=tLabels;
    charts.prSizeTrends.data.datasets[0].data=trends.map(function(t){return t.linesAdded;});
    charts.prSizeTrends.data.datasets[1].data=trends.map(function(t){return t.linesDeleted;});
    charts.prSizeTrends.update();
  }
  if(charts.repos){
    var titleEl=document.getElementById("chartReposTitle");
    if(period==="all"){
      charts.repos.data.labels=CHART_DATA.topRepos.map(function(r){return r.name;});
      charts.repos.data.datasets=[
        {label:"Issues",data:CHART_DATA.topRepos.map(function(r){return r.issues;}),_gradBase:cssColors.warn,backgroundColor:cssColors.warn,borderRadius:3},
        {label:"Pull Requests",data:CHART_DATA.topRepos.map(function(r){return r.prs;}),_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}];
      if(titleEl)titleEl.textContent="Top Repositories";
    }else{
      var filteredPRs=(CHART_DATA.allPRDetails||[]).filter(function(p){return cutoff?new Date(p.mergedAt)>=cutoff:true;});
      var counts={};
      filteredPRs.forEach(function(p){counts[p.repo]=(counts[p.repo]||0)+1;});
      var topFiltered=Object.keys(counts).map(function(n){return{name:n,prs:counts[n]};})
        .sort(function(a,b){return b.prs-a.prs;}).slice(0,15);
      charts.repos.data.labels=topFiltered.map(function(r){return r.name;});
      charts.repos.data.datasets=[
        {label:"Merged PRs",data:topFiltered.map(function(r){return r.prs;}),_gradBase:cssColors.accent,backgroundColor:cssColors.accent,borderRadius:3}];
      var periodLabel=period==="year"?"This Year":period==="90days"?"Last 90 Days":"Last 30 Days";
      if(titleEl)titleEl.textContent="Top Repositories \u2014 "+periodLabel;
    }
    charts.repos.update();
  }
  // Compute period sums from filtered trends
  var issuesOpened=0,issuesClosed=0,prsOpened=0;
  trends.forEach(function(t){
    issuesOpened+=(t.issuesOpened||0);
    issuesClosed+=(t.issuesClosed||0);
    prsOpened+=(t.prsOpened||0);
  });
  var prsMerged=(CHART_DATA.allPRDetails||[]).filter(function(p){return cutoff?new Date(p.mergedAt)>=cutoff:true;}).length;
  // Update doughnut charts
  if(charts.issues){
    if(period==="all"){
      charts.issues.data.labels=["Open","Closed"];
      charts.issues.data.datasets[0].data=[CHART_DATA.issues.open,CHART_DATA.issues.closed];
    }else{
      charts.issues.data.labels=["Opened","Closed"];
      charts.issues.data.datasets[0].data=[issuesOpened,issuesClosed];
    }
    charts.issues.update();
  }
  if(charts.prs){
    if(period==="all"){
      charts.prs.data.labels=["Open","Merged","Closed"];
      charts.prs.data.datasets[0].data=[CHART_DATA.prs.open,CHART_DATA.prs.merged,CHART_DATA.prs.closed];
      charts.prs.data.datasets[0].backgroundColor=[cssColors.accent,cssColors.ok,cssColors.muted];
    }else{
      charts.prs.data.labels=["Opened","Merged"];
      charts.prs.data.datasets[0].data=[prsOpened,prsMerged];
      charts.prs.data.datasets[0].backgroundColor=[cssColors.accent,cssColors.ok];
    }
    charts.prs.update();
  }
  // Update KPI numbers and labels
  var issueVal=document.getElementById("kpiIssueVal");
  var issueLbl=document.getElementById("kpiIssueLbl");
  var issueSub=document.getElementById("kpiIssueSub");
  var prVal=document.getElementById("kpiPRVal");
  var prLbl=document.getElementById("kpiPRLbl");
  var prSub=document.getElementById("kpiPRSub");
  if(period==="all"){
    if(issueVal)issueVal.textContent=String(CHART_DATA.issues.open);
    if(issueLbl)issueLbl.textContent="Open Issues";
    if(issueSub)issueSub.textContent=CHART_DATA.issues.closed+" closed";
    if(prVal)prVal.textContent=String(CHART_DATA.prs.merged);
    if(prLbl)prLbl.textContent="Merged PRs";
    if(prSub)prSub.textContent=CHART_DATA.prs.open+" open \u00B7 "+CHART_DATA.prs.closed+" closed";
  }else{
    if(issueVal)issueVal.textContent=String(issuesOpened);
    if(issueLbl)issueLbl.textContent="Issues Opened";
    if(issueSub)issueSub.textContent=issuesClosed+" closed";
    if(prVal)prVal.textContent=String(prsMerged);
    if(prLbl)prLbl.textContent="Merged PRs";
    if(prSub)prSub.textContent=prsOpened+" opened";
  }
  // Update the merged-PR column cells to reflect the selected period
  var repoCounts={};
  (CHART_DATA.allPRDetails||[]).forEach(function(p){
    if(!cutoff||new Date(p.mergedAt)>=cutoff){repoCounts[p.repo]=(repoCounts[p.repo]||0)+1;}
  });
  document.querySelectorAll(".repo-row[data-repo-name]").forEach(function(row){
    var cell=row.querySelector(".td-merged-prs");
    if(cell)cell.textContent=String(repoCounts[row.dataset.repoName]||0);
  });
  var note=document.getElementById("reposPeriodNote");
  if(note)note.style.display=period==="all"?"none":"";
}
function compareRows(a,b,by){
  if(by==="name")return a.dataset.name.localeCompare(b.dataset.name);
  if(by==="pushed"){var pa=a.dataset.pushed||"";var pb=b.dataset.pushed||"";return pb.localeCompare(pa);}
  return Number(b.dataset[by]||0)-Number(a.dataset[by]||0);
}
function setupControls(){
  var f=document.getElementById("repoFilter");
  var st=document.getElementById("repoSort");
  var list=document.getElementById("repoList");
  var sh=document.getElementById("shown");
  if(!f||!list)return;
  function filterAndSort(){
    var q=f.value.toLowerCase();var by=st?st.value:"name";
    var n=0;
    var tbody=list;
    var grpHdrRows=Array.from(tbody.querySelectorAll("tr.grp-hdr-row"));
    if(grpHdrRows.length>0){
      grpHdrRows.forEach(function(hdrRow){
        var grpId=hdrRow.dataset.grpId;
        var dataRows=Array.from(tbody.querySelectorAll("tr.repo-row[data-grp-id='"+grpId+"']"));
        dataRows.sort(function(a,b){return compareRows(a,b,by);});
        // Find next group header to use as insertion point
        var nextHdr=hdrRow.nextElementSibling;
        while(nextHdr&&!nextHdr.classList.contains("grp-hdr-row")){nextHdr=nextHdr.nextElementSibling;}
        // Remove rows from DOM then re-insert in sorted order before nextHdr
        dataRows.forEach(function(row){
          var dr=document.getElementById("detail-"+row.dataset.repoId);
          if(row.parentNode)row.parentNode.removeChild(row);
          if(dr&&dr.parentNode)dr.parentNode.removeChild(dr);
        });
        dataRows.forEach(function(row){
          var match=row.dataset.name.indexOf(q)!==-1;
          var grpHidden=!!row.dataset.grpHidden;
          row.style.display=(!match||grpHidden)?"none":"";
          if(match&&!grpHidden)n++;
          tbody.insertBefore(row,nextHdr||null);
          var dr=document.getElementById("detail-"+row.dataset.repoId);
          if(dr){
            if(!match||grpHidden)dr.style.display="none";
            else dr.style.display=dr.hidden?"none":"";
            tbody.insertBefore(dr,nextHdr||null);
          }
        });
      });
      // Hide group headers whose rows are all filtered out
      grpHdrRows.forEach(function(hdrRow){
        var grpId=hdrRow.dataset.grpId;
        var visible=Array.from(tbody.querySelectorAll("tr.repo-row[data-grp-id='"+grpId+"']"))
          .filter(function(r){return r.style.display!=="none";}).length;
        hdrRow.style.display=visible>0?"":"none";
      });
    }else{
      var allDataRows=Array.from(tbody.querySelectorAll("tr.repo-row"));
      allDataRows.sort(function(a,b){return compareRows(a,b,by);});
      allDataRows.forEach(function(row){
        var match=row.dataset.name.indexOf(q)!==-1;
        row.style.display=match?"":"none";
        if(match)n++;
        tbody.appendChild(row);
        var dr=document.getElementById("detail-"+row.dataset.repoId);
        if(dr){
          if(!match)dr.style.display="none";
          else dr.style.display=dr.hidden?"none":"";
          tbody.appendChild(dr);
        }
      });
    }
    if(sh)sh.textContent=String(n);
  }
  f.addEventListener("input",filterAndSort);
  if(st)st.addEventListener("change",filterAndSort);
}
function setupSortHeaders(){
  var st=document.getElementById("repoSort");
  document.querySelectorAll(".th-sortable").forEach(function(th){
    th.addEventListener("click",function(){
      var sortKey=th.dataset.sort;
      document.querySelectorAll(".th-sortable").forEach(function(h){
        h.classList.remove("sort-active");
        var ind=h.querySelector(".sort-ind");if(ind)ind.textContent="";
      });
      th.classList.add("sort-active");
      var ind=th.querySelector(".sort-ind");
      if(ind)ind.textContent=(sortKey==="name"||sortKey==="pushed")?"↑":"↓";
      if(st){st.value=sortKey;st.dispatchEvent(new Event("change"));}
    });
  });
}
function setupGroups(){
  var now=Date.now();
  var groupDefs=[
    {id:"grp-month",label:"Last Month",maxDays:30},
    {id:"grp-quarter",label:"Last Quarter",maxDays:90},
    {id:"grp-halfyear",label:"Last Half Year",maxDays:180},
    {id:"grp-older",label:"Older",maxDays:Infinity}
  ];
  var tbody=document.getElementById("repoList");
  if(!tbody)return;
  var dataRows=Array.from(tbody.querySelectorAll("tr.repo-row"));
  var allRows=Array.from(tbody.querySelectorAll("tr"));
  allRows.forEach(function(r){if(r.parentNode)r.parentNode.removeChild(r);});
  var groups={};
  groupDefs.forEach(function(g){groups[g.id]=[];});
  dataRows.forEach(function(row){
    var pushed=row.dataset.pushed;
    var days=pushed&&pushed.length>0?utcDaysSince(pushed,now):Infinity;
    var targetId=groupDefs[groupDefs.length-1].id;
    for(var i=0;i<groupDefs.length;i++){if(days<=groupDefs[i].maxDays){targetId=groupDefs[i].id;break;}}
    var ageBadge=row.querySelector(".bdg-age");
    if(ageBadge){var ageStr=computeAge(days);ageBadge.textContent=ageStr;ageBadge.style.display=ageStr?"":"none";}
    row.dataset.grpId=targetId;
    var dr=document.getElementById("detail-"+row.dataset.repoId);
    if(dr)dr.dataset.grpId=targetId;
    groups[targetId].push(row);
  });
  var firstOpened=false;
  groupDefs.forEach(function(g){
    var grpRows=groups[g.id];
    if(grpRows.length===0)return;
    var hdrTr=document.createElement("tr");
    hdrTr.className="grp-hdr-row";
    hdrTr.dataset.grpId=g.id;
    hdrTr.innerHTML='<td colspan="8" class="grp-hdr-cell"><span class="grp-chevron">&#9654;</span><span class="grp-label">'+g.label+'</span><span class="grp-count"> ('+grpRows.length+')</span></td>';
    hdrTr.addEventListener("click",function(){toggleGroup(g.id);});
    tbody.appendChild(hdrTr);
    grpRows.forEach(function(row){
      tbody.appendChild(row);
      var dr=document.getElementById("detail-"+row.dataset.repoId);
      if(dr)tbody.appendChild(dr);
    });
    if(!firstOpened){
      firstOpened=true;
      hdrTr.classList.add("expanded");
    }else{
      grpRows.forEach(function(row){
        row.style.display="none";row.dataset.grpHidden="1";
        var dr=document.getElementById("detail-"+row.dataset.repoId);
        if(dr){dr.style.display="none";dr.dataset.grpHidden="1";}
      });
    }
  });
}
function toggleGroup(grpId){
  var hdrRow=document.querySelector(".grp-hdr-row[data-grp-id='"+grpId+"']");
  if(!hdrRow)return;
  var expanded=hdrRow.classList.toggle("expanded");
  var tbody=document.getElementById("repoList");
  var dataRows=Array.from(tbody.querySelectorAll("tr.repo-row[data-grp-id='"+grpId+"']"));
  dataRows.forEach(function(row){
    if(expanded){
      delete row.dataset.grpHidden;
      row.style.display="";
    }else{
      row.dataset.grpHidden="1";
      row.style.display="none";
      var dr=document.getElementById("detail-"+row.dataset.repoId);
      if(dr){dr.style.display="none";dr.dataset.grpHidden="1";}
    }
  });
}
function utcDaysSince(isoDate,nowMs){
  var d=new Date(isoDate);
  var pushedMs=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  var nowDate=new Date(nowMs);
  var todayMs=Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth(),nowDate.getUTCDate());
  return Math.max(0,(todayMs-pushedMs)/86400000);
}
function computeAge(days){
  if(!isFinite(days))return "";
  if(days<1)return "today";
  days=Math.floor(days);
  if(days<7)return days+"d";
  var w=Math.floor(days/7);
  if(w<5)return w+"w";
  var m=Math.floor(days/30);
  if(m<12)return m+"mo";
  return Math.floor(days/365)+"y";
}
function toggleRepo(btn){
  var row=btn.closest("tr.repo-row");
  if(!row)return;
  var repoId=row.dataset.repoId;
  var dr=document.getElementById("detail-"+repoId);
  var exp=btn.getAttribute("aria-expanded")==="true";
  btn.setAttribute("aria-expanded",String(!exp));
  if(dr){dr.hidden=exp;dr.style.display=exp?"none":"";}
  row.classList.toggle("expanded");
}`;
}
main();
