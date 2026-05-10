import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectSessionSource,
  computeAgentMetrics,
  collectCopilotAgentMetrics,
} from "./copilot-agent.js";
import {
  setAgentOctokit,
  resetAgentOctokit,
} from "../github-client.js";
import { loadAgentCache, saveAgentCache } from "../agent-cache.js";
import type { CopilotAgentTask, CopilotAgentRepoCache } from "../types.js";
import type { Octokit } from "@octokit/rest";

// ── Mock agent-cache so tests don't touch the filesystem ─────────────────────
vi.mock("../agent-cache.js", () => ({
  AGENT_CACHE_SCHEMA_VERSION: 1,
  loadAgentCache: vi.fn(),
  saveAgentCache: vi.fn(),
}));

const mockLoadAgentCache = vi.mocked(loadAgentCache);
const mockSaveAgentCache = vi.mocked(saveAgentCache);

afterEach(() => {
  resetAgentOctokit();
  vi.clearAllMocks();
});

// ── Helper factories ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<CopilotAgentTask> = {}): CopilotAgentTask {
  return {
    id: "task-1",
    name: "Fix the bug",
    state: "completed",
    createdAt: "2024-01-10T10:00:00Z",
    updatedAt: "2024-01-10T11:00:00Z",
    htmlUrl: "https://github.com/owner/repo/tasks/task-1",
    sessions: [],
    prNumbers: [],
    ...overrides,
  };
}

function makeRawApiResponse(tasks: object[]) {
  return { data: { tasks } };
}

function makeTaskDetailResponse(task: object) {
  return { data: task };
}

function makeMockOctokit(
  tasks: object[],
  taskDetail: object | null = null,
  graphqlResult: object | null = null,
): Octokit {
  const requestMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/tasks/") && !url.endsWith("/tasks")) {
      return Promise.resolve(
        makeTaskDetailResponse(taskDetail ?? { id: "task-1", sessions: [] }),
      );
    }
    return Promise.resolve(makeRawApiResponse(tasks));
  });

  const graphqlMock = vi.fn().mockResolvedValue(graphqlResult ?? {});

  return { request: requestMock, graphql: graphqlMock } as unknown as Octokit;
}

// ── Unit: detectSessionSource ─────────────────────────────────────────────────

describe("detectSessionSource", () => {
  it("returns cloud-agent when model is set", () => {
    expect(
      detectSessionSource({ model: "sweagent-capi:claude-sonnet-4.5" }),
    ).toBe("cloud-agent");
  });

  it("returns cloud-agent when usage is present (empty model)", () => {
    expect(
      detectSessionSource({
        model: "",
        usage: { credits: 5, type: "premium" },
      }),
    ).toBe("cloud-agent");
  });

  it("returns cli-remote when model is empty and no usage", () => {
    expect(detectSessionSource({ model: "" })).toBe("cli-remote");
  });

  it("returns cli-remote when model is absent and no usage", () => {
    expect(detectSessionSource({})).toBe("cli-remote");
  });
});

// ── Unit: computeAgentMetrics ─────────────────────────────────────────────────

describe("computeAgentMetrics", () => {
  it("returns zero metrics for empty task list", () => {
    const result = computeAgentMetrics([]);
    expect(result.totalTasks).toBe(0);
    expect(result.totalSessions).toBe(0);
    expect(result.totalCreditsUsed).toBe(0);
    expect(result.agentCreatedPRs).toBe(0);
    expect(result.avgCompletedSessionHours).toBeUndefined();
    expect(result.lastTaskAt).toBeUndefined();
  });

  it("counts tasks by state correctly", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({ state: "completed" }),
      makeTask({ id: "t2", state: "failed" }),
      makeTask({ id: "t3", state: "cancelled" }),
      makeTask({ id: "t4", state: "timed_out" }),
      makeTask({ id: "t5", state: "in_progress" }),
      makeTask({ id: "t6", state: "queued" }),
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.totalTasks).toBe(6);
    expect(result.completedTasks).toBe(1);
    expect(result.failedTasks).toBe(1);
    expect(result.cancelledTasks).toBe(1);
    expect(result.timedOutTasks).toBe(1);
    expect(result.activeTasksCount).toBe(2);
  });

  it("counts sessions by source", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({
        sessions: [
          {
            id: "s1",
            state: "completed",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            model: "claude-sonnet-4.5",
          },
          {
            id: "s2",
            state: "completed",
            source: "cli-remote",
            createdAt: "2024-01-10T10:00:00Z",
          },
        ],
      }),
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.totalSessions).toBe(2);
    expect(result.cloudAgentSessions).toBe(1);
    expect(result.cliRemoteSessions).toBe(1);
  });

  it("sums credits across sessions", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({
        sessions: [
          {
            id: "s1",
            state: "completed",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            usageCredits: 10,
          },
          {
            id: "s2",
            state: "completed",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            usageCredits: 5.5,
          },
        ],
      }),
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.totalCreditsUsed).toBe(15.5);
  });

  it("computes average completed session duration", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({
        sessions: [
          {
            id: "s1",
            state: "completed",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            durationHours: 2,
          },
          {
            id: "s2",
            state: "completed",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            durationHours: 4,
          },
        ],
      }),
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.avgCompletedSessionHours).toBe(3);
  });

  it("excludes active sessions from duration average", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({
        sessions: [
          {
            id: "s1",
            state: "in_progress",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            durationHours: 100, // should not be included
          },
          {
            id: "s2",
            state: "completed",
            source: "cloud-agent",
            createdAt: "2024-01-10T10:00:00Z",
            durationHours: 2,
          },
        ],
      }),
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.avgCompletedSessionHours).toBe(2);
  });

  it("deduplicates PR numbers across tasks", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({ id: "t1", prNumbers: [42, 43] }),
      makeTask({ id: "t2", prNumbers: [42, 44] }), // 42 is duplicated
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.agentCreatedPRs).toBe(3); // 42, 43, 44
  });

  it("picks the most recent task's createdAt as lastTaskAt", () => {
    const tasks: CopilotAgentTask[] = [
      makeTask({ id: "t1", createdAt: "2024-01-10T10:00:00Z" }),
      makeTask({ id: "t2", createdAt: "2024-01-15T10:00:00Z" }),
      makeTask({ id: "t3", createdAt: "2024-01-12T10:00:00Z" }),
    ];
    const result = computeAgentMetrics(tasks);
    expect(result.lastTaskAt).toBe("2024-01-15T10:00:00Z");
  });
});

// ── Integration: collectCopilotAgentMetrics ───────────────────────────────────

describe("collectCopilotAgentMetrics", () => {
  beforeEach(() => {
    mockLoadAgentCache.mockReturnValue(null); // no existing cache by default
  });

  it("returns null when no octokit token is available", async () => {
    // No setAgentOctokit call — relies on missing env var; but since we reset
    // the singleton, getAgentOctokit would look at process.env.
    // We simulate this by not setting an octokit AND ensuring env vars are absent.
    const origToken = process.env.GITHUB_TOKEN;
    const origAgentToken = process.env.COPILOT_AGENT_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.COPILOT_AGENT_TOKEN;
    try {
      const result = await collectCopilotAgentMetrics("owner", "repo");
      expect(result).toBeNull();
    } finally {
      if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
      if (origAgentToken !== undefined)
        process.env.COPILOT_AGENT_TOKEN = origAgentToken;
    }
  });

  it("returns null on 404 (endpoint not enabled)", async () => {
    const octokit = {
      request: vi.fn().mockRejectedValue({ status: 404 }),
      graphql: vi.fn(),
    } as unknown as Octokit;
    setAgentOctokit(octokit);

    const result = await collectCopilotAgentMetrics("owner", "repo");
    expect(result).toBeNull();
  });

  it("returns null and warns on 403", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const octokit = {
      request: vi.fn().mockRejectedValue({ status: 403 }),
      graphql: vi.fn(),
    } as unknown as Octokit;
    setAgentOctokit(octokit);

    const result = await collectCopilotAgentMetrics("owner", "repo");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
    warnSpy.mockRestore();
  });

  it("re-throws unexpected errors", async () => {
    const octokit = {
      request: vi
        .fn()
        .mockRejectedValue(new Error("unexpected network failure")),
      graphql: vi.fn(),
    } as unknown as Octokit;
    setAgentOctokit(octokit);

    await expect(
      collectCopilotAgentMetrics("owner", "repo"),
    ).rejects.toThrow("unexpected network failure");
  });

  it("happy path: returns aggregated metrics for a completed task", async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const rawTask = {
      id: "task-1",
      name: "Fix the bug",
      state: "completed",
      created_at: recentDate,
      updated_at: recentDate,
      html_url: "https://github.com/owner/repo/tasks/task-1",
      session_count: 1,
      artifacts: [{ type: "pull", data: { global_id: "gid-42" } }],
    };
    const rawDetail = {
      ...rawTask,
      sessions: [
        {
          id: "session-1",
          state: "completed",
          model: "sweagent-capi:claude-sonnet-4.5",
          created_at: recentDate,
          completed_at: new Date(
            new Date(recentDate).getTime() + 30 * 60 * 1000,
          ).toISOString(),
          usage: { credits: 8, type: "premium" },
        },
      ],
    };

    const octokit = makeMockOctokit(
      [rawTask],
      rawDetail,
      { pr0: { number: 42 } }, // GraphQL resolves gid-42 → PR #42
    );
    setAgentOctokit(octokit);

    const result = await collectCopilotAgentMetrics("owner", "repo");
    expect(result).not.toBeNull();
    expect(result!.totalTasks).toBe(1);
    expect(result!.completedTasks).toBe(1);
    expect(result!.totalSessions).toBe(1);
    expect(result!.cloudAgentSessions).toBe(1);
    expect(result!.totalCreditsUsed).toBe(8);
    expect(result!.agentCreatedPRs).toBe(1);
    expect(result!.avgCompletedSessionHours).toBeCloseTo(0.5, 1);
  });

  it("skips detail fetch for already-cached terminal tasks", async () => {
    const cachedTask = makeTask({ id: "task-cached", state: "completed" });
    const existingCache: CopilotAgentRepoCache = {
      schemaVersion: 1,
      owner: "owner",
      repo: "repo",
      activeRefreshedAt: new Date().toISOString(),
      terminalTasks: [cachedTask],
      activeTasks: [],
    };
    mockLoadAgentCache.mockReturnValue(existingCache);

    const rawTask = {
      id: "task-cached", // same ID as in cache
      name: "Fix the bug",
      state: "completed",
      created_at: "2024-01-10T10:00:00Z",
      updated_at: "2024-01-10T11:00:00Z",
      html_url: "https://github.com/owner/repo/tasks/task-cached",
      session_count: 1,
      artifacts: [],
    };

    const requestMock = vi.fn().mockResolvedValue(makeRawApiResponse([rawTask]));
    const octokit = {
      request: requestMock,
      graphql: vi.fn(),
    } as unknown as Octokit;
    setAgentOctokit(octokit);

    await collectCopilotAgentMetrics("owner", "repo");

    // Should only call request once (task list), NOT for the task detail
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("filters terminal cache tasks outside the daysBack window", async () => {
    // Terminal task created 60 days ago — outside the 30-day default window
    const oldTask = makeTask({
      id: "old-task",
      state: "completed",
      createdAt: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
    });
    const existingCache: CopilotAgentRepoCache = {
      schemaVersion: 1,
      owner: "owner",
      repo: "repo",
      activeRefreshedAt: new Date().toISOString(),
      terminalTasks: [oldTask],
      activeTasks: [],
    };
    mockLoadAgentCache.mockReturnValue(existingCache);

    // API returns no new tasks
    const octokit = makeMockOctokit([]);
    setAgentOctokit(octokit);

    const result = await collectCopilotAgentMetrics("owner", "repo", 30);
    // Old task is outside the 30-day window so it should not appear in metrics
    expect(result!.totalTasks).toBe(0);
  });

  it("accumulates terminal tasks across runs without re-fetching", async () => {
    const existingTerminalTask = makeTask({
      id: "task-old",
      state: "completed",
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    });
    mockLoadAgentCache.mockReturnValue({
      schemaVersion: 1,
      owner: "owner",
      repo: "repo",
      activeRefreshedAt: new Date().toISOString(),
      terminalTasks: [existingTerminalTask],
      activeTasks: [],
    });

    const newRawTask = {
      id: "task-new",
      name: "New task",
      state: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      html_url: "https://github.com/owner/repo/tasks/task-new",
      session_count: 0,
      artifacts: [],
    };

    const octokit = makeMockOctokit([newRawTask], {
      ...newRawTask,
      sessions: [],
    });
    setAgentOctokit(octokit);

    await collectCopilotAgentMetrics("owner", "repo");

    // Cache should contain both old and new terminal tasks
    expect(mockSaveAgentCache).toHaveBeenCalledWith(
      "owner",
      "repo",
      expect.objectContaining({
        terminalTasks: expect.arrayContaining([
          expect.objectContaining({ id: "task-old" }),
          expect.objectContaining({ id: "task-new" }),
        ]),
      }),
    );
  });

  it("replaces active tasks entirely on each run", async () => {
    mockLoadAgentCache.mockReturnValue({
      schemaVersion: 1,
      owner: "owner",
      repo: "repo",
      activeRefreshedAt: new Date().toISOString(),
      terminalTasks: [],
      activeTasks: [makeTask({ id: "stale-active", state: "in_progress" })],
    });

    const freshActiveTask = {
      id: "fresh-active",
      name: "Fresh task",
      state: "in_progress",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      html_url: "https://github.com/owner/repo/tasks/fresh-active",
      session_count: 0,
      artifacts: [],
    };

    const octokit = makeMockOctokit([freshActiveTask], {
      ...freshActiveTask,
      sessions: [],
    });
    setAgentOctokit(octokit);

    await collectCopilotAgentMetrics("owner", "repo");

    expect(mockSaveAgentCache).toHaveBeenCalledWith(
      "owner",
      "repo",
      expect.objectContaining({
        activeTasks: [expect.objectContaining({ id: "fresh-active" })],
      }),
    );
  });

  it("handles tasks with no artifacts gracefully", async () => {
    const rawTask = {
      id: "task-no-art",
      name: "No artifacts",
      state: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      html_url: "https://github.com/owner/repo/tasks/task-no-art",
      session_count: 0,
      artifacts: [],
    };

    const octokit = makeMockOctokit([rawTask], { ...rawTask, sessions: [] });
    setAgentOctokit(octokit);

    const result = await collectCopilotAgentMetrics("owner", "repo");
    expect(result).not.toBeNull();
    expect(result!.agentCreatedPRs).toBe(0);
  });

  it("paginates through multiple pages of tasks", async () => {
    // First page: 100 tasks (simulate full page)
    const page1Tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `task-${i}`,
      name: `Task ${i}`,
      state: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      html_url: `https://github.com/owner/repo/tasks/task-${i}`,
      session_count: 0,
      artifacts: [],
    }));
    const page2Tasks = [
      {
        id: "task-100",
        name: "Task 100",
        state: "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        html_url: "https://github.com/owner/repo/tasks/task-100",
        session_count: 0,
        artifacts: [],
      },
    ];

    let callCount = 0;
    const requestMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/tasks/")) {
        return Promise.resolve({ data: { sessions: [] } });
      }
      callCount++;
      if (callCount === 1) return Promise.resolve(makeRawApiResponse(page1Tasks));
      return Promise.resolve(makeRawApiResponse(page2Tasks));
    });

    const octokit = {
      request: requestMock,
      graphql: vi.fn().mockResolvedValue({}),
    } as unknown as Octokit;
    setAgentOctokit(octokit);

    const result = await collectCopilotAgentMetrics("owner", "repo");
    // 100 (page1) + 1 (page2) tasks fetched
    expect(result!.totalTasks).toBe(101);
  });
});
