import * as fs from "node:fs";
import * as path from "node:path";
import type { Octokit } from "@octokit/rest";
import type { DevexConfig } from "./config.js";
import { scopePath } from "./history.js";
import {
  installedLandscapeScannerVersion,
  loadLandscapeSelection,
  unverifiedLandscapeRepositories,
} from "./landscape.js";
import type {
  OrgMetrics,
  PublicDiscoveryConnection,
  PublicDiscoveryRepoView,
  PublicDiscoveryRepository,
  PublicDiscoveryRunStatus,
  PublicDiscoveryScan,
  RepoMetrics,
} from "./types.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[a-f0-9]{40}$/;
const DAY = 86_400_000;
const MAX_CONNECTIONS = 50;

function safeName(value: string): boolean {
  return NAME.test(value) && ![".", ".."].includes(value.split("/")[1]);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Public discovery ${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 200): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`Public discovery ${label} must be a bounded nonempty string`);
  return value;
}

function iso(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(`Public discovery ${label} must be a valid ISO timestamp`);
  return new Date(value).toISOString();
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`Public discovery ${label} must be a nonnegative integer`);
  return value as number;
}

function language(value: unknown): PublicDiscoveryRepository["languages"][number] {
  const part = record(value, "language");
  return {
    name: text(part.name, "language name", 40),
    files: count(part.files, "language files"),
    loc: count(part.loc, "language loc"),
  };
}

function compareLanguages(
  a: PublicDiscoveryRepository["languages"][number],
  b: PublicDiscoveryRepository["languages"][number]
): number {
  const nameA = a.name.toLowerCase();
  const nameB = b.name.toLowerCase();
  return (
    b.loc - a.loc ||
    (nameA < nameB ? -1 : nameA > nameB ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

function name(value: unknown, label: string): string {
  const valueName = text(value, label);
  if (!safeName(valueName)) throw new Error(`Public discovery ${label} is not a safe owner/repo`);
  return valueName;
}

function safePath(value: unknown, label: string): string {
  const item = text(value, label);
  if (
    item.startsWith("/") ||
    item.includes("\\") ||
    item.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Public discovery ${label} must be a safe relative path`);
  return item;
}

function sameNames(value: unknown, expected: readonly string[]): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    !value.every((item: unknown) => typeof item === "string" && safeName(item))
  )
    return false;
  const actual = value.map((item: string) => item.toLowerCase()).sort();
  const wanted = expected.map((item) => item.toLowerCase()).sort();
  return actual.every((item: string, index: number) => item === wanted[index]);
}

/** Rank on collected merged-PR timestamps, never on push time or lifetime PR totals. */
export function selectPublicDiscovery(metrics: OrgMetrics, config: DevexConfig): RepoMetrics[] {
  const cutoff = Date.parse(metrics.collectedAt) - 90 * DAY;
  if (!Number.isFinite(cutoff))
    throw new Error("Public discovery needs a valid DevEx collection time");
  const candidates = metrics.repos.filter(
    (repo) =>
      repo.isPrivate === false &&
      Number.isSafeInteger(repo.sizeKb) &&
      repo.sizeKb !== undefined &&
      repo.sizeKb > 0 &&
      safeName(repo.fullName) &&
      repo.fullName.split("/")[0]?.toLowerCase() === metrics.owner.toLowerCase() &&
      (config.collection.publicDiscoveryMaxSizeKb === 0 ||
        repo.sizeKb <= config.collection.publicDiscoveryMaxSizeKb)
  );
  const ranked = candidates
    .filter(
      (repo) =>
        config.collection.publicDiscoveryMaxRepos === 0 || Array.isArray(repo.mergedPRTimeline)
    )
    .map((repo) => ({
      repo,
      count:
        repo.mergedPRTimeline?.filter((pr) => {
          const merged = Date.parse(pr.mergedAt);
          if (!Number.isFinite(merged))
            throw new Error(`Invalid merged PR timestamp in ${repo.fullName}`);
          return merged >= cutoff && merged <= Date.parse(metrics.collectedAt);
        }).length ?? 0,
    }));
  ranked.sort(
    (a, b) =>
      b.count - a.count ||
      (a.repo.fullName.toLowerCase() < b.repo.fullName.toLowerCase()
        ? -1
        : a.repo.fullName.toLowerCase() > b.repo.fullName.toLowerCase()
          ? 1
          : 0)
  );
  return ranked
    .slice(0, config.collection.publicDiscoveryMaxRepos || undefined)
    .map((item) => item.repo);
}

export function discoveryLatestPath(dir: string, owner: string): string {
  return scopePath(dir, owner, "public-discovery/latest.json");
}

function snapshotDir(dir: string, owner: string): string {
  return scopePath(dir, owner, "public-discovery/snapshots");
}

function statusFile(dir: string, owner: string): string {
  return scopePath(dir, owner, "public-discovery/status.json");
}

export function parsePublicDiscoveryScan(value: unknown): PublicDiscoveryScan {
  const raw = record(value, "snapshot");
  if (raw.schema_version !== 1) throw new Error("Unsupported public discovery snapshot schema");
  const generatedAt = iso(raw.generated_at, "generated_at");
  const scannerVersion = text(raw.scanner_version, "scanner_version", 100);
  if (!Array.isArray(raw.repositories) || !Array.isArray(raw.connections))
    throw new Error("Public discovery repositories and connections must be arrays");
  const repositories: PublicDiscoveryRepository[] = raw.repositories.map(
    (value: unknown, i: number) => {
      const item = record(value, `repositories[${i}]`);
      const fullName = name(item.full_name, "full_name");
      if (typeof item.head_sha !== "string" || !SHA.test(item.head_sha))
        throw new Error("Public discovery head_sha must be a pinned SHA");
      if (
        !Array.isArray(item.languages) ||
        item.languages.length > 5 ||
        !Array.isArray(item.commits_90d_trend) ||
        item.commits_90d_trend.length !== 90
      )
        throw new Error("Public discovery languages/trend exceed the bounded shape");
      const languages = item.languages.map(language);
      const trend = item.commits_90d_trend.map((point: unknown) => count(point, "trend point"));
      const result: PublicDiscoveryRepository = {
        full_name: fullName,
        head_sha: item.head_sha,
        files: count(item.files, "files"),
        bytes: count(item.bytes, "bytes"),
        source_loc: count(item.source_loc, "source_loc"),
        languages,
        commits_30d: count(item.commits_30d, "commits_30d"),
        commits_90d: count(item.commits_90d, "commits_90d"),
        commits_90d_trend: trend,
        contributor_count: count(item.contributor_count, "contributor_count"),
        adr_count: count(item.adr_count, "adr_count"),
        manifest_count: count(item.manifest_count, "manifest_count"),
        produces_count: count(item.produces_count, "produces_count"),
        consumes_count: count(item.consumes_count, "consumes_count"),
      };
      if (
        result.commits_90d !== trend.reduce((sum, point) => sum + point, 0) ||
        result.commits_30d !== trend.slice(-30).reduce((sum, point) => sum + point, 0) ||
        languages.reduce((sum, part) => sum + part.loc, 0) > result.source_loc
      )
        throw new Error("Public discovery counts disagree with observed details");
      return result;
    }
  );
  if (
    new Set(repositories.map((repo) => repo.full_name.toLowerCase())).size !== repositories.length
  )
    throw new Error("Public discovery has duplicate repositories");
  if (raw.connections.length > MAX_CONNECTIONS)
    throw new Error("Public discovery has too many connections");
  const selected = new Set(repositories.map((repo) => repo.full_name.toLowerCase()));
  const connections: PublicDiscoveryConnection[] = raw.connections.map((value: unknown) => {
    const item = record(value, "connection");
    const source = name(item.source, "connection source");
    const target = name(item.target, "connection target");
    if (
      source.toLowerCase() === target.toLowerCase() ||
      !selected.has(source.toLowerCase()) ||
      !selected.has(target.toLowerCase()) ||
      !Array.isArray(item.evidence) ||
      item.evidence.length < 1 ||
      item.evidence.length > 2
    )
      throw new Error(
        "Public discovery connection must link scanned repositories with bounded evidence"
      );
    return {
      source,
      target,
      evidence: item.evidence.map((value: unknown) => {
        const evidence = record(value, "connection evidence");
        return {
          consumer_file: safePath(evidence.consumer_file, "consumer_file"),
          producer_file: safePath(evidence.producer_file, "producer_file"),
        };
      }),
    };
  });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    scanner_version: scannerVersion,
    repositories,
    connections,
  };
}

function readScan(file: string): PublicDiscoveryScan {
  return parsePublicDiscoveryScan(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
}

/** Check exact CLI provenance, pinned heads, coverage, and required full-analysis fields before whitelisting facts. */
export function validatePublicDiscoveryOutput(
  raw: unknown,
  metrics: OrgMetrics,
  config: DevexConfig,
  heads: unknown
): PublicDiscoveryScan {
  const document = record(raw, "CLI output");
  if (document.schema_version !== 1) throw new Error("Unsupported CLI discovery schema");
  const provenance = record(document.provenance, "provenance");
  if (
    provenance.source !== "local_git" ||
    provenance.analysis !== "full" ||
    provenance.snapshot !== "pinned_head" ||
    provenance.stale_after_days !== config.collection.landscapeStaleAfterDays
  )
    throw new Error("Public discovery requires pinned local_git/full provenance");
  const names = selectPublicDiscovery(metrics, config)
    .map((repo) => repo.fullName)
    .sort();
  if (names.length === 0) throw new Error("Public discovery has no nonempty eligible selection");
  const selection = record(document.selection, "selection");
  if (
    selection.mode !== "explicit" ||
    !sameNames(selection.explicit_repositories, names) ||
    !sameNames(selection.selected_repositories, names) ||
    !Array.isArray(selection.discovery) ||
    selection.discovery.length !== 0
  )
    throw new Error("Public discovery CLI selection differs from the DevEx snapshot");
  const expected = record(heads, "expected heads");
  if (
    !sameNames(Object.keys(expected), names) ||
    Object.values(expected).some((sha) => typeof sha !== "string" || !SHA.test(sha))
  )
    throw new Error("Public discovery expected heads differ from the selected repositories");
  if (!Array.isArray(document.repositories) || document.repositories.length !== names.length)
    throw new Error("Public discovery CLI must cover every selected repository");
  const rawRepositories: unknown[] = document.repositories;
  const byName = new Map(names.map((repo) => [repo.toLowerCase(), repo]));
  const seen = new Set<string>();
  const repositories = rawRepositories.map((value: unknown) => {
    const item = record(value, "CLI repository");
    const fullName = name(item.full_name, "CLI full_name");
    const key = fullName.toLowerCase();
    if (
      !byName.has(key) ||
      seen.has(key) ||
      item.status !== undefined ||
      item.head_sha !== expected[byName.get(key)!]
    )
      throw new Error(
        "Public discovery CLI returned an unknown, unavailable, duplicate or unpinned repository"
      );
    seen.add(key);
    if (
      !Array.isArray(item.analysis_warnings) ||
      item.analysis_warnings.length ||
      !Array.isArray(item.manifests) ||
      !Array.isArray(item.produces) ||
      !Array.isArray(item.consumes) ||
      !Array.isArray(item.languages)
    )
      throw new Error("Public discovery CLI full analysis is missing or partial");
    const metrics = record(item.metrics, "CLI metrics");
    const git = record(item.git, "CLI git");
    const architecture = record(item.architecture, "CLI architecture");
    const languages = item.languages.map(language).sort(compareLanguages).slice(0, 5);
    return {
      full_name: byName.get(key),
      head_sha: item.head_sha,
      files: metrics.files,
      bytes: metrics.bytes,
      source_loc: metrics.source_loc,
      languages,
      commits_30d: git.commits_30d,
      commits_90d: git.commits_90d,
      commits_90d_trend: git.commits_90d_trend,
      contributor_count: git.contributor_count,
      adr_count: architecture.adr_count,
      manifest_count: item.manifests.length,
      produces_count: item.produces.length,
      consumes_count: item.consumes.length,
    };
  });
  if (!Array.isArray(document.edges))
    throw new Error("Public discovery CLI edges must be an array");
  const connections = document.edges
    .flatMap((value: unknown) => {
      const edge = record(value, "CLI edge");
      const source = name(edge.source, "edge source");
      const target = name(edge.target, "edge target");
      if (
        !byName.has(source.toLowerCase()) ||
        !byName.has(target.toLowerCase()) ||
        edge.kind !== "artifact dependency" ||
        edge.confidence !== "medium" ||
        !Array.isArray(edge.evidence)
      )
        throw new Error("Public discovery CLI connection is not a selected heuristic edge");
      const sourceRepo = rawRepositories.find(
        (r: unknown) => record(r, "CLI repository").full_name === source
      ) as Record<string, unknown>;
      const targetRepo = rawRepositories.find(
        (r: unknown) => record(r, "CLI repository").full_name === target
      ) as Record<string, unknown>;
      const evidence = edge.evidence
        .flatMap((value: unknown) => {
          const match = record(value, "CLI evidence");
          // A synthetic repository-name match has no matched file evidence; do not publish it.
          const consumes = sourceRepo.consumes as unknown[];
          const produces = targetRepo.produces as unknown[];
          if (
            !consumes.some((item) => {
              const e = record(item, "consumed artifact");
              return e.source === match.consumer_file && e.name === match.consumed;
            }) ||
            !produces.some((item) => {
              const e = record(item, "produced artifact");
              return e.source === match.producer_file && e.name === match.produced;
            })
          )
            return [];
          return [
            {
              consumer_file: safePath(match.consumer_file, "consumer file"),
              producer_file: safePath(match.producer_file, "producer file"),
            },
          ];
        })
        .slice(0, 2);
      return evidence.length
        ? [
            {
              source: byName.get(source.toLowerCase()),
              target: byName.get(target.toLowerCase()),
              evidence,
            },
          ]
        : [];
    })
    .slice(0, MAX_CONNECTIONS);
  const scan = parsePublicDiscoveryScan({
    schema_version: 1,
    generated_at: document.generated_at,
    scanner_version: document.scanner_version,
    repositories,
    connections,
  });
  if (
    scan.scanner_version !== installedLandscapeScannerVersion() ||
    Date.parse(scan.generated_at) < Math.floor(Date.parse(metrics.collectedAt) / 1000) * 1000 ||
    Date.parse(scan.generated_at) > Date.now() + 60_000
  )
    throw new Error("Public discovery scanner version or observation time is inconsistent");
  return scan;
}

/** Persist only the independently sanitized contract, retaining at most fourteen snapshots. */
export function savePublicDiscoveryScan(
  dir: string,
  metrics: OrgMetrics,
  scan: PublicDiscoveryScan
): void {
  scan = parsePublicDiscoveryScan(scan);
  const latest = discoveryLatestPath(dir, metrics.owner);
  if (fs.existsSync(latest) && readScan(latest).generated_at > scan.generated_at)
    throw new Error("Public discovery observation predates the stored latest");
  const folder = snapshotDir(dir, metrics.owner);
  fs.mkdirSync(folder, { recursive: true });
  const filename = scan.generated_at.replace(/[:.]/g, "-") + ".json";
  const snapshot = path.join(folder, filename);
  const contents = JSON.stringify(scan, null, 2) + "\n";
  if (fs.existsSync(snapshot) && fs.readFileSync(snapshot, "utf8") !== contents)
    throw new Error("Public discovery snapshot already exists with different content");
  fs.writeFileSync(snapshot, contents);
  fs.writeFileSync(`${latest}.tmp`, contents);
  fs.renameSync(`${latest}.tmp`, latest);
  for (const older of fs
    .readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .slice(0, -14))
    fs.unlinkSync(path.join(folder, older));
}

/** Remove every observation/connection in both latest and retained snapshots that is no longer eligible. */
export function scrubPublicDiscovery(dir: string, owner: string, keep: readonly string[]): number {
  const allowed = new Set(keep.map((item) => item.toLowerCase()));
  const folder = snapshotDir(dir, owner);
  const files = [
    discoveryLatestPath(dir, owner),
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
    const repositories = scan.repositories.filter((repo) =>
      allowed.has(repo.full_name.toLowerCase())
    );
    if (repositories.length === scan.repositories.length) continue;
    removed += scan.repositories.length - repositories.length;
    const connections = scan.connections.filter(
      (edge) => allowed.has(edge.source.toLowerCase()) && allowed.has(edge.target.toLowerCase())
    );
    fs.writeFileSync(
      `${file}.tmp`,
      JSON.stringify({ ...scan, repositories, connections }, null, 2) + "\n"
    );
    fs.renameSync(`${file}.tmp`, file);
  }
  return removed;
}

export function savePublicDiscoveryStatus(dir: string, owner: string, ok: boolean): void {
  const file = statusFile(dir, owner);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    `${file}.tmp`,
    JSON.stringify({ attempted_at: new Date().toISOString(), ok }, null, 2) + "\n"
  );
  fs.renameSync(`${file}.tmp`, file);
}

export function loadPublicDiscoveryStatus(
  dir: string,
  owner: string
): PublicDiscoveryRunStatus | undefined {
  const file = statusFile(dir, owner);
  if (!fs.existsSync(file)) return undefined;
  const status = record(JSON.parse(fs.readFileSync(file, "utf8")) as unknown, "status");
  if (typeof status.ok !== "boolean") throw new Error("Public discovery status must be boolean");
  const latest = discoveryLatestPath(dir, owner);
  return {
    attempted_at: iso(status.attempted_at, "attempted_at"),
    ok: status.ok,
    last_success_at: fs.existsSync(latest) ? readScan(latest).generated_at : null,
  };
}

/** Unknown rows are explicit for all unselected repositories; deltas compare successful observations only. */
export function loadPublicDiscoveryView(
  dir: string,
  metrics: OrgMetrics,
  config: DevexConfig
): {
  rows: PublicDiscoveryRepoView[];
  connections: PublicDiscoveryConnection[];
  status?: PublicDiscoveryRunStatus;
} {
  const latest = discoveryLatestPath(dir, metrics.owner);
  const scan = fs.existsSync(latest) ? readScan(latest) : undefined;
  const selected = new Set(
    selectPublicDiscovery(metrics, config).map((repo) => repo.fullName.toLowerCase())
  );
  const observations = new Map(
    scan?.repositories.map((repo) => [repo.full_name.toLowerCase(), repo]) ?? []
  );
  const previous = new Map<string, { repo: PublicDiscoveryRepository; time: string }>();
  const folder = snapshotDir(dir, metrics.owner);
  if (scan && fs.existsSync(folder)) {
    for (const file of fs
      .readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()) {
      const prior = readScan(path.join(folder, file));
      if (prior.generated_at >= scan.generated_at) continue;
      for (const repo of prior.repositories) {
        const key = repo.full_name.toLowerCase();
        if (!previous.has(key)) previous.set(key, { repo, time: prior.generated_at });
      }
    }
  }
  const rows: PublicDiscoveryRepoView[] = metrics.repos.map((repo) => {
    const key = repo.fullName.toLowerCase();
    const reason: PublicDiscoveryRepoView["reason"] =
      repo.isPrivate === true
        ? "private"
        : repo.isPrivate !== false
          ? "visibility_unknown"
          : repo.fullName.split("/")[0]?.toLowerCase() !== metrics.owner.toLowerCase()
            ? "cross_owner"
            : repo.sizeKb === 0
              ? "empty"
              : !Number.isSafeInteger(repo.sizeKb) || repo.sizeKb === undefined || repo.sizeKb < 0
                ? "size_unknown"
                : config.collection.publicDiscoveryMaxSizeKb !== 0 &&
                    repo.sizeKb !== undefined &&
                    repo.sizeKb > config.collection.publicDiscoveryMaxSizeKb
                  ? "oversized"
                  : config.collection.publicDiscoveryMaxRepos !== 0 &&
                      !Array.isArray(repo.mergedPRTimeline)
                    ? "ranking_unknown"
                    : !selected.has(key)
                      ? "not_selected"
                      : undefined;
    if (reason) return { fullName: repo.fullName, status: "unknown", reason };
    const observation = observations.get(key);
    if (!observation) return { fullName: repo.fullName, status: "unknown", reason: "not_scanned" };
    const prior = previous.get(key);
    return {
      fullName: repo.fullName,
      status: "observed",
      observation,
      ...(prior
        ? {
            delta: {
              compared_at: prior.time,
              commits_90d: observation.commits_90d - prior.repo.commits_90d,
              source_loc: observation.source_loc - prior.repo.source_loc,
              files: observation.files - prior.repo.files,
            },
          }
        : {}),
    };
  });
  const visible = new Set(
    rows.filter((row) => row.status === "observed").map((row) => row.fullName.toLowerCase())
  );
  return {
    rows,
    connections:
      scan?.connections.filter(
        (edge) => visible.has(edge.source.toLowerCase()) && visible.has(edge.target.toLowerCase())
      ) ?? [],
    status: loadPublicDiscoveryStatus(dir, metrics.owner),
  };
}

/** Re-verify visibility with a token before storing anything or after failure. */
export async function recheckPublicDiscovery(
  dir: string,
  metrics: OrgMetrics,
  config: DevexConfig,
  octokit: Pick<Octokit, "rest">
): Promise<string[]> {
  const selected = selectPublicDiscovery(metrics, config).map((repo) => repo.fullName);
  const unverified = await unverifiedLandscapeRepositories(selected, octokit);
  if (unverified.length)
    scrubPublicDiscovery(
      dir,
      metrics.owner,
      selected.filter((name) => !unverified.includes(name))
    );
  return unverified;
}

/** Use the same newest DevEx-selected snapshot as the existing landscape adapter. */
export function loadPublicDiscoverySelection(dir: string, owner: string): OrgMetrics {
  return loadLandscapeSelection(dir, owner);
}
