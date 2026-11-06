import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { Octokit } from "@octokit/rest";
import {
  compareLandscape, loadLandscapeView, parseLandscapeScan, saveLandscapeScan,
  validateLandscapeScannerOutput,
} from "./landscape.js";
import { enrichLandscapeScan } from "./landscape-signals.js";
import {
  parsePublicDiscoveryScan, scrubPublicDiscovery, savePublicDiscoveryScan,
  loadPublicDiscoveryView, validatePublicDiscoveryOutput,
} from "./public-discovery.js";
import { defaultConfig } from "./config.js";
import {
  landscapeCapabilities, landscapeCapabilityWarnings, landscapeContentReason,
  landscapeDetailSummary, parseLandscapeActivity, parseLandscapeAttention, parseLandscapeTeamActivity,
} from "./landscape-contract.js";
import type { LandscapeRepository, OrgMetrics, RepoMetrics } from "./types.js";
import type * as LandscapeModule from "./landscape.js";

vi.mock("./landscape.js", async (importOriginal) => ({
  ...await importOriginal<typeof LandscapeModule>(),
  installedLandscapeScannerVersion: () => "0.2.0",
}));

function fixture(mode: "api" | "local"): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(
    new URL(`./fixtures/landscape-readiness-${mode}-v1.json`, import.meta.url), "utf8"
  )) as Record<string, unknown>;
}

function selection(names: string[]): OrgMetrics {
  return {
    owner: "example", ownerType: "org", collectedAt: "2026-10-01T11:59:00Z",
    repoCount: names.length,
    repos: names.map((fullName): RepoMetrics => ({
      name: fullName.split("/")[1], fullName, isPrivate: false, sizeKb: 1,
      mergedPRTimeline: [], issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, closed: 0, merged: 0 }, pullRequestDetails: [],
      committerCount: 0, reviewerCount: 0, contributorCount: 0, dependentCount: 0,
    })),
  };
}

function observed(raw: unknown): LandscapeRepository {
  const repo = parseLandscapeScan(raw).repositories[0];
  if (!("head_sha" in repo)) throw new Error("Expected successful observation");
  return repo;
}

describe("bounded portable fact validators", () => {
  it("accepts absent legacy capabilities and strips unknown identifiers without retaining diagnostics", () => {
    expect(landscapeCapabilities(undefined)).toBeUndefined();
    expect(landscapeCapabilities(["activity_windows_v1", "future_extension_v1", "activity_windows_v1"]))
      .toEqual(["activity_windows_v1"]);
    for (const value of [null, {}, "activity_windows_v1", [1], ["unsafe diagnostic text"], Array(101).fill("a")])
      expect(() => landscapeCapabilities(value)).toThrow(/capabilities/);
    expect(landscapeCapabilityWarnings(undefined)).toBeUndefined();
    expect(landscapeCapabilityWarnings([])).toEqual([]);
    for (const value of [null, {}, "text", [1], ["source text"]])
      expect(() => landscapeCapabilityWarnings(value)).toThrow(/fixed caveats/);
  });

  it.each([undefined, null, {}, [], "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    "rejects malformed elapsed commit counts %s", (value) => {
      expect(() => parseLandscapeActivity({ complete: true, commits_30d: value, commits_90d: 10 }))
        .toThrow();
    }
  );

  it("distinguishes known zeros from incomplete windows and rejects contradictory coverage", () => {
    expect(parseLandscapeActivity({ complete: true, commits_30d: 0, commits_90d: 0 }))
      .toEqual({ complete: true, commits_30d: 0, commits_90d: 0 });
    expect(parseLandscapeActivity({ complete: false, commits_30d: null, commits_90d: null,
      unknown_reason: "Activity reaches the 500-commit API budget without proving completeness" }))
      .toMatchObject({ complete: false, commits_30d: null, commits_90d: null });
    for (const raw of [
      null, [], {}, { complete: 1, commits_30d: 1, commits_90d: 1 },
      { complete: true, commits_30d: 2, commits_90d: 1 },
      { complete: true, commits_30d: 1, commits_90d: null },
      { complete: false, commits_30d: null, commits_90d: 0 },
      { complete: true, commits_30d: 0, commits_90d: 0, unknown_reason: "unavailable" },
      { complete: false, commits_30d: null, commits_90d: null, unknown_reason: "source text" },
    ]) expect(() => parseLandscapeActivity(raw)).toThrow();
  });

  it("accepts unavailable exact-email attribution without treating it as verified zero", () => {
    const unavailable = { available: false, complete: false, matching: "unavailable",
      commit_count: null, commits_30d: null, commits_90d: null };
    for (const reason of ["No explicit team author emails configured",
      "API linked-author team attribution remains caller enrichment", "Local Git author attribution is incomplete"]) {
      expect(parseLandscapeTeamActivity({ ...unavailable, unknown_reason: reason }))
        .toMatchObject({ ...unavailable, unknown_reason: reason });
    }
    const known = { available: true, complete: true, matching: "exact_author_email",
      commit_count: 3, commits_30d: 1, commits_90d: 2 };
    expect(parseLandscapeTeamActivity(known)).toEqual(known);
    for (const raw of [
      { ...known, available: false }, { ...known, matching: "github_login" },
      { ...known, commit_count: null }, { ...known, commit_count: 1 },
      { ...unavailable, commit_count: 0 }, { ...unavailable, unknown_reason: "source text" },
      { ...known, unknown_reason: "No explicit team author emails configured" },
    ]) expect(() => parseLandscapeTeamActivity(raw)).toThrow();
    expect(() => parseLandscapeTeamActivity(known, { complete: true, commits_30d: 0, commits_90d: 2 }))
      .toThrow(/coverage/);
    expect(() => parseLandscapeTeamActivity(known, { complete: true, commits_30d: 1, commits_90d: 1 }))
      .toThrow(/coverage/);
  });

  it("admits only fixed content and attention explanations and supported rule bands", () => {
    for (const reason of ["Content exceeds 64 KiB scoring limit", "Content is not strict UTF-8",
      "Per-repository 200-file scoring budget exceeded", "Global 150-repository / 1000-file scoring budget exceeded"])
      expect(landscapeContentReason(reason)).toBe(reason);
    for (const reason of ["source content", null, 5])
      expect(() => landscapeContentReason(reason)).toThrow(/fixed explanation/);
    for (const band of ["high", "medium", "low", "unknown"])
      expect(parseLandscapeAttention({ activity: band, priority: band, reasons: [] }))
        .toEqual({ activity: band, priority: band, reasons: [] });
    for (const raw of [null, {}, { activity: "invalid", priority: "low", reasons: [] },
      { activity: "low", priority: "invalid", reasons: [] },
      { activity: "low", priority: "low", reasons: ["source text"] }])
      expect(() => parseLandscapeAttention(raw)).toThrow();
    expect(landscapeDetailSummary([])).toMatchObject({
      min_age_days: null, max_age_days: null, min_lag_days: null, min_commits_since: null,
      max_commits_since: null, content_signal_mean: null, content_scored_count: 0,
    });
  });
});

describe("additive schema-1 readiness compatibility", () => {
  let root: string;
  beforeEach(() => {
    fs.mkdirSync("data", { recursive: true });
    root = fs.mkdtempSync(path.resolve("data", "landscape-parity-test-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("accepts actual generated API output, preserving portable facts without duplicate API calls", async () => {
    const raw = fixture("api");
    const data = selection(["example/widget"]);
    const scan = validateLandscapeScannerOutput(raw, data, 10, "0.2.0");
    const graphql = vi.fn();
    const getContent = vi.fn();
    const enriched = await enrichLandscapeScan(scan,
      { graphql, rest: { repos: { getContent } } } as unknown as Octokit);
    expect(graphql).not.toHaveBeenCalled();
    expect(getContent).not.toHaveBeenCalled();
    expect(observed(enriched)).toMatchObject({
      activity: { commits_30d: 2, commits_90d: 2, complete: true },
      team_activity: { available: false, matching: "unavailable", commits_90d: null },
      ai_files: [{ commits_since: 1, commits_since_change: 2, content_signal: { score: 100 } }],
      ai_summary: { history_known_count: 1, content_signal_mean: 100, content_scored_count: 1 },
      attention: { priority: "medium" },
    });
    expect(observed(enriched).ai_summary.by_kind).toHaveLength(13);
    saveLandscapeScan(root, data, raw, enriched);
    expect(loadLandscapeView(root, data)[0]).toMatchObject({
      commits30d: 2, commits90d: 2, qualityScore: 100, teamCommits30d: null,
      files: [{ commits_since: 1, commits_since_change: 2 }],
    });
    expect(JSON.stringify(enriched)).not.toMatch(/blob_sha|last_commit_sha|author_email/);
  });

  it("ignores undeclared new fields and keeps legacy measurements unavailable, never zero", () => {
    const raw = fixture("api");
    delete raw.provenance;
    const repo = observed(raw);
    expect(repo.ai_files[0].commits_since).toBeUndefined();
    expect(repo.ai_files[0].content_signal).toBeUndefined();
    expect(repo.activity).toBeUndefined();
    expect(repo.attention).toBeUndefined();
    expect(repo.ai_summary.by_kind).toBeUndefined();
  });

  it("preserves portable content and counts when authenticated roster enrichment is inaccessible", async () => {
    const raw = fixture("api");
    const graphql = vi.fn().mockRejectedValue({ status: 403 });
    const enriched = await enrichLandscapeScan(parseLandscapeScan(raw), { graphql } as unknown as Octokit, ["alice"]);
    expect(enriched.repositories[0]).toMatchObject({
      commits_30d: 2, commits_90d: 2, team_commits_90d: null,
      ai_files: [{ commits_since: 1, commits_since_change: 2, content_signal: { score: 100 } }],
    });
    saveLandscapeScan(root, selection(["example/widget"]), raw, enriched);
  });

  it("reports partial scoring as null mean, validates empty-kind coverage and strips unapproved text", () => {
    const raw = fixture("api");
    const repo = (raw.repositories as Record<string, unknown>[])[0];
    const file = (repo.ai_files as Record<string, unknown>[])[0];
    file.content_signal = null;
    file.content_signal_reason = "Content exceeds 64 KiB scoring limit";
    file.content = "DO NOT RETAIN";
    const summary = repo.ai_summary as Record<string, unknown>;
    summary.content_scored_count = 0;
    summary.content_signal_mean = null;
    expect(observed(raw).ai_summary.content_signal_mean).toBeNull();
    expect(JSON.stringify(parseLandscapeScan(raw))).not.toContain("DO NOT RETAIN");
    (summary.by_kind as Record<string, unknown>[])[0].count = 1;
    expect(() => parseLandscapeScan(raw)).toThrow(/by_kind disagrees/);
    const unsafe = fixture("api");
    unsafe.capability_warnings = ["DO NOT RETAIN"];
    expect(() => parseLandscapeScan(unsafe)).toThrow(/recognized fixed/);
  });

  it("rejects malformed or contradictory optional facts instead of recording healthy defaults", () => {
    const change = (mutate: (repo: Record<string, unknown>) => void) => {
      const raw = fixture("api");
      mutate((raw.repositories as Record<string, unknown>[])[0]);
      return () => parseLandscapeScan(raw);
    };
    expect(change((repo) => { repo.activity = { complete: false, commits_30d: 0, commits_90d: 0 }; }))
      .toThrow(/coverage/);
    expect(change((repo) => { repo.team_activity = {
      complete: true, available: true, matching: "github_login",
      commit_count: 1, commits_30d: 1, commits_90d: 1,
    }; })).toThrow(/author-email/);
    expect(change((repo) => {
      (repo.ai_summary as Record<string, unknown>).content_scored_count = 0;
    })).toThrow(/disagrees/);
    expect(change((repo) => { repo.attention = { activity: "low", priority: "high", reasons: ["SOURCE CONTENT"] }; }))
      .toThrow(/fixed explanations/);
  });

  it("fills missing inclusive counts with authenticated history without substituting graph drift", async () => {
    const raw = fixture("api");
    const repo = (raw.repositories as Record<string, unknown>[])[0];
    const file = (repo.ai_files as Record<string, unknown>[])[0];
    file.commits_since_change = null;
    delete (repo.ai_summary as Record<string, unknown>).commits_since_change_known_count;
    const graphql = vi.fn(async () => ({
      repository: { nameWithOwner: "example/widget", isPrivate: false,
        object: { oid: repo.head_sha, month: { totalCount: 2 }, recent: { totalCount: 2 },
          file0: { totalCount: 2 } } },
    }));
    const getContent = vi.fn();
    const scan = parseLandscapeScan(raw);
    const enriched = await enrichLandscapeScan(scan,
      { graphql, rest: { repos: { getContent } } } as unknown as Octokit);
    saveLandscapeScan(root, selection(["example/widget"]), raw, enriched);
    expect(observed(enriched).ai_files[0]).toMatchObject({ commits_since: 1, commits_since_change: 2 });
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(getContent).not.toHaveBeenCalled();
    expect(observed(scan).ai_files[0].commits_since_change).toBeNull();
    const tampered = structuredClone(enriched);
    const changed = tampered.repositories[0] as LandscapeRepository;
    changed.ai_files[0].commits_since = 2;
    Object.assign(changed.ai_summary, landscapeDetailSummary(changed.ai_files));
    expect(() => saveLandscapeScan(root, selection(["example/widget"]), raw, tampered)).toThrow(/portable/);
  });

  it("keeps unavailable facts null when comparing to a legacy baseline", () => {
    const raw = fixture("api");
    const current = observed(raw);
    delete raw.provenance;
    const previous = observed(raw);
    const delta = compareLandscape(current, previous, "2026-09-01T00:00:00Z");
    expect(delta.file_deltas).toEqual([{
      path: "AGENTS.md", age_days: 0, lag_days: 0,
      commits_since: null, commits_since_change: null, content_score: null,
    }]);
    expect(delta.content_changed).toEqual([]);
  });

  it("recovers missing API path timestamps at the pinned public head within the enrichment budget", async () => {
    const raw = fixture("api");
    const repo = (raw.repositories as Record<string, unknown>[])[0];
    const file = (repo.ai_files as Record<string, unknown>[])[0];
    Object.assign(file, { last_changed: null, age_days: null, lag_days: null, stale: null,
      status: "unknown", commits_since: null, commits_since_change: null });
    repo.ai_summary = { count: 1, stale_count: 0, max_lag_days: null,
      unknown_count: 1, status: "partial_unknown" };
    const graphql = vi.fn(async (query: string) => ({
      repository: { nameWithOwner: "example/widget", isPrivate: false,
        object: { oid: repo.head_sha, ...(query.includes("path0:history")
          ? { committedDate: "2026-09-20T12:00:00Z",
            path0: { nodes: [{ committedDate: "2026-09-01T12:00:00Z" }] } }
          : { month: { totalCount: 2 }, recent: { totalCount: 2 }, file0: { totalCount: 2 } }) } },
    }));
    const enriched = await enrichLandscapeScan(parseLandscapeScan(raw),
      { graphql } as unknown as Octokit, [], 10);
    expect(observed(enriched).ai_files[0]).toMatchObject({
      last_changed: "2026-09-01T12:00:00.000Z", age_days: 30, lag_days: 19, stale: true,
      status: "known", commits_since: null, commits_since_change: 2,
    });
    expect(graphql).toHaveBeenCalledTimes(2);
    saveLandscapeScan(root, selection(["example/widget"]), raw, enriched);
    const stale = structuredClone(enriched);
    (stale.repositories[0] as LandscapeRepository).ai_files[0].sha256 = "f".repeat(64);
    expect(() => saveLandscapeScan(root, selection(["example/widget"]), raw, stale)).toThrow(/differs/);
  });

  it("accepts actual full-local output, keeping calendar trends and elapsed windows distinct", () => {
    const raw = fixture("local");
    const repositories = raw.repositories as Record<string, unknown>[];
    const data = selection(repositories.map((repo) => repo.full_name as string));
    const heads = Object.fromEntries(repositories.map((repo) => [repo.full_name, repo.head_sha]));
    const config = defaultConfig();
    const scan = validatePublicDiscoveryOutput(raw, data, config, heads);
    expect(scan.repositories[0]).toMatchObject({
      commits_30d: 0,
      activity: { commits_30d: 1, complete: true },
      team_activity: { matching: "exact_author_email", commits_30d: 1 },
    });
    expect(scan.references).toHaveLength(2);
    expect(scan.connections.every((connection) => !("kind" in connection))).toBe(true);
    savePublicDiscoveryScan(root, data, scan);
    const view = loadPublicDiscoveryView(root, data, config);
    expect(view.references).toHaveLength(2);
    scrubPublicDiscovery(root, data.owner, ["example/widget"]);
    expect(loadPublicDiscoveryView(root, data, config).references).toEqual([]);
    expect(JSON.stringify(scan)).not.toMatch(/content_signal|author_email":|README BODY|last_commit_sha/);
  });

  it("rejects full-local references outside selected pinned public heads and parser failures", () => {
    const raw = fixture("local");
    const repositories = raw.repositories as Record<string, unknown>[];
    const data = selection(repositories.map((repo) => repo.full_name as string));
    const heads = Object.fromEntries(repositories.map((repo) => [repo.full_name, repo.head_sha]));
    const config = defaultConfig();
    const scan = validatePublicDiscoveryOutput(raw, data, config, heads);
    const altered = structuredClone(scan);
    altered.references![0].target = "example/private";
    expect(() => parsePublicDiscoveryScan(altered)).toThrow(/selected pinned/);
    altered.references![0] = { ...scan.references![0],
      evidence: { ...scan.references![0].evidence, head_sha: "b".repeat(40) } };
    expect(() => parsePublicDiscoveryScan(altered)).toThrow(/selected pinned/);
    repositories[0].analysis_warnings = [{ path: "package.json", reason: "Malformed JSON" }];
    expect(() => validatePublicDiscoveryOutput(raw, data, config, heads)).toThrow(/missing or partial/);
  });

  it("runs the installed 0.2.0 CLI against pinned local Git checkouts and validates its output", () => {
    const names = ["example/consumer", "example/widget"];
    const repositoriesDir = path.join(root, "clones");
    const heads: Record<string, string> = {};
    for (const fullName of names) {
      const checkout = path.join(repositoriesDir, ...fullName.split("/"));
      fs.mkdirSync(checkout, { recursive: true });
      fs.writeFileSync(path.join(checkout, "AGENTS.md"),
        "# Scope\nThis repository documents its purpose.\n- Run npm test\n# Checks\nNever skip validation.\n");
      fs.writeFileSync(path.join(checkout, "README.md"),
        fullName === "example/consumer"
          ? "This consumer has a reference to example/widget.\n"
          : "This repository provides its own implementation.\n");
      const git = (args: string[], env: NodeJS.ProcessEnv = {}) => {
        const result = spawnSync("git", args, {
          cwd: checkout, encoding: "utf8", env: { ...process.env, ...env },
        });
        if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
        return result.stdout.trim();
      };
      git(["init", "--initial-branch=main"]);
      git(["config", "user.name", "Integration Test"]);
      git(["config", "user.email", "integration@example.invalid"]);
      git(["remote", "add", "origin", `https://github.com/${fullName}.git`]);
      git(["add", "."]);
      git(["-c", "user.name=Integration Test", "-c", "user.email=integration@example.invalid",
        "commit", "-m", "fixture"], {
        GIT_AUTHOR_DATE: "2026-10-01T12:00:00Z",
        GIT_COMMITTER_DATE: "2026-10-01T12:00:00Z",
      });
      const head = git(["rev-parse", "HEAD"]);
      git(["update-ref", "refs/remotes/origin/main", head]);
      heads[fullName] = head;
    }

    const configPath = path.join(root, "landscape.config.json");
    const headsPath = path.join(root, "heads.json");
    const outputPath = path.join(root, "landscape.json");
    fs.writeFileSync(configPath, JSON.stringify({
      schema_version: 1, repositories: names, stale_after_days: 90,
    }));
    fs.writeFileSync(headsPath, JSON.stringify(heads));
    const bin = path.resolve("node_modules", "@devex-metrics", "repo-landscape",
      "bin", "repo-landscape.mjs");
    const run = spawnSync(process.execPath, [bin, "scan", "--config", configPath,
      "--repos-dir", repositoriesDir, "--expected-heads", headsPath,
      "--output", outputPath, "--as-of", "2026-10-02T12:00:00Z"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 60_000,
    });
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    const actual = JSON.parse(fs.readFileSync(outputPath, "utf8")) as unknown;
    const parsed = validatePublicDiscoveryOutput(actual, selection(names), defaultConfig(), heads);
    expect(parsed.scanner_version).toBe("0.2.0");
    expect(parsed.repositories).toHaveLength(2);
    expect(parsed.repositories.every((repo) => repo.activity?.complete)).toBe(true);
    expect(parsed.repositories.every((repo) => repo.team_activity?.matching === "unavailable")).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("integration@example.invalid");
    expect(parsed.connections).toEqual([]);
    expect(parsed.references).toContainEqual({
      source: "example/consumer", target: "example/widget",
      kind: "repository reference", confidence: "low",
      evidence: { path: "README.md", line: 1, head_sha: heads["example/consumer"] },
    });
  }, 30_000);
});
