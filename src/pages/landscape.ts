import type { LandscapeFile, LandscapeRepoView, LandscapeRunStatus, OrgMetrics, RepoMetrics } from "../types.js";
import { escapeHtml } from "./utils.js";

interface TriageRow {
  view: LandscapeRepoView;
  activity: number | null;
  work: number | null;
  priority: number;
  attention: string;
  reason: string;
  oldestAge: number | null;
}

const DAY = 24 * 60 * 60 * 1000;

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = value.slice(0, 10);
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
    ? time : null;
}

function mergedPRs(repo: RepoMetrics | undefined, collectedAt: string): number | null {
  const end = timestamp(collectedAt);
  if (end === null || !Array.isArray(repo?.mergedPRTimeline)) return null;
  let count = 0;
  for (const pr of repo.mergedPRTimeline) {
    const merged = timestamp(pr?.mergedAt);
    if (merged === null) return null;
    if (merged >= end - 90 * DAY && merged <= end) count++;
  }
  return count;
}

function triage(view: LandscapeRepoView, activity: number | null): TriageRow {
  const summary = view.summary;
  const work = view.status === "observed" ? view.commits90d ?? activity : activity;
  const oldestAge = view.status === "observed"
    ? view.files?.reduce<number | null>((max, file) =>
        file.age_days === null ? max : Math.max(max ?? 0, file.age_days), null) ?? null
    : null;
  if (view.status !== "observed") {
    const restricted = view.reason === "private" || view.reason === "visibility_unknown";
    return { view, activity, work, oldestAge, priority: restricted ? 6 : 4,
      attention: restricted ? "Not assessed" : "Observation gap",
      reason: unknownLabel(view.reason) };
  }
  if (!summary) throw new Error("Observed landscape rows require summary and provenance");
  if (summary.count === 0) {
    return { view, activity, work, oldestAge, priority: work !== null && work > 0 ? 0 : 2,
      attention: work !== null && work > 0 ? "Review first" : "Review coverage",
      reason: "No AI instruction files observed" };
  }
  if (summary.stale_count > 0) {
    return { view, activity, work, oldestAge, priority: work !== null && work > 0 ? 1 : 3,
      attention: work !== null && work > 0 ? "Review first" : "Review age signal",
      reason: `${summary.stale_count} older file ${summary.stale_count === 1 ? "signal" : "signals"}` };
  }
  if (summary.unknown_count > 0) {
    return { view, activity, work, oldestAge, priority: 5, attention: "History unknown",
      reason: `${summary.unknown_count} file ${summary.unknown_count === 1 ? "history" : "histories"} unavailable` };
  }
  return { view, activity, work, oldestAge, priority: 7, attention: "No age flag",
    reason: "Age within threshold; inspect instruction cues separately" };
}

function compareTriage(a: TriageRow, b: TriageRow): number {
  return a.priority - b.priority ||
    (b.work ?? -1) - (a.work ?? -1) ||
    a.view.fullName.localeCompare(b.view.fullName, undefined, { numeric: true, sensitivity: "base" });
}

function unknownLabel(reason: LandscapeRepoView["reason"]): string {
  switch (reason) {
    case "private":
      return "Private repository; not scanned";
    case "visibility_unknown":
      return "Visibility unverified; not scanned";
    case "denied":
      return "Access denied; observation unknown";
    case "scan_error":
      return "Scan failed; observation unknown";
    default:
      return "No scan observation; status unknown";
  }
}

function fileRow(file: LandscapeFile, added: Set<string>, changed: Set<string>): string {
  const change = added.has(file.path)
    ? "Added"
    : changed.has(file.path)
      ? "Content changed"
      : "No hash change";
  const age = file.age_days === null ? "Unknown" : `${file.age_days} d`;
  const lag = file.lag_days === null ? "Unknown" : `${file.lag_days} d`;
  const signal = file.stale === null ? "Unknown" : file.stale ? "Older signal" : "Within threshold";
  const rubric = file.content_signal;
  const cues = rubric === null || rubric === undefined ? `<span class="landscape-unknown">Unknown</span>` :
    `${rubric.score}/100<span class="landscape-secondary">${([
      ["Scope", rubric.scope], ["Actions", rubric.actions],
      ["Checks", rubric.verification], ["Guardrails", rubric.guardrails],
    ] as const).filter(([, present]) => present).map(([name]) => name).join(" · ") || "No rubric cues found"}</span>`;
  return `<tr>
    <td class="landscape-path">${escapeHtml(file.path)}</td>
    <td>${escapeHtml(file.kind)}</td>
    <td>${file.last_changed ? `<time datetime="${escapeHtml(file.last_changed)}">${escapeHtml(file.last_changed.slice(0, 10))}</time>` : "Unknown"}</td>
    <td>${age}</td><td>${lag}</td><td>${signal}</td>
    <td>${countCell(file.commits_since_change)}</td><td>${cues}</td><td>${change}</td>
  </tr>`;
}

function countCell(value: number | null | undefined): string {
  return value == null ? `<span class="landscape-unknown">Unknown</span>` : String(value);
}

function windowCell(month: number | null | undefined, quarter: number | null | undefined): string {
  return `${countCell(month)} <span class="landscape-secondary">30d</span>` +
    `${countCell(quarter)} <span class="landscape-secondary">90d</span>`;
}

function observedRow(item: TriageRow, attributes: string, index: number): string {
  const row = item.view;
  const files = row.files ?? [];
  const summary = row.summary;
  if (!summary || !row.headSha || !row.collectedAt || !row.scannerVersion) {
    throw new Error("Observed landscape rows require summary and provenance");
  }
  const drift = row.drift;
  const added = new Set(drift?.added ?? []);
  const changed = new Set(drift?.content_changed ?? []);
  const driftLabel = drift
    ? `+${drift.added.length} added · ${drift.content_changed.length} changed · −${drift.removed.length} removed`
    : "First observation; no comparison yet";
  const compared = drift
    ? `<p class="landscape-note">Compared with <time datetime="${escapeHtml(drift.compared_at)}">${escapeHtml(drift.compared_at)}</time> at ${escapeHtml(drift.compared_head_sha.slice(0, 12))}.</p>`
    : "";
  const fileTable = files.length
    ? `<div class="landscape-file-scroll"><table class="landscape-file-table">
      <thead><tr><th scope="col">Path</th><th scope="col">Kind</th><th scope="col">Last changed</th><th scope="col">Age</th><th scope="col">Lag</th><th scope="col">Age signal</th><th scope="col">Commits since change</th><th scope="col">Quality cues</th><th scope="col">Drift</th></tr></thead>
      <tbody>${files.map((file) => fileRow(file, added, changed)).join("")}</tbody>
    </table></div>`
    : `<p class="landscape-note">No AI instruction files observed at this commit.</p>`;
  const removed = drift?.removed.length
    ? `<p class="landscape-note"><strong>Removed since comparison:</strong> ${drift.removed.map(escapeHtml).join(", ")}</p>`
    : "";
  const counts =
    `${summary.count} observed · ${summary.stale_count} older signals` +
    (summary.unknown_count ? ` · ${summary.unknown_count} unknown ages` : "");
  const age = summary.count === 0 ? "Not applicable" :
    item.oldestAge === null ? "Unknown age" : `Oldest ${item.oldestAge} d`;
  const lag = summary.count === 0 ? "No observed files" :
    summary.max_lag_days === null ? "Unknown lag" : `Lag up to ${summary.max_lag_days} d`;
  // The file table lives in its own full-width row; landscape-controls.js keeps it
  // attached to its repository row through sorting and pagination.
  const detailId = `landscape-detail-${index}`;
  return `<tr${attributes}>
    <td>${attentionCell(item)}</td>
    <th scope="row">${escapeHtml(row.fullName)}</th>
    <td class="landscape-activity">${activityCell(item.activity)}</td>
    <td class="landscape-activity">${windowCell(row.commits30d, row.commits90d)}</td>
    <td class="landscape-activity">${windowCell(row.teamCommits30d, row.teamCommits90d)}</td>
    <td>${counts}</td>
    <td class="landscape-activity">${row.qualityScore == null
      ? `<span class="landscape-unknown">Unknown</span>`
      : `${row.qualityScore}/100`}<span class="landscape-secondary">${row.qualityScored ?? 0} / ${files.length} files scored</span></td>
    <td>${age}<span class="landscape-secondary">${lag}</span></td>
    <td>${escapeHtml(driftLabel)}</td>
    <td><time datetime="${escapeHtml(row.collectedAt)}">${escapeHtml(row.collectedAt.slice(0, 10))}</time>
      <span class="landscape-hash" title="Observed head SHA">${escapeHtml(row.headSha.slice(0, 12))}</span></td>
    <td><button type="button" class="landscape-toggle" aria-expanded="false" aria-controls="${detailId}" aria-label="View AI instruction files for ${escapeHtml(row.fullName)}">View files</button></td>
  </tr>
  <tr class="landscape-detail-row" id="${detailId}" hidden><td colspan="11">
      <p class="landscape-note">Scanner ${escapeHtml(row.scannerVersion)} · head ${escapeHtml(row.headSha)}. Commits since change include the file's last-changed date. Quality cues award 25 points each for scope, actions, checks and guardrails in hash-verified content; they do not establish correctness. Older age is not evidence of incorrect instructions.</p>
      ${compared}${fileTable}${removed}
  </td></tr>`;
}

function attentionCell(item: TriageRow): string {
  const tone = item.priority <= 3 ? "review" : item.priority === 7 ? "clear" : "unknown";
  return `<span class="landscape-attention ${tone}">${escapeHtml(item.attention)}</span>` +
    `<span class="landscape-secondary">${escapeHtml(item.reason)}</span>`;
}

function activityCell(activity: number | null): string {
  return activity === null ? `<span class="landscape-unknown">Unknown</span>` :
    `${activity} <span class="landscape-secondary">observed</span>`;
}

function timeTag(iso: string): string {
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(iso.slice(0, 16).replace("T", " "))} UTC</time>`;
}

/** A prominent notice when the latest collection run failed and older data is shown. */
function staleNotice(status: LandscapeRunStatus | undefined): string {
  if (!status || status.ok) return "";
  const shown = status.last_success_at
    ? `The data below is from the last successful scan at ${timeTag(status.last_success_at)} and may be out of date.`
    : "There is no successful scan to show yet.";
  const run = status.run_url
    ? ` <a href="${escapeHtml(status.run_url)}">View the failed run</a>.`
    : "";
  return `<div class="landscape-stale" role="status"><strong>Stale data:</strong> the latest collection run at ${timeTag(status.attempted_at)} failed, so this landscape was not refreshed. ${shown}${run}</div>`;
}

/** Render the opt-in landscape panel after the dashboard's other metrics. */
export function buildLandscapeSection(
  rows: readonly LandscapeRepoView[],
  status?: LandscapeRunStatus,
  metrics?: Pick<OrgMetrics, "repos" | "collectedAt">
): string {
  const observed = rows.filter((row) => row.status === "observed").length;
  const repos = new Map(metrics?.repos.map((repo) => [repo.fullName.toLowerCase(), repo]) ?? []);
  const ranked = rows.map((row) =>
    triage(row, metrics ? mergedPRs(repos.get(row.fullName.toLowerCase()), metrics.collectedAt) : null)
  ).sort(compareTriage);
  const missing = ranked.filter((row) => row.view.status === "observed" && row.view.summary?.count === 0).length;
  const older = ranked.filter((row) => row.view.status === "observed" && (row.view.summary?.stale_count ?? 0) > 0).length;
  const unknown = ranked.filter((row) => row.view.status === "unknown").length;
  const historyUnknown = ranked.filter((row) => row.view.status === "observed" && (row.view.summary?.unknown_count ?? 0) > 0).length;
  const content = rows.length
    ? `<div class="landscape-table-wrap"><table class="landscape-table" aria-label="AI instruction file observations by repository">
      <thead><tr>
        <th scope="col" aria-sort="ascending"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="priority" data-landscape-default="ascending" data-landscape-label="Attention">Attention <span class="landscape-sort-ind" aria-hidden="true">↑</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="name" data-landscape-default="ascending" data-landscape-label="Repository">Repository <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="activity" data-landscape-default="descending" data-landscape-label="Observed merged PRs in 90 days">Merged PRs / 90d <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="commits90" data-landscape-default="descending" data-landscape-label="Git commits in 90 days">Git commits <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="team90" data-landscape-default="descending" data-landscape-label="Verified team Git commits in 90 days">Team commits <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="count" data-landscape-default="descending" data-landscape-label="AI instruction files">AI instruction files <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="quality" data-landscape-default="descending" data-landscape-label="AI instruction quality cues">Quality cues <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="age" data-landscape-default="descending" data-landscape-label="Oldest known file age">File age / lag <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col" title="Total files added, changed and removed since the previous observation"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="changes" data-landscape-default="descending" data-landscape-label="File drift (total changes)">File drift <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="observed" data-landscape-default="descending" data-landscape-label="Observed at">Observed at <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="detail" data-landscape-default="descending" data-landscape-label="Detail availability">Detail <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
      </tr></thead>
      <tbody id="landscapeRows">${ranked
        .map((item, index) => {
          const row = item.view;
          const known = row.status === "observed";
          const sortValues =
            ` data-landscape-index="${index}"` +
            ` data-landscape-priority="${item.priority}" data-landscape-activity="${item.activity ?? ""}"` +
            ` data-landscape-commits90="${known ? row.commits90d ?? "" : ""}"` +
            ` data-landscape-team90="${known ? row.teamCommits90d ?? "" : ""}"` +
            ` data-landscape-count="${known ? row.summary?.count ?? "" : ""}"` +
            ` data-landscape-quality="${known ? row.qualityScore ?? "" : ""}"` +
            ` data-landscape-age="${item.oldestAge ?? ""}"` +
            ` data-landscape-changes="${known && row.drift ? row.drift.added.length + row.drift.content_changed.length + row.drift.removed.length : ""}"` +
            ` data-landscape-observed="${escapeHtml(known ? row.collectedAt ?? "" : "")}" data-landscape-detail="${known ? 1 : 0}"` +
            (index >= 20 ? " hidden" : "");
          if (known) return observedRow(item, sortValues, index);
          return `<tr${sortValues}><td>${attentionCell(item)}</td><th scope="row">${escapeHtml(row.fullName)}</th>` +
            `<td class="landscape-activity">${activityCell(item.activity)}</td>` +
            `<td class="landscape-unknown">Unknown</td>` +
            `<td class="landscape-unknown">Unknown</td>` +
            `<td class="landscape-unknown">—</td>` +
            `<td class="landscape-unknown">Unknown</td>` +
            `<td class="landscape-unknown">—</td>` +
            `<td class="landscape-unknown">—</td>` +
            `<td class="landscape-unknown">${row.collectedAt ? `Scan attempted <time datetime="${escapeHtml(row.collectedAt)}">${escapeHtml(row.collectedAt.slice(0, 10))}</time>` : "—"}</td>` +
            `<td class="landscape-unknown">—</td></tr>`;
        })
        .join("\n")}</tbody>
    </table></div>
    <nav class="landscape-pagination" aria-label="AI instruction landscape pages">
      <span id="landscapeRange" role="status" aria-live="polite">Showing 1–${Math.min(20, rows.length)} of ${rows.length} repositories</span>
      <span class="landscape-page-controls">
        <button type="button" id="landscapePrev" aria-controls="landscapeRows" disabled>Previous</button>
        <span id="landscapePage">Page 1 of ${Math.ceil(rows.length / 20)}</span>
        <button type="button" id="landscapeNext" aria-controls="landscapeRows"${rows.length <= 20 ? " disabled" : ""}>Next</button>
      </span>
    </nav>`
    : `<p class="landscape-empty">No repositories are selected for DevEx collection; there is nothing to scan.</p>`;
  return `<section class="card landscape-section" id="ai-landscape" aria-labelledby="landscape-heading">
    <div class="landscape-heading"><div>
      <h2 id="landscape-heading">AI instruction landscape</h2>
      <p class="metric-lede">Review attention first: observed gaps and older file signals alongside Git commits, configured team activity and measurable instruction cues. Presence and age are maintenance signals; the rubric is not a correctness verdict.</p>
    </div><div class="landscape-actions"><span class="landscape-coverage">${observed} / ${rows.length} observed</span><a href="landscape.json">Sanitized JSON</a></div></div>
    ${staleNotice(status)}
    ${rows.length ? `<div class="landscape-triage" aria-label="Landscape overview">
      <div><strong>${missing}</strong><span>No files observed</span></div>
      <div><strong>${older}</strong><span>Older age signals</span></div>
      <div><strong>${historyUnknown}</strong><span>History incomplete</span></div>
      <div><strong>${unknown}</strong><span>Observation unknown</span></div>
    </div>
    <p class="landscape-context">Overview categories can overlap. Git commits (30d / 90d) come from pinned-head history ending at the AI scan time; team counts need a complete linked-author history and an explicit GitHub-handle roster. Triage prefers Git activity, falling back to observed merged PRs / 90d at the DevEx collection time when Git history is unknown. The PR timeline can be incomplete. Quality cues score observable content, not correctness. Unknown never means zero; this view ignores dashboard PR period and bot filters.</p>
    <div class="landscape-sort-toolbar"><span id="landscapeSortStatus" aria-live="polite">Attention first</span><button type="button" id="landscapeSortReset" aria-controls="landscapeRows" disabled>Restore attention order</button></div>` : ""}
    ${content}
  </section>`;
}
