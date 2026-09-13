import * as fs from "node:fs";
import * as path from "node:path";
import { listDatasetKeys, loadRawCache } from "./cache.js";
import { generateReport } from "./report.js";
import { buildDashboardHtml } from "./pages/dashboard.js";
import type { DatasetNavEntry } from "./pages/dashboard.js";
import type { OrgMetrics } from "./types.js";

interface Dataset {
  key: string;
  label: string;
  data: OrgMetrics;
}

/**
 * Build a local, multi-dataset GitHub Pages-style site from every cached
 * dataset found in `data/` — both regular owner/user datasets and local
 * "group" datasets collected via `collect-group` from an explicit list of
 * repos (e.g. discovered from a local folder).
 *
 * Each dataset gets its own dashboard page at `_site/<key>/index.html`, and
 * every page includes a dataset switcher (in the header) linking to all
 * other discovered datasets. The site root `_site/index.html` mirrors one
 * "primary" dataset so the site also works when opened directly.
 *
 * This is intended for local use only — it is not wired into the CI
 * workflow, which continues to build a single dataset via `build-pages.ts`.
 *
 * Usage:
 *   node dist/build-multi-site.js [primaryDatasetKey]
 */
function main(): void {
  const siteDir = path.resolve(process.cwd(), "_site");
  const primaryArg = process.argv[2];

  const datasets: Dataset[] = [];
  for (const key of listDatasetKeys()) {
    const data = loadRawCache(key);
    if (!data) {
      console.warn(`Skipping "${key}": no valid cached data found (missing or stale schema).`);
      continue;
    }
    datasets.push({ key, label: data.groupName ?? data.owner, data });
  }

  if (datasets.length === 0) {
    console.error("No local datasets found in data/. Run a collection first (e.g. npm start, or collect-group).");
    process.exit(1);
  }

  datasets.sort((a, b) => a.label.localeCompare(b.label));

  const primary = datasets.find((d) => d.key === primaryArg) ?? datasets[0];

  const branch = process.env.GITHUB_REF_NAME;
  const runUrl = buildRunUrl();

  fs.mkdirSync(siteDir, { recursive: true });

  for (const ds of datasets) {
    const folder = path.join(siteDir, ds.key);
    fs.mkdirSync(folder, { recursive: true });
    const nav: DatasetNavEntry[] = datasets.map((d) => ({
      label: d.label,
      href: d.key === ds.key ? "index.html" : `../${d.key}/index.html`,
      current: d.key === ds.key,
    }));
    writeDatasetPage(folder, ds, branch, runUrl, nav);
  }

  // Mirror the primary dataset at the site root so the multi-dataset site
  // also works when `_site/index.html` is opened directly.
  const rootNav: DatasetNavEntry[] = datasets.map((d) => ({
    label: d.label,
    href: d.key === primary.key ? "index.html" : `${d.key}/index.html`,
    current: d.key === primary.key,
  }));
  writeDatasetPage(siteDir, primary, branch, runUrl, rootNav);

  fs.writeFileSync(
    path.join(siteDir, "manifest.json"),
    JSON.stringify(
      datasets.map((d) => ({
        key: d.key,
        label: d.label,
        ownerType: d.data.ownerType,
        repoCount: d.data.repoCount,
        collectedAt: d.data.collectedAt,
      })),
      null,
      2
    )
  );

  console.log(`Built ${datasets.length} dataset page(s) in ${siteDir}/`);
  console.log(`Datasets: ${datasets.map((d) => `${d.label} (${d.key})`).join(", ")}`);
  console.log(`Primary (site root) dataset: ${primary.label}`);
}

function writeDatasetPage(
  folder: string,
  ds: Dataset,
  branch: string | undefined,
  runUrl: string | undefined,
  nav: DatasetNavEntry[]
): void {
  const markdown = generateReport(ds.data);
  fs.writeFileSync(path.join(folder, "report.md"), markdown);
  fs.writeFileSync(path.join(folder, "data.json"), JSON.stringify(ds.data, null, 2));
  const html = buildDashboardHtml(
    ds.data,
    ds.data.collectedAt.slice(0, 10),
    branch,
    runUrl,
    { datasets: nav }
  );
  fs.writeFileSync(path.join(folder, "index.html"), html);
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

main();
