import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { Octokit } from "@octokit/rest";
import { latestPath, scopePath } from "./history.js";
import type {
  LandscapeDrift,
  LandscapeContentSignal,
  LandscapeFile,
  LandscapeRepoView,
  LandscapeRepository,
  LandscapeRunStatus,
  LandscapeScan,
  LandscapeSummary,
  LandscapeUnavailableRepository,
  OrgMetrics,
  RepoMetrics,
} from "./types.js";

const REPO_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/;
const SHA = /^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/;
const HASH = /^[a-fA-F0-9]{64}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Landscape ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Landscape ${label} must be a nonempty string`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const text = nonempty(value, label);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(text)) {
    throw new Error(`Landscape ${label} must be an ISO-8601 timestamp`);
  }
  const time = new Date(text);
  const day = text.slice(0, 10);
  if (!Number.isFinite(time.getTime()) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new Error(`Landscape ${label} is not a valid timestamp`);
  }
  return time.toISOString();
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Landscape ${label} must be a nonnegative integer`);
  }
  return value as number;
}

function nullableCount(value: unknown, label: string): number | null {
  return value === null ? null : count(value, label);
}

function relativePath(value: unknown, label: string): string {
  const name = nonempty(value, label);
  if (
    name.length > 1024 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(name) ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Landscape ${label} must be a safe relative Git path`);
  }
  return name;
}

function parseContentSignal(value: unknown, label: string): LandscapeContentSignal | null {
  if (value === null) return null;
  const signal = object(value, label);
  for (const key of ["scope", "actions", "verification", "guardrails"] as const) {
    if (typeof signal[key] !== "boolean") throw new Error(`Landscape ${label}.${key} must be boolean`);
  }
  const flags = ["scope", "actions", "verification", "guardrails"]
    .filter((key) => signal[key] === true).length;
  if (signal.score !== flags * 25) throw new Error(`Landscape ${label} score disagrees with rubric`);
  return {
    score: flags * 25,
    scope: signal.scope === true,
    actions: signal.actions === true,
    verification: signal.verification === true,
    guardrails: signal.guardrails === true,
  };
}

function parseFile(value: unknown, label: string, includeSignals: boolean): LandscapeFile {
  const file = object(value, label);
  const filePath = relativePath(file.path, `${label}.path`);
  const kind = nonempty(file.kind, `${label}.kind`);
  if (kind.length > 100) throw new Error(`Landscape ${label}.kind is too long`);
  const hash = nonempty(file.sha256, `${label}.sha256`);
  if (!HASH.test(hash)) throw new Error(`Landscape ${label}.sha256 must be SHA-256`);

  const lastChanged =
    file.last_changed === null ? null : timestamp(file.last_changed, `${label}.last_changed`);
  const ageDays = nullableCount(file.age_days, `${label}.age_days`);
  const lagDays = nullableCount(file.lag_days, `${label}.lag_days`);
  if (file.stale !== null && typeof file.stale !== "boolean") {
    throw new Error(`Landscape ${label}.stale must be a boolean or null`);
  }
  const unknown =
    lastChanged === null || ageDays === null || lagDays === null || file.stale === null;
  if (file.status !== undefined && file.status !== "known" && file.status !== "unknown") {
    throw new Error(`Landscape ${label}.status must be known or unknown`);
  }
  if (file.status === "known" && unknown) {
    throw new Error(`Landscape ${label} cannot be known with unavailable history`);
  }
  const result: LandscapeFile = {
    path: filePath,
    kind,
    sha256: hash.toLowerCase(),
    last_changed: lastChanged,
    age_days: ageDays,
    lag_days: lagDays,
    stale: file.stale,
    status: unknown || file.status === "unknown" ? "unknown" : "known",
  };
  if (includeSignals) {
    if (file.commits_since_change !== undefined)
      result.commits_since_change = nullableCount(file.commits_since_change, `${label}.commits_since_change`);
    if (file.content_signal !== undefined)
      result.content_signal = parseContentSignal(file.content_signal, `${label}.content_signal`);
    if (lastChanged === null && result.commits_since_change != null)
      throw new Error(`Landscape ${label} cannot count commits without a last change`);
  }
  return result;
}

function parseRepository(
  value: unknown,
  label: string,
  includeSignals: boolean
): LandscapeRepository | LandscapeUnavailableRepository {
  const repo = object(value, label);
  const fullName = nonempty(repo.full_name, `${label}.full_name`);
  if (!REPO_NAME.test(fullName)) {
    throw new Error(`Landscape ${label}.full_name must be owner/repository`);
  }
  if (repo.status === "denied" || repo.status === "error") {
    return { full_name: fullName, status: repo.status };
  }
  if (repo.status !== undefined && repo.status !== "known" && repo.status !== "partial_unknown") {
    throw new Error(`Landscape ${label}.status is unsupported`);
  }
  const head = nonempty(repo.head_sha, `${label}.head_sha`);
  if (!SHA.test(head)) throw new Error(`Landscape ${label}.head_sha must be a commit SHA`);
  if (!Array.isArray(repo.ai_files))
    throw new Error(`Landscape ${label}.ai_files must be an array`);
  const files = repo.ai_files.map((file: unknown, i: number) =>
    parseFile(file, `${label}.ai_files[${i}]`, includeSignals)
  );
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`Landscape ${label} has duplicate file paths`);
    seen.add(file.path);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const rawSummary = object(repo.ai_summary, `${label}.ai_summary`);
  const staleCount = files.filter((file) => file.stale === true).length;
  const unknownCount = files.filter((file) => file.status === "unknown").length;
  const knownLags = files.flatMap((file) => (file.lag_days === null ? [] : [file.lag_days]));
  const maxLag = knownLags.length ? Math.max(...knownLags) : null;
  if (
    count(rawSummary.count, `${label}.ai_summary.count`) !== files.length ||
    count(rawSummary.stale_count, `${label}.ai_summary.stale_count`) !== staleCount ||
    (rawSummary.unknown_count !== undefined &&
      count(rawSummary.unknown_count, `${label}.ai_summary.unknown_count`) !== unknownCount)
  ) {
    throw new Error(`Landscape ${label}.ai_summary disagrees with observed files`);
  }
  if (rawSummary.max_lag_days !== undefined) {
    const reportedMax = nullableCount(rawSummary.max_lag_days, `${label}.ai_summary.max_lag_days`);
    if (reportedMax !== maxLag && !(maxLag === null && reportedMax === 0)) {
      throw new Error(`Landscape ${label}.ai_summary.max_lag_days disagrees with observed files`);
    }
  }
  const status: LandscapeSummary["status"] = unknownCount === 0 ? "known" : "partial_unknown";
  if (rawSummary.status !== undefined && rawSummary.status !== status) {
    throw new Error(`Landscape ${label}.ai_summary.status disagrees with observed files`);
  }
  const result: LandscapeRepository = {
    full_name: fullName,
    head_sha: head.toLowerCase(),
    ai_files: files,
    ai_summary: {
      count: files.length,
      stale_count: staleCount,
      max_lag_days: maxLag,
      unknown_count: unknownCount,
      status,
    },
  };
  if (includeSignals) {
    for (const key of ["commits_30d", "commits_90d", "team_commits_30d", "team_commits_90d"] as const) {
      if (repo[key] !== undefined) result[key] = nullableCount(repo[key], `${label}.${key}`);
    }
    if (result.commits_30d != null && result.commits_90d != null &&
        result.commits_30d > result.commits_90d)
      throw new Error(`Landscape ${label} 30-day commits exceed 90-day commits`);
    for (const [teamKey, totalKey] of [
      ["team_commits_30d", "commits_30d"],
      ["team_commits_90d", "commits_90d"],
    ] as const) {
      const teamCount = result[teamKey];
      const totalCount = result[totalKey];
      if (teamCount != null && (totalCount == null || teamCount > totalCount))
        throw new Error(`Landscape ${label} team commits exceed verified total`);
    }
  }
  return result;
}

/** Validate the portable v1 contract; only internally enriched scans admit bounded signal fields. */
export function parseLandscapeScan(value: unknown, includeSignals = false): LandscapeScan {
  const raw = object(value, "scan");
  if (raw.schema_version !== 1)
    throw new Error("Unsupported landscape schema_version (expected 1)");
  const generatedAt = timestamp(raw.generated_at, "generated_at");
  const scannerVersion = nonempty(raw.scanner_version, "scanner_version");
  if (scannerVersion.length > 100) throw new Error("Landscape scanner_version is too long");
  if (!Array.isArray(raw.repositories)) throw new Error("Landscape repositories must be an array");
  const repositories = raw.repositories.map((repo: unknown, i: number) =>
    parseRepository(repo, `repositories[${i}]`, includeSignals)
  );
  const seen = new Set<string>();
  for (const repo of repositories) {
    const key = repo.full_name.toLowerCase();
    if (seen.has(key)) throw new Error("Landscape has duplicate repositories");
    seen.add(key);
  }
  repositories.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return {
    schema_version: 1,
    generated_at: generatedAt,
    scanner_version: scannerVersion,
    repositories,
  };
}

function readScan(file: string): LandscapeScan {
  return parseLandscapeScan(JSON.parse(fs.readFileSync(file, "utf8")) as unknown, true);
}

/** Path to the latest sanitized landscape observation in the data-only history branch. */
export function landscapeLatestPath(historyDir: string, owner: string): string {
  return scopePath(historyDir, owner, "landscape/latest.json");
}

function snapshotsPath(historyDir: string, owner: string): string {
  return scopePath(historyDir, owner, "landscape/snapshots");
}

function snapshotFilename(scan: LandscapeScan): string {
  return scan.generated_at.replace(/[:.]/g, "-") + ".json";
}

function lastSuccessful(
  historyDir: string,
  owner: string,
  names: readonly string[],
  before: string
): Map<string, { repo: LandscapeRepository; time: string }> {
  const outstanding = new Set(names.map((name) => name.toLowerCase()));
  const result = new Map<string, { repo: LandscapeRepository; time: string }>();
  const folder = snapshotsPath(historyDir, owner);
  if (!fs.existsSync(folder)) return result;
  for (const file of fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()) {
    const scan = readScan(path.join(folder, file));
    if (scan.generated_at >= before) continue;
    for (const repo of scan.repositories) {
      const name = repo.full_name.toLowerCase();
      if (outstanding.has(name) && "head_sha" in repo) {
        result.set(name, { repo, time: scan.generated_at });
        outstanding.delete(name);
      }
    }
    if (outstanding.size === 0) break;
  }
  return result;
}

/** Compare only file presence and SHA-256: age is not a claim about correctness. */
export function compareLandscape(
  current: LandscapeRepository,
  previous: LandscapeRepository,
  comparedAt: string
): LandscapeDrift {
  const oldFiles = new Map(previous.ai_files.map((file) => [file.path, file.sha256]));
  const newFiles = new Map(current.ai_files.map((file) => [file.path, file.sha256]));
  return {
    compared_at: comparedAt,
    compared_head_sha: previous.head_sha,
    added: current.ai_files.filter((file) => !oldFiles.has(file.path)).map((file) => file.path),
    removed: previous.ai_files.filter((file) => !newFiles.has(file.path)).map((file) => file.path),
    content_changed: current.ai_files
      .filter((file) => oldFiles.has(file.path) && oldFiles.get(file.path) !== file.sha256)
      .map((file) => file.path),
  };
}

/**
 * Selected, verified-public repositories inside the configured App installation
 * owner. Empty repositories are left out: they have no HEAD commit to scan.
 */
export function publicLandscapeSelection(metrics: OrgMetrics): RepoMetrics[] {
  return metrics.repos.filter(
    (repo) =>
      repo.isPrivate === false &&
      repo.sizeKb !== 0 &&
      repo.fullName.slice(0, repo.fullName.indexOf("/")).toLowerCase() ===
        metrics.owner.toLowerCase()
  );
}

/** Read the installed scanner's version, not a deployment-supplied release number. */
export function installedLandscapeScannerVersion(): string {
  const manifest: unknown = createRequire(import.meta.url)(
    "@devex-metrics/repo-landscape/package.json"
  );
  const pkg = object(manifest, "installed scanner package");
  if (pkg.name !== "@devex-metrics/repo-landscape") {
    throw new Error("Installed landscape scanner package has an unexpected name");
  }
  return nonempty(pkg.version, "installed scanner package version");
}

/** Verify the scanner used the prepared explicit selection and GitHub API mode. */
export function validateLandscapeScannerOutput(
  raw: unknown,
  metrics: OrgMetrics,
  staleAfterDays: number,
  version: string
): LandscapeScan {
  const document = object(raw, "scanner output");
  const provenance = object(document.provenance, "provenance");
  if (
    provenance.source !== "github_api" ||
    provenance.analysis !== "ai_only" ||
    provenance.snapshot !== "pinned_head" ||
    provenance.stale_after_days !== staleAfterDays
  ) {
    throw new Error("Landscape scanner provenance does not match the configured GitHub API scan");
  }
  const selection = object(document.selection, "selection");
  const selected = publicLandscapeSelection(metrics)
    .map((repo) => repo.fullName.toLowerCase())
    .sort();
  const sameSelection = (value: unknown) =>
    Array.isArray(value) &&
    value.length === selected.length &&
    value.every((name: unknown) => typeof name === "string") &&
    value
      .map((name) => name.toLowerCase())
      .sort()
      .every((name, index) => name === selected[index]);
  if (
    selection.mode !== "explicit" ||
    !sameSelection(selection.explicit_repositories) ||
    !sameSelection(selection.selected_repositories) ||
    !Array.isArray(selection.discovery) ||
    selection.discovery.length !== 0
  ) {
    throw new Error(
      "Landscape scanner selection differs from the DevEx-selected public repositories"
    );
  }
  if (!Array.isArray(document.edges) || document.edges.length !== 0) {
    throw new Error("GitHub API landscape scan must not contain cross-repository edges");
  }
  const scan = parseLandscapeScan(raw);
  if (scan.scanner_version !== version) {
    throw new Error("Landscape scanner version does not match the installed CLI version");
  }
  return scan;
}

/**
 * Persist only approved metadata for public DevEx-selected repositories.
 * An unexpected or private repo in CLI output is an error, not a publishable fallback.
 */
export function saveLandscapeScan(
  historyDir: string,
  metrics: OrgMetrics,
  raw: unknown,
  enrichment?: LandscapeScan
): LandscapeScan {
  const source = parseLandscapeScan(raw);
  const scan = enrichment ? parseLandscapeScan(enrichment, true) : source;
  if (enrichment && JSON.stringify(parseLandscapeScan(scan)) !== JSON.stringify(source))
    throw new Error("Landscape enrichment differs from the sanitized scanner observation");
  const selectedAt = Date.parse(metrics.collectedAt);
  if (
    Number.isFinite(selectedAt) &&
    Math.floor(Date.parse(scan.generated_at) / 1000) < Math.floor(selectedAt / 1000)
  ) {
    throw new Error("Landscape scan predates the DevEx repository selection");
  }
  const selected = new Map(
    publicLandscapeSelection(metrics).map((repo) => [repo.fullName.toLowerCase(), repo])
  );
  if (selected.size === 0 || scan.repositories.length !== selected.size) {
    throw new Error("Landscape output must cover every selected public repository exactly once");
  }
  for (const repo of scan.repositories) {
    const match = selected.get(repo.full_name.toLowerCase());
    if (!match) {
      throw new Error(
        "Landscape output contains a repository outside the verified public DevEx selection"
      );
    }
    repo.full_name = match.fullName;
  }
  scan.repositories.sort((a, b) => a.full_name.localeCompare(b.full_name));
  const latest = landscapeLatestPath(historyDir, metrics.owner);
  if (fs.existsSync(latest) && readScan(latest).generated_at > scan.generated_at) {
    throw new Error("Landscape scan is older than the latest stored observation");
  }
  const snapshot = path.join(snapshotsPath(historyDir, metrics.owner), snapshotFilename(scan));
  const contents = JSON.stringify(scan, null, 2) + "\n";
  if (fs.existsSync(snapshot) && fs.readFileSync(snapshot, "utf8") !== contents) {
    throw new Error("A different landscape snapshot already exists for this generated_at");
  }
  fs.mkdirSync(path.dirname(snapshot), { recursive: true });
  fs.writeFileSync(snapshot, contents);
  fs.writeFileSync(`${latest}.tmp`, contents);
  fs.renameSync(`${latest}.tmp`, latest);
  return scan;
}

/** Join a sanitized scan to the current DevEx selection without conflating missing with absent. */
export function loadLandscapeView(
  historyDir: string, metrics: OrgMetrics, teamHandlesConfigured = false
): LandscapeRepoView[] {
  const currentFile = landscapeLatestPath(historyDir, metrics.owner);
  const scan = fs.existsSync(currentFile) ? readScan(currentFile) : undefined;
  const observed = new Map(
    scan?.repositories.map((repo) => [repo.full_name.toLowerCase(), repo]) ?? []
  );
  const previous = scan
    ? lastSuccessful(
        historyDir,
        metrics.owner,
        metrics.repos.map((repo) => repo.fullName),
        scan.generated_at
      )
    : new Map<string, { repo: LandscapeRepository; time: string }>();
  return metrics.repos.map((repo: RepoMetrics) => {
    const fullName = repo.fullName;
    const reason =
      repo.isPrivate === true
        ? "private"
        : repo.isPrivate === undefined
          ? "visibility_unknown"
          : undefined;
    if (reason) return { fullName, status: "unknown", reason };
    const observation = observed.get(fullName.toLowerCase());
    if (!scan || !observation) {
      return { fullName, status: "unknown", reason: "not_scanned" };
    }
    if (
      "status" in observation &&
      (observation.status === "denied" || observation.status === "error")
    ) {
      return {
        fullName,
        status: "unknown",
        reason: observation.status === "denied" ? "denied" : "scan_error",
        collectedAt: scan.generated_at,
        scannerVersion: scan.scanner_version,
      };
    }
    const known = observation as LandscapeRepository;
    const prior = previous.get(fullName.toLowerCase());
    return {
      fullName,
      status: "observed",
      collectedAt: scan.generated_at,
      scannerVersion: scan.scanner_version,
      headSha: known.head_sha,
      files: known.ai_files,
      summary: known.ai_summary,
      drift: prior ? compareLandscape(known, prior.repo, prior.time) : undefined,
      commits30d: known.commits_30d ?? null,
      commits90d: known.commits_90d ?? null,
      teamCommits30d: teamHandlesConfigured ? known.team_commits_30d ?? null : null,
      teamCommits90d: teamHandlesConfigured ? known.team_commits_90d ?? null : null,
      qualityScored: known.ai_files.filter((file) => file.content_signal != null).length,
      qualityScore: known.ai_files.length > 0 &&
        known.ai_files.every((file) => file.content_signal != null)
        ? Math.round(known.ai_files.reduce((sum, file) => sum + file.content_signal!.score, 0) /
          known.ai_files.length)
        : null,
    };
  });
}

/** Read the selected DevEx snapshot, not a separately rediscovered repository set. */
export function loadLandscapeSelection(historyDir: string, owner: string): OrgMetrics {
  const file = latestPath(historyDir, owner);
  if (!fs.existsSync(file)) throw new Error(`No DevEx snapshot at ${file}; collect metrics first`);
  const metrics = JSON.parse(fs.readFileSync(file, "utf8")) as OrgMetrics;
  if (
    !Array.isArray(metrics.repos) ||
    typeof metrics.owner !== "string" ||
    metrics.owner.toLowerCase() !== owner.toLowerCase()
  ) {
    throw new Error("DevEx snapshot is invalid or belongs to another owner");
  }
  for (const repo of metrics.repos) {
    if (
      !repo ||
      typeof repo.fullName !== "string" ||
      !REPO_NAME.test(repo.fullName) ||
      (repo.isPrivate !== undefined && typeof repo.isPrivate !== "boolean")
    ) {
      throw new Error("DevEx snapshot contains an invalid repository selection");
    }
  }
  if (
    new Set(metrics.repos.map((repo) => repo.fullName.toLowerCase())).size !== metrics.repos.length
  ) {
    throw new Error("DevEx snapshot contains duplicate repositories");
  }
  return metrics;
}

/**
 * Repositories that can no longer be verified public. A failed lookup counts
 * as unverified: publishing paths is only safe on a positive check.
 */
export async function unverifiedLandscapeRepositories(
  names: readonly string[],
  octokit: Pick<Octokit, "rest">
): Promise<string[]> {
  const unverified: string[] = [];
  for (const fullName of names) {
    const [owner, name] = fullName.split("/");
    try {
      const response = await octokit.rest.repos.get({ owner, repo: name });
      if (
        response.data.private === false &&
        response.data.full_name.toLowerCase() === fullName.toLowerCase()
      ) {
        continue;
      }
    } catch (err: unknown) {
      console.warn(`Could not verify visibility of ${fullName}:`, err);
    }
    unverified.push(fullName);
  }
  return unverified;
}

function dropLandscapeObservations(
  historyDir: string,
  owner: string,
  drop: (fullName: string) => boolean
): number {
  const folder = snapshotsPath(historyDir, owner);
  const files = [
    landscapeLatestPath(historyDir, owner),
    ...(fs.existsSync(folder)
      ? fs
          .readdirSync(folder)
          .filter((f) => f.endsWith(".json"))
          .map((f) => path.join(folder, f))
      : []),
  ];
  let removed = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const scan = readScan(file);
    const kept = scan.repositories.filter((repo) => !drop(repo.full_name));
    if (kept.length === scan.repositories.length) continue;
    removed += scan.repositories.length - kept.length;
    fs.writeFileSync(
      `${file}.tmp`,
      JSON.stringify({ ...scan, repositories: kept }, null, 2) + "\n"
    );
    fs.renameSync(`${file}.tmp`, file);
  }
  return removed;
}

/**
 * Drop stored observations for repositories that are no longer verified public
 * from the latest scan and every snapshot, so neither the next Pages build nor
 * the persisted landscape stream keeps their paths. Returns how many
 * observations were removed across all files.
 */
export function scrubLandscapeRepositories(
  historyDir: string,
  owner: string,
  names: readonly string[]
): number {
  const drop = new Set(names.map((name) => name.toLowerCase()));
  return dropLandscapeObservations(historyDir, owner, (name) => drop.has(name.toLowerCase()));
}

/**
 * Drop stored observations for every repository outside the current verified
 * public selection: ones now private, of unknown visibility, or no longer
 * selected at all. Returns how many observations were removed across all files.
 */
export function scrubLandscapeOutsideSelection(historyDir: string, metrics: OrgMetrics): number {
  const keep = new Set(
    publicLandscapeSelection(metrics).map((repo) => repo.fullName.toLowerCase())
  );
  return dropLandscapeObservations(
    historyDir,
    metrics.owner,
    (name) => !keep.has(name.toLowerCase())
  );
}

function statusPath(historyDir: string, owner: string): string {
  return scopePath(historyDir, owner, "landscape/status.json");
}

/** Record the outcome of a landscape scan attempt for the dashboard's stale-data notice. */
export function saveLandscapeRunStatus(
  historyDir: string,
  owner: string,
  status: Omit<LandscapeRunStatus, "last_success_at">
): void {
  const file = statusPath(historyDir, owner);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(status, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}

/** The latest attempt's outcome joined to the scan time of the observation being shown. */
export function loadLandscapeRunStatus(
  historyDir: string,
  owner: string
): LandscapeRunStatus | undefined {
  const file = statusPath(historyDir, owner);
  if (!fs.existsSync(file)) return undefined;
  const raw = object(JSON.parse(fs.readFileSync(file, "utf8")) as unknown, "run status");
  if (typeof raw.ok !== "boolean") throw new Error("Landscape run status ok must be a boolean");
  const runUrl =
    raw.run_url === undefined ? undefined : nonempty(raw.run_url, "run status run_url");
  if (runUrl !== undefined && !/^https:\/\//.test(runUrl)) {
    throw new Error("Landscape run status run_url must be an https URL");
  }
  const latest = landscapeLatestPath(historyDir, owner);
  return {
    attempted_at: timestamp(raw.attempted_at, "run status attempted_at"),
    ok: raw.ok,
    ...(runUrl ? { run_url: runUrl } : {}),
    last_success_at: fs.existsSync(latest) ? readScan(latest).generated_at : null,
  };
}
