import * as fs from "node:fs";
import * as path from "node:path";
import { generateReport } from "./report.js";
import { CURRENT_SCHEMA_VERSION } from "./cache.js";
import type { CacheEnvelope, OrgMetrics } from "./types.js";
import { buildDashboardHtml } from "./pages/dashboard.js";

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
  const fixtureFile = path.join(dataDir, `${owner}.fixture.json`);
  const siteDir = path.resolve(process.cwd(), "_site");

  let envelope: CacheEnvelope;
  if (fs.existsSync(cacheFile)) {
    const raw = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as CacheEnvelope;
    if (raw.data?.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.error(
        `Cache file schema version ${raw.data?.schemaVersion ?? "none"} does not match ` +
        `current version ${CURRENT_SCHEMA_VERSION}. Please re-run data collection.`
      );
      process.exit(1);
    }
    envelope = raw;
  } else if (fs.existsSync(fixtureFile)) {
    console.log(`No daily cache found; falling back to fixture at ${fixtureFile}`);
    const data = JSON.parse(fs.readFileSync(fixtureFile, "utf-8")) as OrgMetrics;
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.error(
        `Fixture schema version ${data.schemaVersion ?? "none"} does not match ` +
        `current version ${CURRENT_SCHEMA_VERSION}. Fixture is stale — re-run collection to regenerate it.`
      );
      process.exit(1);
    }
    envelope = { date: data.collectedAt.slice(0, 10), data };
  } else {
    console.error(`No data found at ${cacheFile} or ${fixtureFile}`);
    process.exit(1);
  }
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