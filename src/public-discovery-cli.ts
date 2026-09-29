import * as fs from "node:fs";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { assertUsable, loadConfig } from "./config.js";
import {
  loadPublicDiscoverySelection,
  recheckPublicDiscovery,
  savePublicDiscoveryScan,
  savePublicDiscoveryStatus,
  scrubPublicDiscovery,
  selectPublicDiscovery,
  validatePublicDiscoveryOutput,
} from "./public-discovery.js";

const configFile = path.resolve("data", "public-discovery.config.json");
const headsFile = path.resolve("data", "public-discovery.heads.json");

function output(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function enabled() {
  const config = loadConfig();
  if (!config.collection.features.publicDiscovery || !config.history.enabled)
    throw new Error("Public discovery ingestion requires an enabled feature and history store");
  assertUsable(config);
  const dir = path.resolve(config.history.dir);
  const metrics = loadPublicDiscoverySelection(dir, config.owner);
  return {
    config,
    dir,
    metrics,
    names: selectPublicDiscovery(metrics, config).map((repo) => repo.fullName),
  };
}

function prepared(names: readonly string[]): void {
  const config = JSON.parse(fs.readFileSync(configFile, "utf8")) as unknown;
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Invalid prepared public discovery selection");
  const value = config as Record<string, unknown>;
  if (
    value.schema_version !== 1 ||
    !Array.isArray(value.repositories) ||
    value.repositories.length !== names.length ||
    value.repositories.some((item, i) => item !== names.slice().sort()[i])
  )
    throw new Error("Prepared public discovery selection differs from the newest DevEx snapshot");
}

function prepare(): void {
  const config = loadConfig();
  if (!config.collection.features.publicDiscovery) {
    output("discovery-enabled", "false");
    output("discovery-scan-needed", "false");
    return;
  }
  const { dir, metrics, names } = enabled();
  scrubPublicDiscovery(dir, metrics.owner, names);
  if (names.length > 500)
    throw new Error(
      "Public discovery selects more than the CLI's 500-repository limit; set DEVEX_PUBLIC_DISCOVERY_MAX_REPOS"
    );
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        schema_version: 1,
        repositories: names.slice().sort(),
        stale_after_days: config.collection.landscapeStaleAfterDays,
      },
      null,
      2
    ) + "\n"
  );
  if (!names.length) savePublicDiscoveryStatus(dir, metrics.owner, true);
  output("discovery-enabled", "true");
  output("discovery-scan-needed", String(names.length > 0));
  output("discovery-max-size-kb", String(config.collection.publicDiscoveryMaxSizeKb));
  output("discovery-max-clone-size-kb", String(config.collection.publicDiscoveryMaxCloneSizeKb));
  output("discovery-clone-minutes", String(config.collection.publicDiscoveryCloneMinutes));
  if (names.length) {
    output("discovery-owner", metrics.owner);
    output("discovery-repositories", names.map((item) => item.split("/")[1]).join(","));
  }
  console.log(
    `Public discovery selected ${names.length} public repositories from ${metrics.repos.length} DevEx repositories`
  );
}

function token(): Octokit {
  if (!process.env.GITHUB_TOKEN)
    throw new Error("Public discovery requires a Contents-read GITHUB_TOKEN");
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

async function pin(): Promise<void> {
  const { config, dir, metrics, names } = enabled();
  if (!names.length) throw new Error("Cannot pin an empty public discovery selection");
  prepared(names);
  const api = token();
  const unverified = await recheckPublicDiscovery(dir, metrics, config, api);
  if (unverified.length)
    throw new Error(`Public discovery visibility check failed for ${unverified.join(", ")}`);
  const heads: Record<string, string> = {};
  for (const fullName of names) {
    const [owner, repo] = fullName.split("/");
    const response = await api.rest.repos.get({ owner, repo });
    if (
      response.data.private !== false ||
      response.data.full_name.toLowerCase() !== fullName.toLowerCase()
    )
      throw new Error(`Public discovery cannot positively verify ${fullName} as public`);
    if (
      !Number.isSafeInteger(response.data.size) ||
      response.data.size <= 0 ||
      (config.collection.publicDiscoveryMaxSizeKb &&
        response.data.size > config.collection.publicDiscoveryMaxSizeKb)
    )
      throw new Error(
        `Public discovery ${fullName} has unknown, empty, or over-limit size since collection`
      );
    const branch = await api.rest.repos.getBranch({
      owner,
      repo,
      branch: response.data.default_branch,
    });
    const sha = branch.data.commit.sha.toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error(`Public discovery cannot pin ${fullName}`);
    heads[fullName] = sha;
  }
  fs.writeFileSync(headsFile, JSON.stringify(heads, null, 2) + "\n");
}

async function ingest(file: string | undefined): Promise<void> {
  if (!file) throw new Error("Usage: public-discovery-cli ingest <raw-scan.json>");
  const { config, dir, metrics, names } = enabled();
  prepared(names);
  const unverified = await recheckPublicDiscovery(dir, metrics, config, token());
  if (unverified.length)
    throw new Error("Public discovery visibility changed; no scan will be persisted");
  const heads = JSON.parse(fs.readFileSync(headsFile, "utf8")) as unknown;
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as unknown;
  const scan = validatePublicDiscoveryOutput(raw, metrics, config, heads);
  savePublicDiscoveryScan(dir, metrics, scan);
  savePublicDiscoveryStatus(dir, metrics.owner, true);
  console.log(`Stored ${scan.repositories.length} sanitized public discovery observations`);
}

async function markFailed(): Promise<void> {
  try {
    if (!loadConfig().collection.features.publicDiscovery) return;
  } catch (error: unknown) {
    console.warn(
      "Public discovery configuration is invalid while recording a failed attempt:",
      error
    );
    if (
      !/^(1|true|yes|on)$/i.test(process.env.DEVEX_FEATURE_PUBLIC_DISCOVERY?.trim() ?? "") &&
      !/"publicDiscovery"\s*:\s*true/.test(process.env.DEVEX_CONFIG ?? "")
    )
      return;
  }
  let owner: string | undefined;
  let dir: string | undefined;
  let failure: unknown;
  try {
    const { config, dir: historyDir, metrics, names } = enabled();
    owner = metrics.owner;
    dir = historyDir;
    scrubPublicDiscovery(dir, owner, names);
    const unverified = await recheckPublicDiscovery(dir, metrics, config, token());
    if (unverified.length)
      console.warn(`Scrubbed ${unverified.length} unverified public discovery repositories`);
  } catch (error: unknown) {
    failure = error;
    console.error("Public discovery failure recheck could not complete:", error);
    // Record a stale status even when the settings that caused the failure cannot be parsed.
    owner ??= process.env.DEVEX_OWNER?.trim();
    dir ??= path.resolve(process.env.DEVEX_HISTORY_DIR?.trim() || "data/history");
  }
  if (!owner || !dir) throw new Error("Cannot record public discovery failure without an owner");
  savePublicDiscoveryStatus(dir, owner, false);
  output("discovery-publish", "true");
  if (failure) process.exitCode = 1;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "prepare") prepare();
  else if (command === "pin") await pin();
  else if (command === "ingest") await ingest(process.argv[3]);
  else if (command === "mark-failed") await markFailed();
  else
    throw new Error(
      "Usage: public-discovery-cli <prepare | pin | ingest <raw-scan.json> | mark-failed>"
    );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
