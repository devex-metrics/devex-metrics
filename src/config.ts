/**
 * Deployment configuration for devex-metrics.
 *
 * A deployment is configured entirely through **GitHub Actions variables** —
 * no file needs to be committed. `devex.config.example.json` documents the
 * full shape and doubles as a starting point for local development.
 *
 * Resolution order (later wins):
 *   1. Built-in defaults
 *   2. A config file — `DEVEX_CONFIG_FILE`, else `devex.config.json` in cwd
 *   3. `DEVEX_CONFIG` — the whole config as a JSON string (one Actions variable)
 *   4. Discrete `DEVEX_*` environment variables (easiest to edit in the UI)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { OrgMetrics, TeamSummary, TrialSummary } from "./types.js";

/** Which repositories to collect for a scope. */
export interface RepoFilterConfig {
  /** Glob patterns to keep. Empty means "every discovered repo". */
  include: string[];
  /** Glob patterns to drop. Applied after `include`. */
  exclude: string[];
  /** Skip archived repositories. */
  excludeArchived: boolean;
  /** Skip forks. */
  excludeForks: boolean;
  /** Skip repos with no push in this many days. 0 disables the cutoff. */
  maxIdleDays: number;
}

/** The set of repos an improvement trial is being run with. */
export interface TeamConfig {
  /** Stable identifier used in history rows and share URLs. */
  id: string;
  /** Display name shown in the dashboard. */
  name: string;
  /** Glob patterns matching the team's repositories. */
  repos: string[];
  /**
   * When true, collect every repo the owner has (subject to `repos` filters)
   * so the whole org forms the baseline, and flag the team subset within it.
   * When false, only the team's repos are collected.
   */
  discoverAll: boolean;
}

/** A dated milestone within a trial. */
export interface TrialMilestone {
  /** ISO-8601 date (YYYY-MM-DD). */
  date: string;
  /** Short label rendered on the chart annotation. */
  label: string;
}

/** An improvement trial: a dated, falsifiable claim about a team's metrics. */
export interface TrialConfig {
  /** Headline shown above the comparison, e.g. "Trunk-based development". */
  title: string;
  /** What the intervention is expected to change. */
  hypothesis?: string;
  /** ISO-8601 date the intervention started. */
  interventionStart?: string;
  /** Start of the baseline window (ISO-8601 date). */
  baselineFrom?: string;
  /** End of the baseline window (ISO-8601 date). */
  baselineTo?: string;
  /** Dated milestones rendered as secondary annotations. */
  milestones: TrialMilestone[];
}

/** Site branding. */
export interface BrandingConfig {
  /** Page title and H1. */
  title: string;
  /** Attribution line in the header. */
  attribution: string;
  /** Where the attribution links to. */
  attributionUrl: string;
}

/** Optional, cost-bearing collectors. */
export interface FeatureFlags {
  /** Dependent-repo count (scrapes github.com HTML; off by default). */
  dependents: boolean;
  /** Copilot agent task metrics (needs COPILOT_AGENT_TOKEN). */
  copilotAgent: boolean;
}

/**
 * Progressive historical backfill.
 *
 * The daily collection stops at a two-year cutoff to stay cheap. The backfill
 * walks each repository from its first pull request forward, a bounded number
 * of pages per run, until the whole history is in the event stream.
 */
export interface BackfillConfig {
  /** Whether to spend any budget on historical crawling. */
  enabled: boolean;
  /** Maximum GraphQL pages to fetch per run, across all repositories. */
  pagesPerRun: number;
  /** Maximum pages one repository may take per run, so none starves the rest. */
  maxPagesPerRepo: number;
  /**
   * Rebuild historical rollup rows from the event stream after crawling.
   * Cheap (no API calls) but rewrites the rollup file, so it can be turned off
   * for a run that only needs to advance the crawl.
   */
  recomputeRollups: boolean;
}

/** Collection tuning. */
export interface CollectionConfig {
  /** Weeks of weekly-trend history to build. */
  historyWeeks: number;
  /** Maximum pages of merged PRs to walk per repo. */
  maxPRPages: number;
  /** Hours before a per-repo cache entry is considered stale. */
  maxRepoAgeHours: number;
  features: FeatureFlags;
  backfill: BackfillConfig;
}

/** Long-term history store settings. */
export interface HistoryConfig {
  /** Whether to append rollups and events to the history store. */
  enabled: boolean;
  /**
   * Directory the history store lives in. In CI this points at a checkout of
   * the `metrics-data` branch, so nothing lands on the default branch.
   */
  dir: string;
}

/** Fully resolved deployment configuration. */
export interface DevexConfig {
  owner: string;
  ownerType: "org" | "user";
  branding: BrandingConfig;
  repos: RepoFilterConfig;
  team?: TeamConfig;
  trial?: TrialConfig;
  collection: CollectionConfig;
  history: HistoryConfig;
}

/** Built-in defaults. Every field is overridable. */
export function defaultConfig(): DevexConfig {
  return {
    owner: "",
    ownerType: "org",
    branding: {
      title: "DevEx Metrics",
      attribution: "Made with ❤️ by rajbos",
      attributionUrl: "https://github.com/rajbos",
    },
    repos: {
      include: [],
      exclude: [],
      excludeArchived: true,
      excludeForks: false,
      maxIdleDays: 0,
    },
    collection: {
      historyWeeks: 104,
      maxPRPages: 10,
      maxRepoAgeHours: 8,
      features: { dependents: false, copilotAgent: true },
      backfill: {
        enabled: true,
        pagesPerRun: 200,
        maxPagesPerRepo: 20,
        recomputeRollups: true,
      },
    },
    history: { enabled: true, dir: "data/history" },
  };
}

// ── env helpers ───────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Parse a comma-, semicolon- or newline-separated list. */
export function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // An explicitly empty variable clears the list rather than being ignored.
  return items;
}

function list(env: Env, key: string): string[] | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  return parseList(raw);
}

function bool(env: Env, key: string): boolean | undefined {
  const v = str(env, key);
  if (v === undefined) return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

function int(env: Env, key: string): number | undefined {
  const v = str(env, key);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function assign<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

// ── glob matching ─────────────────────────────────────────────────────────────

/**
 * Compile a glob into a RegExp. Supports `*` (any run of characters) and `?`
 * (a single character); every other character is matched literally.
 */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

/**
 * Test a repository against a list of globs. Each glob is matched against both
 * the bare repo name and the `owner/name` full name, so either form works in
 * configuration.
 */
export function matchesGlobs(
  fullName: string,
  globs: readonly string[]
): boolean {
  if (globs.length === 0) return false;
  const slash = fullName.indexOf("/");
  const bare = slash >= 0 ? fullName.slice(slash + 1) : fullName;
  return globs.some((g) => {
    const re = globToRegExp(g);
    return re.test(fullName) || re.test(bare);
  });
}

// ── loading ───────────────────────────────────────────────────────────────────

/** Deep-merge a partial config (from a file or JSON variable) into `target`. */
function mergePartial(target: DevexConfig, partial: Partial<DevexConfig>): void {
  assign(target, "owner", partial.owner);
  assign(target, "ownerType", partial.ownerType);
  if (partial.branding) Object.assign(target.branding, partial.branding);
  if (partial.repos) Object.assign(target.repos, partial.repos);
  if (partial.collection) {
    const { features, backfill, ...rest } = partial.collection;
    Object.assign(target.collection, rest);
    if (features) Object.assign(target.collection.features, features);
    if (backfill) Object.assign(target.collection.backfill, backfill);
  }
  if (partial.history) Object.assign(target.history, partial.history);
  if (partial.team) {
    target.team = {
      id: partial.team.id ?? "team",
      name: partial.team.name ?? "Team",
      repos: partial.team.repos ?? [],
      discoverAll: partial.team.discoverAll ?? true,
    };
  }
  if (partial.trial) {
    target.trial = {
      title: partial.trial.title ?? "Improvement trial",
      hypothesis: partial.trial.hypothesis,
      interventionStart: partial.trial.interventionStart,
      baselineFrom: partial.trial.baselineFrom,
      baselineTo: partial.trial.baselineTo,
      milestones: partial.trial.milestones ?? [],
    };
  }
}

/** Overlay the discrete `DEVEX_*` environment variables. */
function applyEnv(config: DevexConfig, env: Env): void {
  assign(config, "owner", str(env, "DEVEX_OWNER"));
  const ownerType = str(env, "DEVEX_OWNER_TYPE");
  if (ownerType === "org" || ownerType === "user") config.ownerType = ownerType;

  assign(config.branding, "title", str(env, "DEVEX_TITLE"));
  assign(config.branding, "attribution", str(env, "DEVEX_ATTRIBUTION"));
  assign(config.branding, "attributionUrl", str(env, "DEVEX_ATTRIBUTION_URL"));

  assign(config.repos, "include", list(env, "DEVEX_REPOS_INCLUDE"));
  assign(config.repos, "exclude", list(env, "DEVEX_REPOS_EXCLUDE"));
  assign(config.repos, "excludeArchived", bool(env, "DEVEX_EXCLUDE_ARCHIVED"));
  assign(config.repos, "excludeForks", bool(env, "DEVEX_EXCLUDE_FORKS"));
  assign(config.repos, "maxIdleDays", int(env, "DEVEX_MAX_IDLE_DAYS"));

  assign(config.collection, "historyWeeks", int(env, "DEVEX_HISTORY_WEEKS"));
  assign(config.collection, "maxPRPages", int(env, "DEVEX_MAX_PR_PAGES"));
  assign(config.collection, "maxRepoAgeHours", int(env, "DEVEX_MAX_REPO_AGE_HOURS"));
  assign(config.collection.features, "dependents", bool(env, "DEVEX_FEATURE_DEPENDENTS"));
  assign(config.collection.features, "copilotAgent", bool(env, "DEVEX_FEATURE_COPILOT_AGENT"));

  assign(config.collection.backfill, "enabled", bool(env, "DEVEX_BACKFILL_ENABLED"));
  assign(config.collection.backfill, "pagesPerRun", int(env, "DEVEX_BACKFILL_PAGES_PER_RUN"));
  assign(config.collection.backfill, "maxPagesPerRepo", int(env, "DEVEX_BACKFILL_MAX_PAGES_PER_REPO"));
  assign(config.collection.backfill, "recomputeRollups", bool(env, "DEVEX_BACKFILL_RECOMPUTE"));

  assign(config.history, "enabled", bool(env, "DEVEX_HISTORY_ENABLED"));
  assign(config.history, "dir", str(env, "DEVEX_HISTORY_DIR"));

  const teamRepos = list(env, "DEVEX_TEAM_REPOS");
  const teamName = str(env, "DEVEX_TEAM_NAME");
  const teamId = str(env, "DEVEX_TEAM_ID");
  const discoverAll = bool(env, "DEVEX_DISCOVER_ALL");
  if (teamRepos !== undefined || teamName || teamId || discoverAll !== undefined) {
    const team: TeamConfig = config.team ?? {
      id: "team",
      name: "Team",
      repos: [],
      discoverAll: true,
    };
    assign(team, "repos", teamRepos);
    assign(team, "name", teamName);
    assign(team, "id", teamId);
    assign(team, "discoverAll", discoverAll);
    if (!teamId && teamName && !config.team) {
      team.id = teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    config.team = team;
  }

  const trialTitle = str(env, "DEVEX_TRIAL_TITLE");
  const interventionStart = str(env, "DEVEX_TRIAL_START");
  const baselineFrom = str(env, "DEVEX_BASELINE_FROM");
  const baselineTo = str(env, "DEVEX_BASELINE_TO");
  const hypothesis = str(env, "DEVEX_TRIAL_HYPOTHESIS");
  const milestones = str(env, "DEVEX_TRIAL_MILESTONES");
  if (trialTitle || interventionStart || baselineFrom || baselineTo || hypothesis || milestones) {
    const trial: TrialConfig = config.trial ?? {
      title: "Improvement trial",
      milestones: [],
    };
    assign(trial, "title", trialTitle);
    assign(trial, "hypothesis", hypothesis);
    assign(trial, "interventionStart", interventionStart);
    assign(trial, "baselineFrom", baselineFrom);
    assign(trial, "baselineTo", baselineTo);
    if (milestones !== undefined) trial.milestones = parseMilestones(milestones);
    config.trial = trial;
  }
}

/**
 * Parse the compact milestone form used by the `DEVEX_TRIAL_MILESTONES`
 * variable: `2026-04-01=Training complete; 2026-05-15=Rollout`.
 */
export function parseMilestones(value: string): TrialMilestone[] {
  return (parseList(value) ?? [])
    .map((entry) => {
      const eq = entry.indexOf("=");
      if (eq <= 0) return null;
      const date = entry.slice(0, eq).trim();
      const label = entry.slice(eq + 1).trim();
      if (!date || !label) return null;
      return { date, label };
    })
    .filter((m): m is TrialMilestone => m !== null);
}

function readConfigFile(filePath: string): Partial<DevexConfig> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<DevexConfig>;
  } catch (err: unknown) {
    throw new Error(`Could not parse config file ${filePath}: ${String(err)}`);
  }
}

/**
 * Resolve the deployment configuration.
 *
 * `env` defaults to `process.env`; pass an explicit object in tests.
 */
export function loadConfig(env: Env = process.env): DevexConfig {
  const config = defaultConfig();

  const explicitFile = str(env, "DEVEX_CONFIG_FILE");
  const filePath = explicitFile
    ? path.resolve(process.cwd(), explicitFile)
    : path.resolve(process.cwd(), "devex.config.json");
  const fromFile = readConfigFile(filePath);
  if (fromFile) {
    console.log(`Loaded configuration from ${filePath}`);
    mergePartial(config, fromFile);
  } else if (explicitFile) {
    throw new Error(`DEVEX_CONFIG_FILE points at a missing file: ${filePath}`);
  }

  const inline = str(env, "DEVEX_CONFIG");
  if (inline) {
    let parsed: Partial<DevexConfig>;
    try {
      parsed = JSON.parse(inline) as Partial<DevexConfig>;
    } catch (err: unknown) {
      throw new Error(`DEVEX_CONFIG is not valid JSON: ${String(err)}`);
    }
    mergePartial(config, parsed);
  }

  applyEnv(config, env);
  return config;
}

/** Throw when the resolved config cannot drive a collection run. */
export function assertUsable(config: DevexConfig): void {
  if (!config.owner) {
    throw new Error(
      "No owner configured. Set the DEVEX_OWNER Actions variable (or `owner` " +
        "in DEVEX_CONFIG / devex.config.json) to a GitHub org or username."
    );
  }
  if (config.team && !config.team.discoverAll && config.team.repos.length === 0) {
    throw new Error(
      "team.discoverAll is false but no team repos are configured — there would " +
        "be nothing to collect. Set DEVEX_TEAM_REPOS or enable DEVEX_DISCOVER_ALL."
    );
  }
}

/** One-line summary of the resolved config, for the run log. */
export function describeConfig(config: DevexConfig): string {
  const parts = [`${config.owner} (${config.ownerType})`];
  if (config.repos.include.length > 0) parts.push(`include=${config.repos.include.join("|")}`);
  if (config.repos.exclude.length > 0) parts.push(`exclude=${config.repos.exclude.join("|")}`);
  if (config.repos.maxIdleDays > 0) parts.push(`maxIdleDays=${config.repos.maxIdleDays}`);
  if (config.team) {
    parts.push(
      `team=${config.team.name} (${config.team.repos.length} pattern(s), ` +
        `${config.team.discoverAll ? "org-wide baseline" : "team only"})`
    );
  }
  if (config.trial) parts.push(`trial="${config.trial.title}"`);
  return parts.join(" · ");
}

/**
 * Re-apply the configured team and trial to an already-collected dataset.
 *
 * Team membership and trial metadata are presentation concerns, not collected
 * facts, so the site build resolves them from the current configuration rather
 * than from whatever was configured when the data was collected. Retitling a
 * trial or re-scoping a team therefore takes effect on the next site build,
 * with no re-collection and no API calls.
 */
export function applyScope(data: OrgMetrics, config: DevexConfig): OrgMetrics {
  const teamGlobs = config.team?.repos ?? [];
  const repos = data.repos.map((repo) => ({
    ...repo,
    isTeamRepo: matchesGlobs(repo.fullName, teamGlobs),
  }));

  const team: TeamSummary | undefined = config.team
    ? {
        id: config.team.id,
        name: config.team.name,
        repos: repos.filter((r) => r.isTeamRepo).map((r) => r.fullName),
        discoverAll: config.team.discoverAll,
      }
    : undefined;

  const trial: TrialSummary | undefined = config.trial
    ? {
        title: config.trial.title,
        hypothesis: config.trial.hypothesis,
        interventionStart: config.trial.interventionStart,
        baselineFrom: config.trial.baselineFrom,
        baselineTo: config.trial.baselineTo,
        milestones: config.trial.milestones,
      }
    : undefined;

  return { ...data, repos, team, trial };
}
