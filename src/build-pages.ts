import * as fs from "node:fs";
import * as path from "node:path";
import { generateReport } from "./report.js";
import { CURRENT_SCHEMA_VERSION, fixturesEnabled } from "./cache.js";
import { loadConfig, applyScope } from "./config.js";
import { latestPath, loadRollup } from "./history.js";
import { loadCiRuns, toCiSamples } from "./ci-health.js";
import type { CacheEnvelope, OrgMetrics } from "./types.js";
import { buildDashboardHtml } from "./pages/dashboard.js";

/**
 * Build a static GitHub Pages site from collected metrics.
 *
 * Usage:
 *   node dist/build-pages.js [owner]
 *
 * Data is resolved in this order:
 *   1. The history store's newest snapshot — `<historyDir>/<owner>/latest.json`
 *      (what CI uses; written by the collector onto the metrics-data branch)
 *   2. The daily cache — `data/<owner>.json`
 *   3. A committed fixture — `data/<owner>.fixture.json`, only when
 *      DEVEX_USE_FIXTURE is set
 *
 * Writes:
 *   _site/index.html  – interactive dashboard
 *   _site/report.md   – Markdown report
 *   _site/data.json   – raw JSON API
 */

/** Where the data came from, for the log and the page footer. */
interface ResolvedData {
  data: OrgMetrics;
  date: string;
  origin: string;
}

function checkSchema(data: OrgMetrics | undefined, origin: string): void {
  if (data?.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    console.error(
      `${origin} has schema version ${data?.schemaVersion ?? "none"}, but this ` +
        `build expects version ${CURRENT_SCHEMA_VERSION}. Re-run data collection.`
    );
    process.exit(1);
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function resolveData(owner: string, historyDir: string): ResolvedData {
  const snapshot = latestPath(historyDir, owner);
  if (fs.existsSync(snapshot)) {
    const data = readJson<OrgMetrics>(snapshot);
    checkSchema(data, `History snapshot ${snapshot}`);
    return { data, date: data.collectedAt.slice(0, 10), origin: snapshot };
  }

  const dataDir = path.resolve(process.cwd(), "data");
  const cacheFile = path.join(dataDir, `${owner}.json`);
  if (fs.existsSync(cacheFile)) {
    const envelope = readJson<CacheEnvelope>(cacheFile);
    checkSchema(envelope.data, `Cache file ${cacheFile}`);
    return { data: envelope.data, date: envelope.date, origin: cacheFile };
  }

  const fixtureFile = path.join(dataDir, `${owner}.fixture.json`);
  if (fs.existsSync(fixtureFile)) {
    if (!fixturesEnabled()) {
      console.error(
        `No collected data for ${owner}. A fixture exists at ${fixtureFile}, but ` +
          `fixtures are opt-in — set DEVEX_USE_FIXTURE=1 to build from it.`
      );
      process.exit(1);
    }
    console.log(`Building from fixture at ${fixtureFile} (DEVEX_USE_FIXTURE is set)`);
    const data = readJson<OrgMetrics>(fixtureFile);
    checkSchema(data, `Fixture ${fixtureFile}`);
    return {
      data: { ...data, dataSource: "fixture" },
      date: data.collectedAt.slice(0, 10),
      origin: fixtureFile,
    };
  }

  console.error(
    `No data found for ${owner}. Looked in:\n` +
      `  ${snapshot}\n  ${cacheFile}\n  ${fixtureFile}\n` +
      `Run a collection first (node dist/index.js).`
  );
  process.exit(1);
}

function main(): void {
  const config = loadConfig();
  if (process.argv[2]) config.owner = process.argv[2];
  if (!config.owner) {
    console.error(
      "No owner configured. Pass one positionally or set the DEVEX_OWNER variable."
    );
    process.exit(1);
  }

  const historyDir = path.resolve(process.cwd(), config.history.dir);
  const resolved = resolveData(config.owner, historyDir);
  const { date, origin } = resolved;
  // Team membership and trial metadata come from the current configuration, so
  // re-scoping a trial only needs a site rebuild, not a re-collection.
  const data = applyScope(resolved.data, config);
  console.log(`Building site for ${config.owner} from ${origin}`);
  if (data.team) {
    console.log(`  team "${data.team.name}": ${data.team.repos.length} repo(s)`);
  }
  if (data.trial) console.log(`  trial: ${data.trial.title}`);

  // The rollup stream powers the trial view's baseline; an empty array is fine
  // on a first run, and the dashboard degrades to the snapshot-only view.
  const history = loadRollup(historyDir, config.owner);
  if (history.length > 0) {
    const days = new Set(history.map((r) => r.date)).size;
    console.log(`  ${history.length} history rows across ${days} day(s)`);
  } else {
    console.log(`  no history rows yet — trial view will show current data only`);
  }

  // CI health lives in its own append-only stream, crawled on its own budget,
  // so it is read here rather than through the collection cache. An empty
  // stream is the normal state until a deployment turns the crawl on.
  const ciWindowStart = new Date(
    Date.now() - config.collection.ciHealth.windowDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const ciSamples = toCiSamples(loadCiRuns(historyDir, config.owner)).filter(
    (s) => s.finishedAt >= ciWindowStart
  );
  if (ciSamples.length > 0) {
    console.log(
      `  ${ciSamples.length} CI run(s) in the last ${config.collection.ciHealth.windowDays} days`
    );
  }

  const siteDir = path.resolve(process.cwd(), "_site");
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, "report.md"), generateReport(data));
  fs.writeFileSync(path.join(siteDir, "data.json"), JSON.stringify(data, null, 2));

  const html = buildDashboardHtml(data, date, process.env.GITHUB_REF_NAME, buildRunUrl(), {
    branding: config.branding,
    history,
    ciSamples,
    ciWindowDays: config.collection.ciHealth.windowDays,
  });
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
