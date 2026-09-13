import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadAgentCache,
  saveAgentCache,
  AGENT_CACHE_SCHEMA_VERSION,
} from "./agent-cache.js";
import type { CopilotAgentRepoCache } from "./types.js";

// agent-cache.ts resolves DATA_DIR from process.cwd() + /data at module
// load, so — like cache.test.ts — we exercise the actual data dir here
// rather than mocking fs, to genuinely cover the on-disk contract.
const dataDir = path.resolve(process.cwd(), "data");
const owner = "test-agent-owner";
const repo = "test-agent-repo";
const testFile = path.join(dataDir, `agents-${owner}-${repo}.json`);

function makeSampleCache(
  overrides: Partial<CopilotAgentRepoCache> = {},
): CopilotAgentRepoCache {
  return {
    schemaVersion: AGENT_CACHE_SCHEMA_VERSION,
    owner,
    repo,
    activeRefreshedAt: new Date().toISOString(),
    terminalTasks: [],
    activeTasks: [],
    ...overrides,
  };
}

afterEach(() => {
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
});

describe("agent-cache", () => {
  it("returns null when no cache file exists", () => {
    expect(loadAgentCache(owner, repo)).toBeNull();
  });

  it("saves and loads a cache written at the current schema version", () => {
    const cache = makeSampleCache({
      terminalTasks: [
        {
          id: "task-1",
          name: "Sample task",
          state: "completed",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T01:00:00Z",
          htmlUrl: "https://github.com/test-agent-owner/test-agent-repo/tasks/task-1",
          sessions: [],
          prNumbers: [42],
        },
      ],
    });

    saveAgentCache(owner, repo, cache);
    const loaded = loadAgentCache(owner, repo);

    expect(loaded).not.toBeNull();
    expect(loaded!.owner).toBe(owner);
    expect(loaded!.terminalTasks).toHaveLength(1);
    expect(loaded!.terminalTasks[0].prNumbers).toEqual([42]);
  });

  // Regression coverage for the AGENT_CACHE_SCHEMA_VERSION 1 -> 2 bump: a
  // cache file written under an older schema version (e.g. one still
  // holding the artifact's database ID as `prNumbers`, per the pre-fix
  // bug) must never be handed back to the caller as if it were current —
  // it has to be discarded so the repo is fully recollected.
  it("returns null for a cache file written under a stale schema version", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const stale = { ...makeSampleCache(), schemaVersion: AGENT_CACHE_SCHEMA_VERSION - 1 };
    fs.writeFileSync(testFile, JSON.stringify(stale));

    expect(loadAgentCache(owner, repo)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(testFile, "{ not valid json");

    expect(loadAgentCache(owner, repo)).toBeNull();
  });

  it("sanitises owner/repo path separators so the cache file stays inside data/", () => {
    const nestedOwner = "weird/owner";
    const nestedRepo = "weird\\repo";
    const nestedFile = path.join(dataDir, "agents-weird-owner-weird-repo.json");
    try {
      saveAgentCache(nestedOwner, nestedRepo, makeSampleCache({ owner: nestedOwner, repo: nestedRepo }));
      expect(fs.existsSync(nestedFile)).toBe(true);
      expect(loadAgentCache(nestedOwner, nestedRepo)).not.toBeNull();
    } finally {
      if (fs.existsSync(nestedFile)) fs.unlinkSync(nestedFile);
    }
  });
});
