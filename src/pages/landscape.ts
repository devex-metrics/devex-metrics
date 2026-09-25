import type { LandscapeFile, LandscapeRepoView } from "../types.js";
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

function observedRow(row: LandscapeRepoView): string {
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
  return `<tr>
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

/** Render the opt-in landscape panel alongside the existing dashboard's metrics. */
export function buildLandscapeSection(rows: readonly LandscapeRepoView[]): string {
  const observed = rows.filter((row) => row.status === "observed").length;
  const content = rows.length
    ? `<div class="landscape-table-wrap"><table class="landscape-table" aria-label="AI instruction file observations by repository">
      <thead><tr><th scope="col">Repository</th><th scope="col">AI instruction files</th><th scope="col">File drift</th><th scope="col">Observed at</th><th scope="col">Detail</th></tr></thead>
      <tbody>${rows
        .map((row) =>
          row.status === "observed"
            ? observedRow(row)
            : `<tr><th scope="row">${escapeHtml(row.fullName)}</th><td colspan="4" class="landscape-unknown">${unknownLabel(row.reason)}${row.collectedAt ? ` (scan <time datetime="${escapeHtml(row.collectedAt)}">${escapeHtml(row.collectedAt.slice(0, 10))}</time>)` : ""}</td></tr>`
        )
        .join("\n")}</tbody>
    </table></div>`
    : `<p class="landscape-empty">No repositories are selected for DevEx collection; there is nothing to scan.</p>`;
  return `<section class="card landscape-section" id="ai-landscape" aria-labelledby="landscape-heading">
    <div class="landscape-heading"><div>
      <h2 id="landscape-heading">AI instruction landscape</h2>
      <p class="metric-lede">Observed files and content-hash drift at each repository head. Presence and age are not a readiness score or a correctness assessment; this snapshot does not follow the PR period or bot filters.</p>
    </div><div class="landscape-actions"><span class="landscape-coverage">${observed} / ${rows.length} observed</span><a href="landscape.json">Sanitized JSON</a></div></div>
    ${content}
  </section>`;
}
