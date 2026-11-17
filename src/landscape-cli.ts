import * as fs from "node:fs";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { loadConfig, assertUsable } from "./config.js";
import type { OrgMetrics } from "./types.js";
import {
  installedLandscapeScannerVersion,
  loadLandscapeSelection,
  landscapeSelection,
  saveLandscapeRunStatus,
  saveLandscapeScan,
  scrubLandscapeOutsideSelection,
  scrubLandscapeRepositories,
  unverifiedLandscapeRepositories,
  validateLandscapeScannerOutput,
} from "./landscape.js";
import { enrichLandscapeScan } from "./landscape-signals.js";
import {
  assertLandscapePublication, hasPrivateLandscapeData, markPrivateLandscapeStore,
} from "./landscape-policy.js";

async function prepare(): Promise<void> {
  const config = loadConfig();
  const historyDir = path.resolve(config.history.dir);
  const includePrivate = config.collection.landscapeIncludePrivate;
  await assertLandscapePublication(historyDir, includePrivate);
  const enabled = config.collection.features.landscape;
  if (!enabled) {
    writeOutput("landscape-enabled", "false");
    writeOutput("landscape-scan-needed", "false");
    return;
  }
  assertUsable(config);
  if (!config.history.enabled) {
    throw new Error("Landscape collection requires the DevEx history store");
  }
  const metrics = loadLandscapeSelection(historyDir, config.owner);
  const scrubbed = scrubLandscapeOutsideSelection(historyDir, metrics, includePrivate);
  if (scrubbed > 0) {
    console.log(
      `Removed ${scrubbed} stored landscape observations outside the allowed selection`
    );
  }
  const selected = landscapeSelection(metrics, includePrivate);
  // Live sources can change visibility after the metrics snapshot was collected.
  if (includePrivate && selected.length > 0) markPrivateLandscapeStore(historyDir);
  const repositories = selected
    .map((repo) => repo.fullName)
    .sort((a, b) => a.localeCompare(b));

  const file = path.resolve("data", "landscape.config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        schema_version: 1,
        repositories,
        stale_after_days: config.collection.landscapeStaleAfterDays,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `Landscape selection: ${repositories.length} policy-verified repositories in ${config.owner} ` +
      `of ${metrics.repos.length} DevEx-selected (private scanning ${includePrivate ? "enabled" : "disabled"}; other owners and unknown visibility excluded)`
  );
  if (repositories.length === 0) {
    saveLandscapeRunStatus(historyDir, metrics.owner, {
      attempted_at: new Date().toISOString(),
      ok: true,
    });
  }
  writeOutput("landscape-enabled", "true");
  writeOutput("landscape-scan-needed", String(repositories.length > 0));
  if (repositories.length > 0) {
    writeOutput("landscape-owner", metrics.owner);
    writeOutput("landscape-repositories", repositories.map((repo) => repo.split("/")[1]).join(","));
  }
}

function scanToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Landscape ingestion requires a selected-repositories Contents-read GITHUB_TOKEN"
    );
  }
  return token;
}

/**
 * Re-check visibility and scrub any repository that is no longer verified
 * allowed by policy. On a failed run the workflow still publishes the scrubbed store and
 * rebuilds Pages (see markFailed), so stale paths are not left online.
 * Returns the unverified repositories.
 */
async function recheckAndScrub(
  historyDir: string,
  owner: string,
  names: readonly string[],
  token: string,
  includePrivate: boolean
): Promise<string[]> {
  const unverified = await unverifiedLandscapeRepositories(
    names, new Octokit({ auth: token, request: { timeout: 20_000 } }), includePrivate
  );
  if (unverified.length > 0) {
    const removed = scrubLandscapeRepositories(historyDir, owner, unverified);
    console.error(
      `${unverified.length} landscape repositories are no longer verified under the visibility policy ` +
        `(removed ${removed} previously stored observations)`
    );
  }
  return unverified;
}

function loadEnabled(): {
  config: ReturnType<typeof loadConfig>;
  historyDir: string;
  metrics: OrgMetrics;
} {
  const config = loadConfig();
  if (!config.collection.features.landscape || !config.history.enabled) {
    throw new Error("Landscape ingestion requires an enabled feature and history store");
  }
  assertUsable(config);
  const historyDir = path.resolve(config.history.dir);
  return { config, historyDir, metrics: loadLandscapeSelection(historyDir, config.owner) };
}

async function ingest(file: string | undefined): Promise<void> {
  if (!file) throw new Error("Usage: landscape-cli ingest <raw-scan.json>");
  const { config, historyDir, metrics } = loadEnabled();
  const includePrivate = config.collection.landscapeIncludePrivate;
  await assertLandscapePublication(historyDir, includePrivate);
  const token = scanToken();
  // Re-check the whole prepared selection before reading the scanner output,
  // so neither a partial nor a malformed output can skip the scrub. Validation
  // below rejects any repository outside that selection.
  const names = landscapeSelection(metrics, includePrivate).map((repo) => repo.fullName);
  const unverified = await recheckAndScrub(historyDir, metrics.owner, names, token, includePrivate);
  if (unverified.length > 0) {
    throw new Error(
      "Landscape repositories are no longer verified under the visibility policy; refusing to persist paths"
    );
  }
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as unknown;
  const validated = validateLandscapeScannerOutput(
    raw,
    metrics,
    config.collection.landscapeStaleAfterDays,
    installedLandscapeScannerVersion(),
    includePrivate
  );
  const enriched = await enrichLandscapeScan(
    validated, new Octokit({ auth: token, request: { timeout: 20_000 } }),
    config.team?.handles ?? [], config.collection.landscapeStaleAfterDays, includePrivate
  );
  if ((await recheckAndScrub(historyDir, metrics.owner, names, token, includePrivate)).length > 0)
    throw new Error("Landscape visibility changed during enrichment; refusing to persist paths");
  await assertLandscapePublication(historyDir, includePrivate);
  const scan = saveLandscapeScan(historyDir, metrics, raw, enriched, includePrivate);
  saveLandscapeRunStatus(historyDir, metrics.owner, {
    attempted_at: new Date().toISOString(),
    ok: true,
    ...runUrl(),
  });
  console.log(
    `Stored sanitized landscape v1 scan (${scan.repositories.length} policy-selected repositories)`
  );
}

/** After a failed scan, scrub any selected repository that is no longer allowed by policy. */
async function recheck(): Promise<void> {
  const { config, historyDir, metrics } = loadEnabled();
  const includePrivate = config.collection.landscapeIncludePrivate;
  await assertLandscapePublication(historyDir, includePrivate);
  const token = scanToken();
  const names = landscapeSelection(metrics, includePrivate).map((repo) => repo.fullName);
  const unverified = await recheckAndScrub(historyDir, metrics.owner, names, token, includePrivate);
  if (unverified.length === 0) {
    console.log(`All ${names.length} selected landscape repositories are still allowed by policy`);
  }
}

/**
 * Run as the last step of a failed collection. Keeps the last good landscape
 * data, scrubs repositories outside the current allowed selection, records the
 * failure so the dashboard marks the data as stale, and asks the workflow to
 * publish the store and rebuild Pages before the run reports its failure.
 */
async function markFailed(): Promise<void> {
  const settings = failureSettings();
  if (!settings) return;
  const { owner, historyDir, includePrivate } = settings;
  await assertLandscapePublication(historyDir, includePrivate);
  try {
    const metrics = loadLandscapeSelection(historyDir, owner);
    const removed = scrubLandscapeOutsideSelection(historyDir, metrics, includePrivate);
    if (removed > 0) {
      console.log(`Removed ${removed} stored landscape observations outside the allowed selection`);
    }
  } catch (err: unknown) {
    console.warn("Could not re-scrub the landscape store against the DevEx selection:", err);
  }
  saveLandscapeRunStatus(historyDir, owner, {
    attempted_at: new Date().toISOString(),
    ok: false,
    ...runUrl(),
  });
  console.log("Recorded a failed landscape run; the dashboard will mark its data as stale");
  writeOutput("landscape-publish", "true");
}

/**
 * The owner and history dir for markFailed, or undefined when landscape is off.
 * An invalid configuration may be why the run failed, so on a loadConfig error
 * fall back to reading just these settings, without validation, from the same
 * sources in the same order: config file, DEVEX_CONFIG, then discrete variables.
 */
function failureSettings(): { owner: string; historyDir: string; includePrivate: boolean } | undefined {
  let settings: MinimalSettings;
  try {
    const config = loadConfig();
    settings = {
      owner: config.owner,
      historyEnabled: config.history.enabled,
      historyDir: config.history.dir,
      landscape: config.collection.features.landscape,
      includePrivate: config.collection.landscapeIncludePrivate,
    };
  } catch (err: unknown) {
    console.warn("Configuration is invalid; recording the failure from its raw sources:", err);
    settings = minimalSettings();
  }
  return settings.landscape && settings.historyEnabled && settings.owner
    ? { owner: settings.owner, historyDir: path.resolve(settings.historyDir), includePrivate: settings.includePrivate }
    : undefined;
}

interface MinimalSettings {
  owner: string;
  historyEnabled: boolean;
  historyDir: string;
  landscape: boolean;
  includePrivate: boolean;
}

function minimalSettings(): MinimalSettings {
  const settings: MinimalSettings = {
    owner: "",
    historyEnabled: true,
    historyDir: "data/history",
    landscape: false,
    includePrivate: false,
  };
  const file = process.env.DEVEX_CONFIG_FILE?.trim() || "devex.config.json";
  for (const text of [readIfPresent(path.resolve(file)), process.env.DEVEX_CONFIG]) {
    const raw = parseLenient(text);
    if (!raw) continue;
    if (typeof raw.owner === "string") settings.owner = raw.owner;
    const history = asRecord(raw.history);
    if (typeof history?.enabled === "boolean") settings.historyEnabled = history.enabled;
    if (typeof history?.dir === "string") settings.historyDir = history.dir;
    const collection = asRecord(raw.collection);
    if (collection?.landscapeIncludePrivate === true) settings.includePrivate = true;
    if (collection?.landscapeIncludePrivate === false) settings.includePrivate = false;
    const features = asRecord(collection?.features);
    if (typeof features?.landscape === "boolean") settings.landscape = features.landscape;
  }
  const env = (key: string) => process.env[key]?.trim() || undefined;
  const flag = (value: string) => /^(1|true|yes|on)$/i.test(value);
  const owner = env("DEVEX_OWNER");
  if (owner) settings.owner = owner;
  const historyEnabled = env("DEVEX_HISTORY_ENABLED");
  if (historyEnabled) settings.historyEnabled = flag(historyEnabled);
  const historyDir = env("DEVEX_HISTORY_DIR");
  if (historyDir) settings.historyDir = historyDir;
  const landscape = env("DEVEX_FEATURE_LANDSCAPE");
  if (landscape) settings.landscape = flag(landscape);
  const includePrivate = env("DEVEX_LANDSCAPE_INCLUDE_PRIVATE");
  if (includePrivate) settings.includePrivate = flag(includePrivate);
  return settings;
}

function readIfPresent(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

function parseLenient(text: string | undefined): Record<string, unknown> | undefined {
  if (!text?.trim()) return undefined;
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function runUrl(): { run_url?: string } {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = process.env;
  return server && repo && id ? { run_url: `${server}/${repo}/actions/runs/${id}` } : {};
}

function writeOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "prepare") await prepare();
  else if (command === "ingest") await ingest(process.argv[3]);
  else if (command === "recheck") await recheck();
  else if (command === "mark-failed") await markFailed();
  else if (command === "verify-publication") {
    const config = loadConfig();
    await assertLandscapePublication(path.resolve(config.history.dir),
      config.collection.landscapeIncludePrivate || hasPrivateLandscapeData(path.resolve("_site")));
  }
  else
    throw new Error(
      "Usage: landscape-cli <prepare | ingest <raw-scan.json> | recheck | mark-failed | verify-publication>"
    );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
