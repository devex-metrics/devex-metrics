import type {
  PublicDiscoveryConnection,
  PublicDiscoveryRepoView,
  PublicDiscoveryRunStatus,
} from "../types.js";
import { escapeHtml } from "./utils.js";

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function signedDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function trend(points: number[]): string {
  const weeks = Array.from({ length: 13 }, (_, index) =>
    points.slice(index * 7, index === 12 ? 90 : index * 7 + 7).reduce((a, b) => a + b, 0)
  );
  const max = Math.max(1, ...weeks);
  const polyline = weeks
    .map((count, index) => `${index * 8},${24 - Math.round((count * 20) / max)}`)
    .join(" ");
  return `<svg class="discovery-trend" viewBox="0 0 96 28" role="img" aria-label="Commit activity across 13 weeks, ${weeks.map(String).join(", ")} commits by week"><polyline points="${polyline}" fill="none" stroke="currentColor" stroke-width="2" /></svg>`;
}

function unknown(reason: PublicDiscoveryRepoView["reason"]): string {
  switch (reason) {
    case "private":
      return "Private; not scanned";
    case "visibility_unknown":
      return "Visibility unverified; not scanned";
    case "cross_owner":
      return "Different owner; not scanned";
    case "empty":
      return "Empty repository; no HEAD";
    case "oversized":
      return "Over size limit; not scanned";
    case "size_unknown":
      return "Size unknown; not scanned";
    case "ranking_unknown":
      return "90-day PR history unavailable; not ranked";
    case "not_selected":
      return "Outside the ranked scan cap; not scanned";
    default:
      return "No successful scan; unknown";
  }
}

function row(view: PublicDiscoveryRepoView, index: number): string {
  const repo = `<th scope="row">${escapeHtml(view.fullName)}</th>`;
  if (view.status !== "observed" || !view.observation) {
    return `<tr${index >= 20 ? " hidden" : ""}>${repo}<td class="discovery-unknown">${unknown(view.reason)}</td><td>Unknown</td><td>Unknown</td><td>Unknown</td></tr>`;
  }
  const observed = view.observation;
  const languages = observed.languages.length
    ? observed.languages
        .map(
          (language) =>
            `${escapeHtml(language.name)} ${compact(language.loc)} LOC (${compact(language.files)} files)`
        )
        .join(" · ")
    : "No classified source language";
  const delta = view.delta
    ? `Compared with ${escapeHtml(view.delta.compared_at.slice(0, 10))}: ${signedDelta(view.delta.files)} files; ${signedDelta(view.delta.source_loc)} source LOC. Commit window counts are rolling, not cumulative (${signedDelta(view.delta.commits_90d)} difference).`
    : "First successful observation; no comparison yet.";
  return `<tr${index >= 20 ? " hidden" : ""}>${repo}
    <td>${compact(observed.files)} files · ${compact(observed.bytes)} bytes · ${compact(observed.source_loc)} LOC
      <details class="discovery-detail"><summary>Languages &amp; comparison</summary><p>${languages}</p><p>${delta}</p><p>Head ${escapeHtml(observed.head_sha.slice(0, 12))}</p></details></td>
    <td>${compact(observed.commits_30d)} / ${compact(observed.commits_90d)} ${trend(observed.commits_90d_trend)}<span class="discovery-authors">${compact(observed.contributor_count)} lifetime commit authors</span></td>
    <td>${compact(observed.adr_count)}</td>
    <td>${compact(observed.manifest_count)} manifests · ${compact(observed.produces_count)} produces · ${compact(observed.consumes_count)} consumes</td></tr>`;
}

/** An independent opt-in public inventory panel, always after the existing AI landscape. */
export function buildPublicDiscoverySection(
  rows: readonly PublicDiscoveryRepoView[],
  connections: readonly PublicDiscoveryConnection[],
  status?: PublicDiscoveryRunStatus
): string {
  const observed = rows.filter((view) => view.status === "observed").length;
  const asOf = status?.last_success_at;
  const stale =
    status && !status.ok
      ? `<div class="landscape-stale" role="status"><strong>Stale discovery:</strong> the scan attempted on <time datetime="${escapeHtml(status.attempted_at)}">${escapeHtml(status.attempted_at.slice(0, 16).replace("T", " "))} UTC</time> failed. ${asOf ? `Last successful observation: ${escapeHtml(asOf.slice(0, 16).replace("T", " "))} UTC.` : "There is no successful observation yet."}</div>`
      : "";
  const links = connections
    .map(
      (edge) =>
        `<li><strong>${escapeHtml(edge.source)}</strong> may consume an artifact from <strong>${escapeHtml(edge.target)}</strong> ` +
        `<span class="discovery-unknown">(heuristic, not a verified runtime dependency)</span><ul>${edge.evidence
          .map(
            (item) =>
              `<li>Consumer file ${escapeHtml(item.consumer_file)} · producer file ${escapeHtml(item.producer_file)}</li>`
          )
          .join("")}</ul></li>`
    )
    .join("");
  return `<section class="card discovery-section" id="public-discovery" aria-labelledby="discovery-heading">
    <div class="landscape-heading"><div><h2 id="discovery-heading">Public repository discovery</h2>
      <p class="metric-lede">Full-history facts at pinned public repository heads. Source LOC and ADR detection are estimates; commits are separate from DevEx PR/issue metrics and do not follow their filters.</p></div>
      <div class="landscape-actions"><span class="landscape-coverage">${observed} / ${rows.length} observed</span><a href="public-discovery.json">Sanitized JSON</a></div></div>
    ${stale}
    <p class="landscape-note">${asOf ? `As of <time datetime="${escapeHtml(asOf)}">${escapeHtml(asOf.slice(0, 16).replace("T", " "))} UTC</time>. ` : "No successful full-history scan yet. "}Unknown means not scanned, never zero. The 90-day activity trend counts commits on the observed branch, not pushes.</p>
    ${
      rows.length
        ? `<div class="landscape-table-wrap"><table class="landscape-table discovery-table" aria-label="Public repository inventory">
      <thead><tr><th scope="col">Repository</th><th scope="col">Inventory</th><th scope="col">Commits 30d / 90d</th><th scope="col">ADRs</th><th scope="col">Artifact evidence</th></tr></thead>
      <tbody id="discoveryRows">${rows.map(row).join("\n")}</tbody></table></div>
      <nav class="landscape-pagination" aria-label="Public discovery pages">
        <span id="discoveryRange" role="status" aria-live="polite">Showing 1–${Math.min(20, rows.length)} of ${rows.length} repositories</span>
        <span class="landscape-page-controls"><button type="button" id="discoveryPrev" aria-controls="discoveryRows" disabled>Previous</button>
          <span id="discoveryPage">Page 1 of ${Math.ceil(rows.length / 20)}</span>
          <button type="button" id="discoveryNext" aria-controls="discoveryRows"${rows.length <= 20 ? " disabled" : ""}>Next</button></span>
      </nav>`
        : `<p class="landscape-empty">No repositories selected for DevEx collection.</p>`
    }
    ${links ? `<div class="discovery-connections"><h3>Possible public connections</h3><p class="landscape-note">Manifest matches are heuristic; file evidence is from verified-public repositories only. Artifact identifiers are intentionally omitted.</p><ul>${links}</ul></div>` : ""}
  </section>`;
}

/** Dedicated pagination controls that do not affect the dashboard's other filters. */
export function getPublicDiscoveryControlsJS(): string {
  return `(function(){
    var body=document.getElementById("discoveryRows");
    if(!body)return;
    var rows=Array.from(body.rows),page=0,size=20,total=Math.ceil(rows.length/size);
    var prev=document.getElementById("discoveryPrev"),next=document.getElementById("discoveryNext");
    function render(){
      rows.forEach(function(row,index){row.hidden=index<page*size||index>=(page+1)*size;});
      prev.disabled=page===0;next.disabled=page>=total-1;
      document.getElementById("discoveryPage").textContent="Page "+(page+1)+" of "+total;
      document.getElementById("discoveryRange").textContent="Showing "+(page*size+1)+"–"+Math.min((page+1)*size,rows.length)+" of "+rows.length+" repositories";
    }
    prev.addEventListener("click",function(){if(page>0){page--;render();}});
    next.addEventListener("click",function(){if(page<total-1){page++;render();}});
    render();
  })();`;
}
