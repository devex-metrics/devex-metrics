import { getAgentOctokit } from "../github-client.js";
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
 * Based on the observed header used by `gh api` in production scripts.
 */
const AGENT_API_VERSION = "2022-11-28";

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
    global_id?: string;
    head_ref?: string;
    base_ref?: string;
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

// ── PR number resolution ──────────────────────────────────────────────────────

/**
 * Resolve GraphQL node IDs to PR numbers via batched alias query.
 * Up to 50 IDs are resolved per request to stay within query-size limits.
 * Returns an empty map on any GraphQL failure.
 */
async function resolvePrNumbers(
  octokit: NonNullable<Awaited<ReturnType<typeof getAgentOctokit>>>,
  globalIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (globalIds.length === 0) return map;

  for (let i = 0; i < globalIds.length; i += 50) {
    const batch = globalIds.slice(i, i + 50);
    const aliases = batch
      .map(
        (id, j) =>
          `pr${j}: node(id: ${JSON.stringify(id)}) { ... on PullRequest { number } }`,
      )
      .join("\n");
    try {
      const result = await octokit.graphql<
        Record<string, { number: number } | null>
      >(`{ ${aliases} }`);
      batch.forEach((id, j) => {
        const node = result[`pr${j}`];
        if (node?.number) map.set(id, node.number);
      });
    } catch {
      // GraphQL failure — skip PR resolution for this batch
    }
  }
  return map;
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
  };
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

  // ── 2. Resolve PR global IDs for new tasks ────────────────────────────────
  const newGlobalIds: string[] = [];
  for (const t of rawTasks) {
    if (cachedTerminalIds.has(t.id)) continue;
    for (const artifact of t.artifacts ?? []) {
      if (artifact.type === "pull" && artifact.data.global_id) {
        newGlobalIds.push(artifact.data.global_id);
      }
    }
  }
  const prMap = await resolvePrNumbers(
    octokit,
    [...new Set(newGlobalIds)],
  );

  // ── 3. Fetch task details for tasks not already in terminal cache ─────────
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

    const prNumbers = (rawTask.artifacts ?? [])
      .filter((a) => a.type === "pull" && a.data.global_id)
      .map((a) => prMap.get(a.data.global_id!) ?? 0)
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

  // ── 4. Merge and persist cache ────────────────────────────────────────────
  const updatedCache: CopilotAgentRepoCache = {
    schemaVersion: AGENT_CACHE_SCHEMA_VERSION,
    owner,
    repo,
    activeRefreshedAt: new Date().toISOString(),
    // Terminal tasks are append-only; never removed from cache.
    terminalTasks: [...cache.terminalTasks, ...newTerminalTasks],
    // Active tasks are replaced entirely with the latest API response.
    activeTasks: newActiveTasks,
  };
  saveAgentCache(owner, repo, updatedCache);

  // ── 5. Compute metrics over all tasks in the window ───────────────────────
  // Terminal tasks from the cache may predate the current window; filter them
  // so metrics reflect only the requested time range.
  const windowStart = since ? new Date(since).getTime() : 0;
  const allTasksInWindow = [
    ...updatedCache.terminalTasks,
    ...updatedCache.activeTasks,
  ].filter(
    (t) => windowStart === 0 || new Date(t.createdAt).getTime() >= windowStart,
  );

  return computeAgentMetrics(allTasksInWindow);
}
