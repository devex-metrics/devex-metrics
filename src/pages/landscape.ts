import type { LandscapeFile, LandscapeRepoView, LandscapeRunStatus } from "../types.js";
import { escapeHtml } from "./utils.js";

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
  return `<tr>
    <td class="landscape-path">${escapeHtml(file.path)}</td>
    <td>${escapeHtml(file.kind)}</td>
    <td>${file.last_changed ? `<time datetime="${escapeHtml(file.last_changed)}">${escapeHtml(file.last_changed.slice(0, 10))}</time>` : "Unknown"}</td>
    <td>${age}</td><td>${lag}</td><td>${signal}</td><td>${change}</td>
  </tr>`;
}

function observedRow(row: LandscapeRepoView, attributes: string): string {
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
      <thead><tr><th scope="col">Path</th><th scope="col">Kind</th><th scope="col">Last changed</th><th scope="col">Age</th><th scope="col">Lag</th><th scope="col">Age signal</th><th scope="col">Drift</th></tr></thead>
      <tbody>${files.map((file) => fileRow(file, added, changed)).join("")}</tbody>
    </table></div>`
    : `<p class="landscape-note">No AI instruction files observed at this commit.</p>`;
  const removed = drift?.removed.length
    ? `<p class="landscape-note"><strong>Removed since comparison:</strong> ${drift.removed.map(escapeHtml).join(", ")}</p>`
    : "";
  const counts =
    `${summary.count} observed · ${summary.stale_count} older signals` +
    (summary.unknown_count ? ` · ${summary.unknown_count} unknown ages` : "");
  return `<tr${attributes}>
    <th scope="row">${escapeHtml(row.fullName)}</th>
    <td>${counts}</td>
    <td>${escapeHtml(driftLabel)}</td>
    <td><time datetime="${escapeHtml(row.collectedAt)}">${escapeHtml(row.collectedAt.slice(0, 10))}</time>
      <span class="landscape-hash" title="Observed head SHA">${escapeHtml(row.headSha.slice(0, 12))}</span></td>
    <td><details class="landscape-details"><summary aria-label="View AI instruction files for ${escapeHtml(row.fullName)}">View files</summary>
      <p class="landscape-note">Scanner ${escapeHtml(row.scannerVersion)} · head ${escapeHtml(row.headSha)}. Older file age is not evidence of incorrect instructions.</p>
      ${compared}${fileTable}${removed}
    </details></td>
  </tr>`;
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
  status?: LandscapeRunStatus
): string {
  const observed = rows.filter((row) => row.status === "observed").length;
  const content = rows.length
    ? `<div class="landscape-table-wrap"><table class="landscape-table" aria-label="AI instruction file observations by repository">
      <thead><tr>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="name" data-landscape-default="ascending" data-landscape-label="Repository">Repository <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="count" data-landscape-default="descending" data-landscape-label="AI instruction files">AI instruction files <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col" title="Total files added, changed and removed since the previous observation"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="changes" data-landscape-default="descending" data-landscape-label="File drift (total changes)">File drift <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="observed" data-landscape-default="descending" data-landscape-label="Observed at">Observed at <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
        <th scope="col"><button type="button" class="landscape-sort" aria-controls="landscapeRows" data-landscape-sort="detail" data-landscape-default="descending" data-landscape-label="Detail availability">Detail <span class="landscape-sort-ind" aria-hidden="true">↕</span></button></th>
      </tr></thead>
      <tbody id="landscapeRows">${rows
        .map((row, index) => {
          const known = row.status === "observed";
          const sortValues =
            ` data-landscape-index="${index}"` +
            ` data-landscape-count="${known ? row.summary?.count ?? "" : ""}"` +
            ` data-landscape-changes="${known && row.drift ? row.drift.added.length + row.drift.content_changed.length + row.drift.removed.length : ""}"` +
            ` data-landscape-observed="${escapeHtml(known ? row.collectedAt ?? "" : "")}" data-landscape-detail="${known ? 1 : 0}"` +
            (index >= 20 ? " hidden" : "");
          if (known) return observedRow(row, sortValues);
          return `<tr${sortValues}><th scope="row">${escapeHtml(row.fullName)}</th>` +
            `<td class="landscape-unknown">${unknownLabel(row.reason)}${row.collectedAt ? ` (scan attempted <time datetime="${escapeHtml(row.collectedAt)}">${escapeHtml(row.collectedAt.slice(0, 10))}</time>)` : ""}</td>` +
            `<td class="landscape-unknown">—</td>` +
            `<td class="landscape-unknown">—</td>` +
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
      <p class="metric-lede">Observed files and content-hash drift at each repository head. Presence and age are not a readiness score or a correctness assessment; this snapshot does not follow the PR period or bot filters.</p>
    </div><div class="landscape-actions"><span class="landscape-coverage">${observed} / ${rows.length} observed</span><a href="landscape.json">Sanitized JSON</a></div></div>
    ${staleNotice(status)}
    ${rows.length ? '<div class="landscape-sort-toolbar"><span id="landscapeSortStatus" aria-live="polite">Original order</span><button type="button" id="landscapeSortReset" aria-controls="landscapeRows" disabled>Clear sort</button></div>' : ""}
    ${content}
  </section>`;
}
