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

  const repoCards = data.repos.map((repo) => buildRepoCard(repo)).join("\n");

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
  <h1>DevEx Metrics</h1>
  <p class="subtitle">${escapeHtml(data.owner)} &middot; ${escapeHtml(data.ownerType)} &middot; collected ${escapeHtml(data.collectedAt)}</p>
</header>

<main>
  <section class="kpis" aria-label="Key metrics">
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F4E6;</div>
      <div class="kpi-val">${data.repoCount}</div>
      <div class="kpi-lbl">Repositories</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x26A0;&#xFE0F;</div>
      <div class="kpi-val">${totals.openIssues}</div>
      <div class="kpi-lbl">Open Issues</div>
      <div class="kpi-sub">${totals.closedIssues} closed</div>
    </div>
    <div class="kpi">
      <div class="kpi-icon" aria-hidden="true">&#x1F500;</div>
      <div class="kpi-val">${totals.mergedPRs}</div>
      <div class="kpi-lbl">Merged PRs</div>
      <div class="kpi-sub">${totals.openPRs} open &middot; ${totals.closedPRs} closed</div>
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
    <div class="card card-chart card-wide"><h2>Top Repositories</h2><canvas id="chartRepos"></canvas></div>
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
          <option value="issues">Issues</option>
          <option value="prs">PRs</option>
          <option value="contributors">Contributors</option>
        </select>
      </div>
    </div>
    <div id="repoList" class="repo-list">${repoCards}</div>
    <p class="repo-count"><span id="shown">${data.repos.length}</span> of ${data.repos.length} repositories</p>
  </section>
</main>

<footer>Data cached on ${escapeHtml(date)}.${deployedFrom} Served via GitHub Pages. <a href="data.json">Raw JSON</a> &middot; <a href="report.md">Markdown</a></footer>

<script>
var CHART_DATA=${chartPayload};
${getJS()}
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Repo card builder                                                 */
/* ------------------------------------------------------------------ */

function buildRepoCard(repo: RepoMetrics): string {
  const prRows = repo.pullRequestDetails
    .map(
      (pr) =>
        `<tr><td>#${pr.number} ${escapeHtml(pr.title)}</td>` +
        `<td><span class="add">+${pr.linesAdded}</span> <span class="del">-${pr.linesDeleted}</span></td>` +
        `<td>${pr.commentCount}</td><td>${pr.commitCount}</td><td>${pr.actionsMinutes}</td></tr>`,
    )
    .join("");

  const prTable =
    repo.pullRequestDetails.length > 0
      ? `<div class="pr-wrap"><h4>Recent Pull Requests</h4>
      <table class="pr-tbl"><thead><tr><th>PR</th><th>Lines</th><th>Comments</th><th>Commits</th><th>CI&nbsp;min</th></tr></thead>
      <tbody>${prRows}</tbody></table></div>`
      : "";

  const totalIssues = repo.issues.open + repo.issues.closed;
  const totalPRs =
    repo.pullRequests.open +
    repo.pullRequests.merged +
    repo.pullRequests.closed;
  const totalContrib = repo.committerCount + repo.reviewerCount;

  return `<div class="repo-card" data-name="${escapeHtml(repo.fullName.toLowerCase())}" data-issues="${totalIssues}" data-prs="${totalPRs}" data-contributors="${totalContrib}">
  <button class="repo-hdr" aria-expanded="false" aria-label="Toggle details for ${escapeHtml(repo.fullName)}" onclick="toggleRepo(this)">
    <span class="repo-title"><span class="chev" aria-hidden="true">&rsaquo;</span><span class="rname">${escapeHtml(repo.fullName)}</span></span>
    <span class="repo-badges">
      <span class="bdg bdg-issue">${repo.issues.open} open</span>
      <span class="bdg bdg-pr">${repo.pullRequests.merged} merged</span>
      <span class="bdg bdg-ctr">${totalContrib} contrib</span>${repo.dependentCount > 0 ? `<span class="bdg bdg-dep">${repo.dependentCount} dep</span>` : ""}
    </span>
  </button>
  <div class="repo-body" hidden>
    <div class="stats-grid">
      <div class="sg"><h4>Issues</h4><dl><div class="dr"><dt>Open</dt><dd>${repo.issues.open}</dd></div><div class="dr"><dt>Closed</dt><dd>${repo.issues.closed}</dd></div></dl></div>
      <div class="sg"><h4>Pull Requests</h4><dl><div class="dr"><dt>Open</dt><dd>${repo.pullRequests.open}</dd></div><div class="dr"><dt>Merged</dt><dd>${repo.pullRequests.merged}</dd></div><div class="dr"><dt>Closed</dt><dd>${repo.pullRequests.closed}</dd></div></dl></div>
      <div class="sg"><h4>People (90 d)</h4><dl><div class="dr"><dt>Committers</dt><dd>${repo.committerCount}</dd></div><div class="dr"><dt>Reviewers</dt><dd>${repo.reviewerCount}</dd></div></dl></div>
      <div class="sg"><h4>Dependents</h4><dl><div class="dr"><dt>Repos</dt><dd>${repo.dependentCount}</dd></div></dl></div>
    </div>
    ${prTable}
  </div>
</div>`;
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
main{max-width:1120px;margin:0 auto;padding:0 1rem 2rem}
a{color:var(--accent)}
.hero{background:linear-gradient(135deg,#0969da 0%,#8250df 100%);color:#fff;
  padding:2.5rem 2rem;text-align:center;margin-bottom:2rem}
@media(prefers-color-scheme:dark){.hero{background:linear-gradient(135deg,#1158a7 0%,#6639ba 100%)}}
.hero h1{font-size:1.8rem;font-weight:700;margin-bottom:.35rem}
.subtitle{opacity:.88;font-size:.95rem}
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
.repo-card{background:var(--card);border-radius:var(--rs);margin-bottom:.5rem;
  box-shadow:var(--sh);overflow:hidden}
.repo-hdr{display:flex;width:100%;align-items:center;gap:.5rem;padding:.7rem 1rem;
  border:none;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left;transition:background .15s}
.repo-hdr:hover{background:var(--accent-s)}
.repo-title{display:flex;align-items:center;gap:.4rem;flex:1;min-width:0}
.chev{display:inline-block;font-size:1.1rem;font-weight:700;transition:transform .2s;
  color:var(--muted);width:1rem;text-align:center}
.repo-card.expanded .chev{transform:rotate(90deg)}
.rname{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.repo-badges{display:flex;flex-wrap:wrap;gap:.35rem}
.bdg{font-size:.7rem;padding:.15rem .5rem;border-radius:999px;font-weight:500;white-space:nowrap}
.bdg-issue{background:var(--warn-s);color:var(--warn)}
.bdg-pr{background:var(--ok-s);color:var(--ok)}
.bdg-ctr{background:var(--accent-s);color:var(--accent)}
.bdg-dep{background:var(--err-s);color:var(--err)}
.repo-body{padding:1rem;border-top:1px solid var(--border)}
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
footer{max-width:1120px;margin:0 auto;padding:1rem;text-align:center;font-size:.8rem;
  color:var(--muted);border-top:1px solid var(--border)}
@media(max-width:640px){
  .charts{grid-template-columns:1fr}
  .hero{padding:1.5rem 1rem}.hero h1{font-size:1.4rem}
  .repo-hdr{flex-direction:column;align-items:flex-start}
  .repo-badges{margin-top:.3rem}
  .toolbar-ctrls{flex-direction:column;width:100%}
  #repoFilter{width:100%}
}`;
}

/* ------------------------------------------------------------------ */
/*  Embedded JavaScript                                               */
/* ------------------------------------------------------------------ */

function getJS(): string {
  return `
document.addEventListener("DOMContentLoaded",function(){
  if(typeof Chart!=="undefined"){renderCharts();}
  setupControls();
});
function renderCharts(){
  var computedStyle=getComputedStyle(document.documentElement);
  var cssVar=function(v){return computedStyle.getPropertyValue(v).trim();};
  Chart.defaults.color=cssVar("--muted");
  Chart.defaults.plugins.legend.labels.usePointStyle=true;
  Chart.defaults.plugins.legend.labels.padding=16;
  var dOpts={cutout:"62%",plugins:{legend:{position:"bottom"}},responsive:true,maintainAspectRatio:true};
  new Chart(document.getElementById("chartIssues"),{type:"doughnut",
    data:{labels:["Open","Closed"],datasets:[{data:[CHART_DATA.issues.open,CHART_DATA.issues.closed],
      backgroundColor:[cssVar("--warn"),cssVar("--ok")],borderWidth:0,hoverOffset:6}]},options:dOpts});
  new Chart(document.getElementById("chartPRs"),{type:"doughnut",
    data:{labels:["Open","Merged","Closed"],datasets:[{data:[CHART_DATA.prs.open,CHART_DATA.prs.merged,CHART_DATA.prs.closed],
      backgroundColor:[cssVar("--accent"),cssVar("--ok"),cssVar("--muted")],borderWidth:0,hoverOffset:6}]},options:dOpts});
  if(CHART_DATA.topRepos.length>0){
    new Chart(document.getElementById("chartRepos"),{type:"bar",
      data:{labels:CHART_DATA.topRepos.map(function(r){return r.name;}),
        datasets:[{label:"Issues",data:CHART_DATA.topRepos.map(function(r){return r.issues;}),backgroundColor:cssVar("--warn"),borderRadius:3},
          {label:"Pull Requests",data:CHART_DATA.topRepos.map(function(r){return r.prs;}),backgroundColor:cssVar("--accent"),borderRadius:3}]},
      options:{indexAxis:"y",responsive:true,
        scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{display:false}}},
        plugins:{legend:{position:"top",align:"end"}}}});
  }
  if(CHART_DATA.weeklyTrends&&CHART_DATA.weeklyTrends.length>0){
    var tLabels=CHART_DATA.weeklyTrends.map(function(t){return t.week;});
    var lineOpts={responsive:true,maintainAspectRatio:true,
      scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:cssVar("--border")}}},
      plugins:{legend:{position:"top",align:"end"}}};
    new Chart(document.getElementById("chartPRTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Opened",data:CHART_DATA.weeklyTrends.map(function(t){return t.prsOpened;}),
          borderColor:cssVar("--accent"),backgroundColor:cssVar("--accent-s"),tension:0.3,fill:true,pointRadius:3},
        {label:"Merged",data:CHART_DATA.weeklyTrends.map(function(t){return t.prsMerged;}),
          borderColor:cssVar("--ok"),backgroundColor:cssVar("--ok-s"),tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
    new Chart(document.getElementById("chartIssueTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Opened",data:CHART_DATA.weeklyTrends.map(function(t){return t.issuesOpened;}),
          borderColor:cssVar("--warn"),backgroundColor:cssVar("--warn-s"),tension:0.3,fill:true,pointRadius:3},
        {label:"Closed",data:CHART_DATA.weeklyTrends.map(function(t){return t.issuesClosed;}),
          borderColor:cssVar("--ok"),backgroundColor:cssVar("--ok-s"),tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
    new Chart(document.getElementById("chartPRSizeTrends"),{type:"line",
      data:{labels:tLabels,datasets:[
        {label:"Lines Added",data:CHART_DATA.weeklyTrends.map(function(t){return t.linesAdded;}),
          borderColor:cssVar("--ok"),backgroundColor:cssVar("--ok-s"),tension:0.3,fill:true,pointRadius:3},
        {label:"Lines Removed",data:CHART_DATA.weeklyTrends.map(function(t){return t.linesDeleted;}),
          borderColor:cssVar("--err"),backgroundColor:cssVar("--err-s"),tension:0.3,fill:true,pointRadius:3}]},
      options:lineOpts});
  }
}
function setupControls(){
  var f=document.getElementById("repoFilter");
  var st=document.getElementById("repoSort");
  var list=document.getElementById("repoList");
  var sh=document.getElementById("shown");
  if(!f||!list)return;
  function filterAndSort(){
    var q=f.value.toLowerCase();var by=st.value;
    var cards=Array.from(list.querySelectorAll(".repo-card"));
    cards.sort(function(a,b){
      if(by==="name")return a.dataset.name.localeCompare(b.dataset.name);
      return Number(b.dataset[by])-Number(a.dataset[by]);
    });
    var n=0;
    for(var i=0;i<cards.length;i++){
      var match=cards[i].dataset.name.indexOf(q)!==-1;
      cards[i].style.display=match?"":"none";
      if(match)n++;
      list.appendChild(cards[i]);
    }
    if(sh)sh.textContent=String(n);
  }
  f.addEventListener("input",filterAndSort);
  st.addEventListener("change",filterAndSort);
}
function toggleRepo(btn){
  var card=btn.closest(".repo-card");
  var body=card.querySelector(".repo-body");
  var exp=btn.getAttribute("aria-expanded")==="true";
  btn.setAttribute("aria-expanded",String(!exp));
  body.hidden=exp;
  card.classList.toggle("expanded");
}`;
}

main();
