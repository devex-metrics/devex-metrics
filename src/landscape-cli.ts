import * as fs from "node:fs";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { loadConfig, assertUsable } from "./config.js";
import {
  loadLandscapeSelection,
  publicLandscapeSelection,
  saveLandscapeScan,
  validateLandscapeScannerOutput,
  verifyLandscapeVisibility,
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

async function ingest(file: string | undefined): Promise<void> {
  if (!file) throw new Error("Usage: landscape-cli ingest <raw-scan.json>");
  const config = loadConfig();
  if (!config.collection.features.landscape || !config.history.enabled) {
    throw new Error("Landscape ingestion requires an enabled feature and history store");
  }
  assertUsable(config);
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Landscape ingestion requires a selected-repositories Contents-read GITHUB_TOKEN"
    );
  }
  const historyDir = path.resolve(config.history.dir);
  const metrics = loadLandscapeSelection(historyDir, config.owner);
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as unknown;
  const scanToVerify = validateLandscapeScannerOutput(
    raw,
    metrics,
    config.collection.landscapeStaleAfterDays,
    config.collection.landscapeCliVersion
  );
  await verifyLandscapeVisibility(scanToVerify, new Octokit({ auth: token }));
  const scan = saveLandscapeScan(historyDir, metrics, raw);
  console.log(
    `Stored sanitized landscape v1 scan (${scan.repositories.length} public repositories)`
  );
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
  else throw new Error("Usage: landscape-cli <prepare | ingest <raw-scan.json>>");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
