import * as fs from "node:fs";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { loadConfig, assertUsable } from "./config.js";
import type { OrgMetrics } from "./types.js";
import {
  loadLandscapeSelection,
  publicLandscapeSelection,
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
  const version = config.collection.landscapeCliVersion;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      "Set DEVEX_LANDSCAPE_CLI_VERSION to an exact published OIDC release " +
        "(for example 0.1.0) before enabling landscape collection"
    );
  }
  const historyDir = path.resolve(config.history.dir);
  const metrics = loadLandscapeSelection(historyDir, config.owner);
  const scrubbed = scrubLandscapeOutsideSelection(historyDir, metrics);
  if (scrubbed > 0) {
    console.log(
      `Removed ${scrubbed} stored landscape observations for repositories no longer verified public`
    );
    writeOutput("landscape-scrubbed", "true");
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
  writeOutput("landscape-enabled", "true");
  writeOutput("landscape-scan-needed", String(repositories.length > 0));
  writeOutput("landscape-cli-version", version);
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
 * public. The workflow publishes the scrubbed store and rebuilds Pages on the
 * landscape-scrubbed output even when the run fails, so stale paths are not
 * left online. Returns the unverified repositories.
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
    writeOutput("landscape-scrubbed", "true");
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
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as unknown;
  const scanToVerify = validateLandscapeScannerOutput(
    raw,
    metrics,
    config.collection.landscapeStaleAfterDays,
    config.collection.landscapeCliVersion
  );
  // Re-check the whole prepared selection, not just the scan output: a partial
  // output could omit a repository that has since gone private.
  const names = new Map(
    [
      ...publicLandscapeSelection(metrics).map((repo) => repo.fullName),
      ...scanToVerify.repositories.map((repo) => repo.full_name),
    ].map((name) => [name.toLowerCase(), name])
  );
  const unverified = await recheckAndScrub(historyDir, metrics.owner, [...names.values()], token);
  if (unverified.length > 0) {
    throw new Error(
      "Landscape repositories are no longer verified public; refusing to persist paths"
    );
  }
  const scan = saveLandscapeScan(historyDir, metrics, raw);
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
  else throw new Error("Usage: landscape-cli <prepare | ingest <raw-scan.json> | recheck>");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
