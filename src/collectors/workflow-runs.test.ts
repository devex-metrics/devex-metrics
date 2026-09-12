import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setOctokit, resetOctokit } from "../github-client.js";
import type { Octokit } from "@octokit/rest";
import {
  fetchWorkflowRunPage,
  resetWorkflowRunAuthLatch,
} from "./workflow-runs.js";

interface RawRunInput {
  id: number;
  name?: string;
  run_attempt?: number;
  head_branch?: string | null;
  head_sha?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  run_started_at?: string | null;
  updated_at?: string;
}

function rawRun(overrides: RawRunInput) {
  return {
    id: overrides.id,
    name: overrides.name ?? "CI",
    run_attempt: overrides.run_attempt ?? 1,
    head_branch: overrides.head_branch ?? "main",
    head_sha: overrides.head_sha ?? "abc123",
    event: overrides.event ?? "push",
    status: overrides.status ?? "completed",
    conclusion: overrides.conclusion ?? "success",
    created_at: overrides.created_at ?? "2026-08-01T10:00:00Z",
    // `?? default` would swallow an explicit null, which is exactly the case
    // the "no start time" test is about.
    run_started_at:
      "run_started_at" in overrides ? overrides.run_started_at : "2026-08-01T10:01:00Z",
    updated_at: overrides.updated_at ?? "2026-08-01T10:06:00Z",
  };
}

/** Octokit whose actions listing returns `runs`, capturing its parameters. */
function mockOctokit(runs: unknown[], captured: { params?: unknown } = {}) {
  return {
    rest: {
      actions: {
        listWorkflowRunsForRepo: async (params: unknown) => {
          captured.params = params;
          return { data: { workflow_runs: runs } };
        },
      },
    },
  } as unknown as Octokit;
}

/** Octokit whose actions listing always rejects with `status`. */
function failingOctokit(status: number) {
  return {
    rest: {
      actions: {
        listWorkflowRunsForRepo: async () => {
          throw Object.assign(new Error(`HTTP ${status}`), { status });
        },
      },
    },
  } as unknown as Octokit;
}

beforeEach(() => resetWorkflowRunAuthLatch());
afterEach(() => resetOctokit());

describe("fetchWorkflowRunPage", () => {
  it("maps a page of runs onto the stored facts", async () => {
    setOctokit(mockOctokit([rawRun({ id: 1 })]));
    const page = await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1);
    expect(page).not.toBeNull();
    expect(page!.runs).toHaveLength(1);
    expect(page!.runs[0]).toMatchObject({
      id: 1,
      attempt: 1,
      workflow: "CI",
      branch: "main",
      event: "push",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-08-01T10:01:00Z",
    });
  });

  it("pins the listing to the anchor date and the requested page", async () => {
    const captured: { params?: { created?: string; page?: number; branch?: string } } = {};
    setOctokit(mockOctokit([], captured));
    await fetchWorkflowRunPage("acme", "api", "trunk", "2026-08-30", 4);
    expect(captured.params).toMatchObject({
      branch: "trunk",
      created: "<=2026-08-30",
      page: 4,
      per_page: 100,
    });
  });

  it("reports more pages only when the page came back full", async () => {
    setOctokit(mockOctokit([rawRun({ id: 1 })]));
    const short = await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1);
    expect(short!.hasMore).toBe(false);

    const full = Array.from({ length: 100 }, (_, i) => rawRun({ id: i + 1 }));
    setOctokit(mockOctokit(full));
    const page = await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1);
    expect(page!.hasMore).toBe(true);
  });

  it("treats a missing workflow_runs array as an empty page", async () => {
    setOctokit({
      rest: {
        actions: { listWorkflowRunsForRepo: async () => ({ data: {} }) },
      },
    } as unknown as Octokit);
    const page = await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1);
    expect(page).toEqual({ runs: [], hasMore: false });
  });

  it("leaves startedAt absent when GitHub reports none", async () => {
    setOctokit(mockOctokit([rawRun({ id: 1, run_started_at: null })]));
    const page = await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1);
    expect(page!.runs[0].startedAt).toBeUndefined();
  });

  it("returns null and stays quiet on 404", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(failingOctokit(404));
    expect(await fetchWorkflowRunPage("acme", "gone", "main", "2026-08-30", 1)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null and warns on 403", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(failingOctokit(403));
    expect(await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("403"));
    warn.mockRestore();
  });

  it("warns once for 401, not once per repository", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(failingOctokit(401));
    await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1);
    await fetchWorkflowRunPage("acme", "web", "main", "2026-08-30", 1);
    await fetchWorkflowRunPage("acme", "docs", "main", "2026-08-30", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("401"));
    warn.mockRestore();
  });

  it("returns null and warns on a server error rather than aborting the run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setOctokit(failingOctokit(502));
    expect(await fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("502"));
    warn.mockRestore();
  });

  it("re-throws an error it does not recognise", async () => {
    setOctokit(failingOctokit(422));
    await expect(
      fetchWorkflowRunPage("acme", "api", "main", "2026-08-30", 1)
    ).rejects.toMatchObject({ status: 422 });
  });
});
