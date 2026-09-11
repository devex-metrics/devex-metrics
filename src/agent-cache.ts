import * as fs from "node:fs";
import * as path from "node:path";
import type { CopilotAgentRepoCache } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");

/**
 * Current schema version for the per-repo agent cache file.
 * Bump this whenever `CopilotAgentTask` or `CopilotAgentSession` shape changes
 * so that stale cache files are automatically discarded.
 *
 * Version history:
 *   1 — initial version
 *   2 — `CopilotAgentTask.prNumbers` and the `perPRActionsMinutes` cache keys
 *       previously stored the "pull" artifact's raw database ID
 *       (`data.id`) instead of the repository-scoped PR number, producing
 *       invalid `/pulls/{pull_number}` REST lookups (404s). The bump
 *       discards cache files written by the older, incorrect mapping so
 *       every repo recollects task artifacts using the corrected
 *       GraphQL-resolved PR number. No manual migration is required —
 *       stale files are simply ignored (`loadAgentCache` returns `null`)
 *       and rebuilt from a fresh API collection.
 */
export const AGENT_CACHE_SCHEMA_VERSION = 2;

function agentCacheFilePath(owner: string, repo: string): string {
  // Sanitise owner/repo for use in a filename (replace path separators).
  const safe = (s: string) => s.replace(/[/\\]/g, "-");
  return path.join(DATA_DIR, `agents-${safe(owner)}-${safe(repo)}.json`);
}

/**
 * Load the per-repo agent cache for `owner/repo`.
 * Returns `null` if the file does not exist, is unreadable, or has an
 * incompatible schema version.
 */
export function loadAgentCache(
  owner: string,
  repo: string,
): CopilotAgentRepoCache | null {
  const filePath = agentCacheFilePath(owner, repo);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as CopilotAgentRepoCache;
    if (data.schemaVersion !== AGENT_CACHE_SCHEMA_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Persist the per-repo agent cache for `owner/repo`.
 */
export function saveAgentCache(
  owner: string,
  repo: string,
  data: CopilotAgentRepoCache,
): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = agentCacheFilePath(owner, repo);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
