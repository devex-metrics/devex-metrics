import type { LandscapeActivity, LandscapeAttention, LandscapeFile, LandscapeSummary, LandscapeTeamActivity } from "./types.js";

const KINDS = ["agent", "agents", "chatmode", "claude", "copilot_instructions", "cursor",
  "gemini", "mcp", "prompt", "skill", "tool_config", "waza", "windsurf"];
export const LANDSCAPE_CAPABILITY_WARNINGS = [
  "Static content cues measure textual coverage, not quality, effectiveness or tool setup validity",
  "Team attribution is opt-in exact local author-email matching; API linked-author attribution remains caller enrichment",
  "Activity and AI signals may be unknown at request/file budgets; null is not zero",
  "API analysis is AI-only; source inventory, artifact candidates and repository references are not analyzed",
  "References and normalized artifact matches are candidates, not proven runtime topology; telemetry and external registries are not analyzed",
];
const CONTENT_REASONS = [
  "Content exceeds 64 KiB scoring limit", "Content is not strict UTF-8",
  "Per-repository 200-file scoring budget exceeded",
  "Global 150-repository / 1000-file scoring budget exceeded",
];
const ATTENTION_REASONS = ["No AI files discovered", "AI files exceed the configured lag threshold",
  "Readiness evidence is incomplete"];

const CAPABILITIES = new Set([
  "ai_content_cues_v1", "ai_commit_drift_v1", "ai_kind_coverage_v1",
  "activity_windows_v1", "attention_rules_v1", "configured_team_aggregate_v1",
  "repository_references_v1",
]);

/** Retain only explicitly supported additive capabilities, never arbitrary provenance. */
export function landscapeCapabilities(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 ||
      !value.every((item: unknown) => typeof item === "string" && /^[a-z][a-z0-9_]{0,99}$/.test(item)))
    throw new Error("Landscape capabilities must be bounded identifiers");
  const items: unknown[] = value;
  return [...new Set(items.filter((item): item is string =>
    typeof item === "string" && CAPABILITIES.has(item)))].sort();
}

/** Admit fixed caveats only, never repository-derived diagnostic strings. */
export function landscapeCapabilityWarnings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LANDSCAPE_CAPABILITY_WARNINGS.length ||
      value.some((item: unknown) => typeof item !== "string" || !LANDSCAPE_CAPABILITY_WARNINGS.includes(item)))
    throw new Error("Landscape capability warnings must be recognized fixed caveats");
  const items: unknown[] = value;
  return [...new Set(items.filter((item): item is string => typeof item === "string"))];
}

/** Admit fixed unavailable-content explanations without retaining source content. */
export function landscapeContentReason(value: unknown): string {
  if (typeof value !== "string" || !CONTENT_REASONS.includes(value))
    throw new Error("Landscape content reason must be a recognized fixed explanation");
  return value;
}

/** Preserve explicit rule bands without adopting them as DevEx's PR-aware ordering. */
export function parseLandscapeAttention(value: unknown): LandscapeAttention {
  const raw = object(value);
  const band = (value: unknown): LandscapeAttention["priority"] => {
    if (value !== "high" && value !== "medium" && value !== "low" && value !== "unknown")
      throw new Error("Landscape attention band is unsupported");
    return value;
  };
  if (!Array.isArray(raw.reasons) || raw.reasons.length > ATTENTION_REASONS.length ||
      raw.reasons.some((reason: unknown) => typeof reason !== "string" || !ATTENTION_REASONS.includes(reason)))
    throw new Error("Landscape attention reasons must be recognized fixed explanations");
  const reasons: unknown[] = raw.reasons;
  return { activity: band(raw.activity), priority: band(raw.priority),
    reasons: [...new Set(reasons.filter((reason): reason is string => typeof reason === "string"))] };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Landscape activity must be an object");
  return value as Record<string, unknown>;
}

function nullableCount(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("Landscape activity count must be a nonnegative integer or null");
  return value as number;
}

/** Validate portable elapsed windows without conflating incomplete history with zero. */
export function parseLandscapeActivity(value: unknown): LandscapeActivity {
  const raw = object(value);
  if (typeof raw.complete !== "boolean")
    throw new Error("Landscape activity completeness must be boolean");
  const month = nullableCount(raw.commits_30d);
  const quarter = nullableCount(raw.commits_90d);
  if ((raw.complete && (month === null || quarter === null)) ||
      (!raw.complete && (month !== null || quarter !== null)) ||
      (month !== null && quarter !== null && month > quarter))
    throw new Error("Landscape activity windows disagree with coverage");
  const result: LandscapeActivity = { commits_30d: month, commits_90d: quarter, complete: raw.complete };
  if (raw.unknown_reason !== undefined) {
    if (raw.complete || raw.unknown_reason !== "Activity reaches the 500-commit API budget without proving completeness")
      throw new Error("Landscape activity reason must describe the fixed incomplete history budget");
    result.unknown_reason = raw.unknown_reason;
  }
  return result;
}

/** Preserve local-email matching explicitly, never as linked GitHub-login attribution. */
export function parseLandscapeTeamActivity(value: unknown, total?: LandscapeActivity): LandscapeTeamActivity {
  const raw = object(value);
  const activity = parseLandscapeActivity({ ...raw, unknown_reason: undefined });
  if (typeof raw.available !== "boolean" ||
      raw.matching !== (raw.available ? "exact_author_email" : "unavailable"))
    throw new Error("Landscape team activity must declare exact author-email matching");
  const commits = nullableCount(raw.commit_count);
  if ((!raw.available && activity.complete) ||
      (activity.complete ? commits === null : commits !== null) ||
      (commits !== null && activity.commits_90d !== null && commits < activity.commits_90d) ||
      (activity.commits_30d !== null && total?.commits_30d != null && activity.commits_30d > total.commits_30d) ||
      (activity.commits_90d !== null && total?.commits_90d != null && activity.commits_90d > total.commits_90d))
    throw new Error("Landscape team activity disagrees with coverage");
  const matching = raw.matching === "exact_author_email" ? "exact_author_email" : "unavailable";
  const result: LandscapeTeamActivity = { ...activity, available: raw.available, matching, commit_count: commits };
  if (raw.unknown_reason !== undefined) {
    if (raw.complete || (raw.unknown_reason !== "No explicit team author emails configured" &&
        raw.unknown_reason !== "API linked-author team attribution remains caller enrichment" &&
        raw.unknown_reason !== "Local Git author attribution is incomplete"))
      throw new Error("Landscape team reason must be a recognized fixed explanation");
    result.unknown_reason = raw.unknown_reason;
  }
  return result;
}

/** Recompute optional summary facts from allowlisted files, including unknown coverage. */
export function landscapeDetailSummary(files: readonly LandscapeFile[]): Partial<LandscapeSummary> {
  const ages = files.flatMap((file) => file.age_days === null ? [] : [file.age_days]);
  const lags = files.flatMap((file) => file.lag_days === null ? [] : [file.lag_days]);
  const commits = files.flatMap((file) => file.commits_since == null ? [] : [file.commits_since]);
  const scored = files.filter((file) => file.content_signal != null);
  const kinds = [...new Set([...KINDS, ...files.map((file) => file.kind)])].sort();
  return {
    min_age_days: ages.length ? Math.min(...ages) : null,
    max_age_days: ages.length ? Math.max(...ages) : null,
    min_lag_days: lags.length ? Math.min(...lags) : null,
    min_commits_since: commits.length ? Math.min(...commits) : null,
    max_commits_since: commits.length ? Math.max(...commits) : null,
    history_known_count: files.filter((file) => file.status === "known").length,
    commits_since_known_count: commits.length,
    commits_since_change_known_count: files.filter((file) => file.commits_since_change != null).length,
    content_scored_count: scored.length,
    content_signal_mean: files.length && scored.length === files.length
      ? scored.reduce((sum, file) => sum + file.content_signal!.score, 0) / files.length : null,
    by_kind: kinds.map((kind) => {
      const observed = files.filter((file) => file.kind === kind);
      const unknown = observed.filter((file) => file.status === "unknown").length;
      return { kind, count: observed.length, known_count: observed.length - unknown,
        stale_count: observed.filter((file) => file.stale === true).length, unknown_count: unknown };
    }),
  };
}
