import { getAgentOctokit, getOctokit } from "../github-client.js";
import type { Octokit } from "@octokit/rest";
import {
  loadAgentCache,
  saveAgentCache,
  AGENT_CACHE_SCHEMA_VERSION,
} from "../agent-cache.js";
import type {
  CopilotAgentTask,
  CopilotAgentSession,
  CopilotAgentMetrics,
  CopilotAgentRepoCache,
} from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

/**
 * API version header required by the Copilot Agent Tasks endpoint.
 * The agent tasks API was introduced in version 2026-03-10; using an older
 * version header causes the endpoint to return 404.
 */
const AGENT_API_VERSION = "2026-03-10";

// Typed wrapper for calling non-catalogued Octokit endpoints.
type OctokitLike = { request: (url: string, opts?: Record<string, unknown>) => Promise<{ data: unknown }> };
function asAnyRequest(
  octokit: NonNullable<Awaited<ReturnType<typeof getAgentOctokit>>>,
): OctokitLike {
  return octokit as unknown as OctokitLike;
}

// ── Raw API shapes ────────────────────────────────────────────────────────────
// These mirror the JSON returned by the /agents/repos/{owner}/{repo}/tasks
// endpoint; they are only used inside this module.

interface RawArtifact {
  type: string;
  data: {
    /** PR number for "pull" artifacts — returned directly by the API. */
    id?: number;
  };
}

interface RawTask {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  session_count: number;
  artifacts?: RawArtifact[];
}

interface RawSession {
  id: string;
  state: string;
  head_ref?: string;
  base_ref?: string;
  /** Full model identifier, e.g. "sweagent-capi:claude-sonnet-4.5". */
  model?: string;
  created_at: string;
  completed_at?: string;
  usage?: { credits: number; type: string };
  error?: { message: string };
}

interface RawTaskDetail extends RawTask {
  sessions?: RawSession[];
}

// ── Session parsing helpers ───────────────────────────────────────────────────

/**
 * Detect whether a session was run by the Copilot cloud agent or the CLI.
 * Cloud agent sessions set a non-empty `model` field or include a `usage`
 * object; CLI/remote sessions leave `model` empty and omit `usage`.
 */
export function detectSessionSource(
  session: Pick<RawSession, "model" | "usage">,
): "cloud-agent" | "cli-remote" {
  if (session.model && session.model !== "") return "cloud-agent";
  if (session.usage !== undefined) return "cloud-agent";
  return "cli-remote";
}

function stripModelPrefix(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model.replace(/^sweagent-capi:/, "");
}

function hoursBetween(a: string, b: string | undefined): number | undefined {
  if (!b) return undefined;
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000);
}

function parseSession(raw: RawSession): CopilotAgentSession {
  const source = detectSessionSource(raw);
  const rawDuration = hoursBetween(raw.created_at, raw.completed_at);
  return {
    id: raw.id,
    state: raw.state,
    source,
    headRef: raw.head_ref,
    baseRef: raw.base_ref,
    model: stripModelPrefix(raw.model),
    createdAt: raw.created_at,
    completedAt: raw.completed_at,
    usageCredits: raw.usage?.credits,
    usageType: raw.usage?.type,
    errorMessage: raw.error?.message,
    durationHours:
      rawDuration !== undefined
        ? Math.round(rawDuration * 100) / 100
        : undefined,
  };
}

// ── Metric aggregation ────────────────────────────────────────────────────────

/**
 * Compute aggregated `CopilotAgentMetrics` from a list of tasks.
 * Pure function — no API calls, suitable for testing.
 */
export function computeAgentMetrics(
  tasks: CopilotAgentTask[],
): CopilotAgentMetrics {
  let completed = 0,
    failed = 0,
    cancelled = 0,
    timedOut = 0,
    active = 0;
  let totalSessions = 0,
    cloudSessions = 0,
    cliSessions = 0;
  let totalCredits = 0;
  let lastTaskAt: string | undefined;
  const completedDurations: number[] = [];
  const prSet = new Set<number>();

  for (const task of tasks) {
    switch (task.state) {
      case "completed":
        completed++;
        break;
      case "failed":
        failed++;
        break;
      case "cancelled":
        cancelled++;
        break;
      case "timed_out":
        timedOut++;
        break;
      default:
        active++;
        break;
    }
    if (!lastTaskAt || task.createdAt > lastTaskAt) lastTaskAt = task.createdAt;
    for (const pr of task.prNumbers) prSet.add(pr);
    for (const session of task.sessions) {
      totalSessions++;
      if (session.source === "cloud-agent") cloudSessions++;
      else cliSessions++;
      if (session.usageCredits) totalCredits += session.usageCredits;
      if (
        session.durationHours !== undefined &&
        TERMINAL_STATES.has(session.state)
      ) {
        completedDurations.push(session.durationHours);
      }
    }
  }

  const avgCompletedSessionHours =
    completedDurations.length > 0
      ? Math.round(
          (completedDurations.reduce((a, b) => a + b, 0) /
            completedDurations.length) *
            100,
        ) / 100
      : undefined;

  return {
    totalTasks: tasks.length,
    completedTasks: completed,
    failedTasks: failed,
    cancelledTasks: cancelled,
    timedOutTasks: timedOut,
    activeTasksCount: active,
    totalSessions,
    cloudAgentSessions: cloudSessions,
    cliRemoteSessions: cliSessions,
    totalCreditsUsed: Math.round(totalCredits * 100) / 100,
    avgCompletedSessionHours,
    lastTaskAt,
    agentCreatedPRs: prSet.size,
    agentActionsMinutes: 0,
  };
}

// ── Actions minutes collection ────────────────────────────────────────────────

/**
 * Try to obtain an Octokit for standard REST calls (pulls, checks).
 * Falls back to the agent Octokit when the regular one is unavailable
 * (e.g. only COPILOT_AGENT_TOKEN is configured, not GITHUB_TOKEN).
 */
async function getRestOctokit(): Promise<Octokit | null> {
  try {
    return await getOctokit();
  } catch {
    return getAgentOctokit();
  }
}

/**
 * Collect GitHub Actions check-run minutes for a set of agent-created PRs.
 *
 * Only fetches data for PR numbers not already in `cachedMinutes`.
 * Only persists results for closed/merged PRs — open PRs are left uncached
 * so they are refreshed on the next collection run.
 * Failures (inaccessible PR or check-run API) are silently skipped and left
 * absent from the cache so they can be retried later.
 *
 * Returns:
 * - `updatedCache`: entries safe to persist (closed PRs only).
 * - `allMinutes`: all computed entries including open PRs (for this run only).
 */
export async function collectActionsMinutesForPRs(
  owner: string,
  repo: string,
  prNumbers: Set<number>,
  cachedMinutes: Record<string, number>,
): Promise<{
  updatedCache: Record<string, number>;
  allMinutes: Record<string, number>;
}> {
  const empty = { updatedCache: { ...cachedMinutes }, allMinutes: { ...cachedMinutes } };
  if (prNumbers.size === 0) return empty;

  const octokit = await getRestOctokit();
  if (!octokit) return empty;

  const updatedCache: Record<string, number> = { ...cachedMinutes };
  const allMinutes: Record<string, number> = { ...cachedMinutes };

  for (const prNumber of prNumbers) {
    const key = String(prNumber);
    if (key in cachedMinutes) continue; // already have stable data

    let prState: string;
    let headSha: string;
    try {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      prState = pr.state; // "open" or "closed" (closed includes merged)
      headSha = pr.head.sha;
    } catch {
      continue; // PR not accessible — skip silently
    }

    let minutes = 0;
    try {
      const { data: checkRuns } = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: headSha,
        per_page: 100,
      });
      for (const run of checkRuns.check_runs) {
        if (run.started_at && run.completed_at) {
          const start = new Date(run.started_at).getTime();
          const end = new Date(run.completed_at).getTime();
          minutes += (end - start) / 60000;
        }
      }
    } catch {
      // Check-run API not accessible — leave as 0 for this PR
    }

    const rounded = Math.round(minutes * 100) / 100;
    allMinutes[key] = rounded;
    // Only persist to cache for closed/merged PRs (immutable data)
    if (prState === "closed") {
      updatedCache[key] = rounded;
    }
  }

  return { updatedCache, allMinutes };
}

// ── Main collector ────────────────────────────────────────────────────────────

/**
 * Collect Copilot agent task metrics for a single repository.
 *
 * Heavy optimisation: tasks in terminal states (completed / failed /
 * cancelled / timed_out) are cached permanently in a per-repo JSON file
 * inside `data/`; only tasks not already cached require API calls.  The
 * `data/` directory is persisted across workflow runs by `actions/cache`.
 *
 * Returns `null` when:
 * - No suitable PAT is configured (neither COPILOT_AGENT_TOKEN nor
 *   GITHUB_TOKEN).
 * - The endpoint returns 404 (feature not enabled for the repo) or 403
 *   (insufficient permissions).
 *
 * @param owner     Repository owner (user or org login).
 * @param repo      Repository name (without owner prefix).
 * @param daysBack  How far back to look for tasks (0 = all history).
 *                  Defaults to 30.
 */
export async function collectCopilotAgentMetrics(
  owner: string,
  repo: string,
  daysBack = 30,
): Promise<CopilotAgentMetrics | null> {
  const octokit = await getAgentOctokit();
  if (!octokit) return null;

  // Load per-repo agent cache (or start fresh).
  const cache: CopilotAgentRepoCache = loadAgentCache(owner, repo) ?? {
    schemaVersion: AGENT_CACHE_SCHEMA_VERSION,
    owner,
    repo,
    activeRefreshedAt: new Date(0).toISOString(),
    terminalTasks: [],
    activeTasks: [],
  };

  const cachedTerminalIds = new Set(cache.terminalTasks.map((t) => t.id));

  // Build `since` filter.
  const since =
    daysBack > 0
      ? new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString()
      : undefined;

  // ── 1. Fetch task list ────────────────────────────────────────────────────
  const rawTasks: RawTask[] = [];
  try {
    let page = 1;
    while (true) {
      const res = (await asAnyRequest(octokit).request(
        `GET /agents/repos/${owner}/${repo}/tasks`,
        {
          per_page: 100,
          page,
          ...(since ? { since } : {}),
          headers: {
            "X-GitHub-Api-Version": AGENT_API_VERSION,
            accept: "application/vnd.github+json",
          },
        },
      )) as { data: { tasks?: RawTask[] } };

      const tasks = res.data.tasks ?? [];
      rawTasks.push(...tasks);
      if (tasks.length < 100) break;
      page++;
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    if (status === 403) {
      console.warn(
        `  ⚠ copilot-agent: skipping ${owner}/${repo}: access denied (403) ` +
          `— token needs "Agent tasks" permission`,
      );
      return null;
    }
    throw err;
  }

  // ── 2. Fetch task details for tasks not already in terminal cache ─────────
  const newTerminalTasks: CopilotAgentTask[] = [];
  const newActiveTasks: CopilotAgentTask[] = [];

  for (const rawTask of rawTasks) {
    if (cachedTerminalIds.has(rawTask.id)) continue; // already cached permanently

    let detail: RawTaskDetail = rawTask;
    try {
      const res = (await asAnyRequest(octokit).request(
        `GET /agents/repos/${owner}/${repo}/tasks/${rawTask.id}`,
        {
          headers: {
            "X-GitHub-Api-Version": AGENT_API_VERSION,
            accept: "application/vnd.github+json",
          },
        },
      )) as { data: RawTaskDetail };
      detail = res.data;
    } catch {
      // Detail fetch failed — proceed with list-level data only
    }

    // The API returns PR numbers directly as artifact.data.id.
    const prNumbers = (rawTask.artifacts ?? [])
      .filter((a) => a.type === "pull" && a.data.id)
      .map((a) => a.data.id!)
      .filter((n) => n > 0);

    const task: CopilotAgentTask = {
      id: rawTask.id,
      name: rawTask.name,
      state: rawTask.state,
      createdAt: rawTask.created_at,
      updatedAt: rawTask.updated_at,
      htmlUrl: rawTask.html_url,
      sessions: (detail.sessions ?? []).map(parseSession),
      prNumbers,
    };

    if (TERMINAL_STATES.has(rawTask.state)) {
      newTerminalTasks.push(task);
    } else {
      newActiveTasks.push(task);
    }
  }

  // ── 3. Build merged task lists (before saving cache) ─────────────────────
  const updatedTerminal = [...cache.terminalTasks, ...newTerminalTasks];
  const updatedActive = newActiveTasks;

  // ── 4. Compute metrics over all tasks in the window ───────────────────────
  const windowStart = since ? new Date(since).getTime() : 0;
  const allTasksInWindow = [...updatedTerminal, ...updatedActive].filter(
    (t) => windowStart === 0 || new Date(t.createdAt).getTime() >= windowStart,
  );

  // ── 5. Collect GitHub Actions minutes for agent-created PRs ───────────────
  const agentPRNumbers = new Set<number>();
  for (const task of allTasksInWindow) {
    for (const prNum of task.prNumbers) agentPRNumbers.add(prNum);
  }
  const { updatedCache: prMinutesCache, allMinutes: prMinutes } =
    await collectActionsMinutesForPRs(
      owner,
      repo,
      agentPRNumbers,
      cache.perPRActionsMinutes ?? {},
    );

  // ── 6. Persist cache ──────────────────────────────────────────────────────
  const updatedCache: CopilotAgentRepoCache = {
    schemaVersion: AGENT_CACHE_SCHEMA_VERSION,
    owner,
    repo,
    activeRefreshedAt: new Date().toISOString(),
    // Terminal tasks are append-only; never removed from cache.
    terminalTasks: updatedTerminal,
    // Active tasks are replaced entirely with the latest API response.
    activeTasks: updatedActive,
    perPRActionsMinutes: prMinutesCache,
  };
  saveAgentCache(owner, repo, updatedCache);

  // ── 7. Compute and return metrics ─────────────────────────────────────────
  const agentActionsMinutes =
    Math.round(
      [...agentPRNumbers].reduce(
        (sum, n) => sum + (prMinutes[String(n)] ?? 0),
        0,
      ) * 100,
    ) / 100;

  const metrics = computeAgentMetrics(allTasksInWindow);
  metrics.agentActionsMinutes = agentActionsMinutes;
  return metrics;
}
