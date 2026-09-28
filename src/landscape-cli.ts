import * as fs from "node:fs";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { loadConfig, assertUsable } from "./config.js";
import type { OrgMetrics } from "./types.js";
import {
  installedLandscapeScannerVersion,
  loadLandscapeSelection,
  publicLandscapeSelection,
  saveLandscapeRunStatus,
  saveLandscapeScan,
  scrubLandscapeOutsideSelection,
  scrubLandscapeRepositories,
  unverifiedLandscapeRepositories,
  validateLandscapeScannerOutput,
} from "./landscape.js";

function prepare(): void {
  const config = loadConfig();
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
  const historyDir = path.resolve(config.history.dir);
  const metrics = loadLandscapeSelection(historyDir, config.owner);
  const scrubbed = scrubLandscapeOutsideSelection(historyDir, metrics);
  if (scrubbed > 0) {
    console.log(
      `Removed ${scrubbed} stored landscape observations for repositories no longer verified public`
    );
  }
  const repositories = publicLandscapeSelection(metrics)
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
    `Landscape selection: ${repositories.length} verified public repositories in ${config.owner} ` +
      `of ${metrics.repos.length} DevEx-selected (other owners and private/unknown visibility stay unknown)`
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
 * public. On a failed run the workflow still publishes the scrubbed store and
 * rebuilds Pages (see markFailed), so stale paths are not left online.
 * Returns the unverified repositories.
 */
async function recheckAndScrub(
  historyDir: string,
  owner: string,
  names: readonly string[],
  token: string
): Promise<string[]> {
  const unverified = await unverifiedLandscapeRepositories(names, new Octokit({ auth: token }));
  if (unverified.length > 0) {
    const removed = scrubLandscapeRepositories(historyDir, owner, unverified);
    console.error(
      `${unverified.length} landscape repositories are no longer verified public ` +
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
  const token = scanToken();
  // Re-check the whole prepared selection before reading the scanner output,
  // so neither a partial nor a malformed output can skip the scrub. Validation
  // below rejects any repository outside that selection.
  const names = publicLandscapeSelection(metrics).map((repo) => repo.fullName);
  const unverified = await recheckAndScrub(historyDir, metrics.owner, names, token);
  if (unverified.length > 0) {
    throw new Error(
      "Landscape repositories are no longer verified public; refusing to persist paths"
    );
  }
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as unknown;
  validateLandscapeScannerOutput(
    raw,
    metrics,
    config.collection.landscapeStaleAfterDays,
    installedLandscapeScannerVersion()
  );
  const scan = saveLandscapeScan(historyDir, metrics, raw);
  saveLandscapeRunStatus(historyDir, metrics.owner, {
    attempted_at: new Date().toISOString(),
    ok: true,
    ...runUrl(),
  });
  console.log(
    `Stored sanitized landscape v1 scan (${scan.repositories.length} public repositories)`
  );
}

/** After a failed scan, scrub any selected repository that is no longer verified public. */
async function recheck(): Promise<void> {
  const { historyDir, metrics } = loadEnabled();
  const token = scanToken();
  const names = publicLandscapeSelection(metrics).map((repo) => repo.fullName);
  const unverified = await recheckAndScrub(historyDir, metrics.owner, names, token);
  if (unverified.length === 0) {
    console.log(`All ${names.length} selected landscape repositories are still verified public`);
  }
}

/**
 * Run as the last step of a failed collection. Keeps the last good landscape
 * data, scrubs repositories outside the current public selection, records the
 * failure so the dashboard marks the data as stale, and asks the workflow to
 * publish the store and rebuild Pages before the run reports its failure.
 */
function markFailed(): void {
  const settings = failureSettings();
  if (!settings) return;
  const { owner, historyDir } = settings;
  try {
    const metrics = loadLandscapeSelection(historyDir, owner);
    const removed = scrubLandscapeOutsideSelection(historyDir, metrics);
    if (removed > 0) {
      console.log(`Removed ${removed} stored landscape observations outside the public selection`);
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
function failureSettings(): { owner: string; historyDir: string } | undefined {
  let settings: MinimalSettings;
  try {
    const config = loadConfig();
    settings = {
      owner: config.owner,
      historyEnabled: config.history.enabled,
      historyDir: config.history.dir,
      landscape: config.collection.features.landscape,
    };
  } catch (err: unknown) {
    console.warn("Configuration is invalid; recording the failure from its raw sources:", err);
    settings = minimalSettings();
  }
  return settings.landscape && settings.historyEnabled && settings.owner
    ? { owner: settings.owner, historyDir: path.resolve(settings.historyDir) }
    : undefined;
}

interface MinimalSettings {
  owner: string;
  historyEnabled: boolean;
  historyDir: string;
  landscape: boolean;
}

function minimalSettings(): MinimalSettings {
  const settings: MinimalSettings = {
    owner: "",
    historyEnabled: true,
    historyDir: "data/history",
    landscape: false,
  };
  const file = process.env.DEVEX_CONFIG_FILE?.trim() || "devex.config.json";
  for (const text of [readIfPresent(path.resolve(file)), process.env.DEVEX_CONFIG]) {
    const raw = parseLenient(text);
    if (!raw) continue;
    if (typeof raw.owner === "string") settings.owner = raw.owner;
    const history = asRecord(raw.history);
    if (typeof history?.enabled === "boolean") settings.historyEnabled = history.enabled;
    if (typeof history?.dir === "string") settings.historyDir = history.dir;
    const features = asRecord(asRecord(raw.collection)?.features);
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
  if (command === "prepare") prepare();
  else if (command === "ingest") await ingest(process.argv[3]);
  else if (command === "recheck") await recheck();
  else if (command === "mark-failed") markFailed();
  else
    throw new Error(
      "Usage: landscape-cli <prepare | ingest <raw-scan.json> | recheck | mark-failed>"
    );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
