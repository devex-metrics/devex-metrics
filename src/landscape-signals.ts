import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { LandscapeContentSignal, LandscapeFile, LandscapeRepository, LandscapeScan } from "./types.js";

export const MAX_SIGNAL_REPOS = 100;
export const MAX_SIGNAL_FILES = 200;
export const MAX_FILES_PER_REPO = 20;
export const MAX_FILE_BYTES = 64 * 1024;
const DAY = 24 * 60 * 60 * 1000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Landscape ${label} must be a nonnegative integer`);
  return value;
}

/** Static text checks only; repository instructions are never executed. */
export function scoreLandscapeContent(text: string): LandscapeContentSignal {
  const scope = /^#{1,6}\s*(?:scope|purpose|context|about this (?:repo|project)|repository)\b/im.test(text) ||
    /\b(?:this repository|this repo|this project)\b/i.test(text);
  const actions = /^\s*(?:[-*]|\d+[.)])\s+(?:run|add|update|write|use|check|verify|review|create|change|keep|test|build)\b/im.test(text);
  const verification = /^#{1,6}\s*(?:testing|validation|verification|checks)\b/im.test(text) ||
    /\b(?:run|execute)\s+(?:npm (?:test|run (?:build|lint))|pnpm (?:test|run)|yarn (?:test|build)|pytest|go test|cargo test|dotnet test)\b/i.test(text);
  const guardrails = /\b(?:do not|don't|never|must not|avoid)\b/i.test(text);
  return { score: 25 * [scope, actions, verification, guardrails].filter(Boolean).length,
    scope, actions, verification, guardrails };
}

function historyQuery(fileCount: number): string {
  const parameters = Array.from({ length: fileCount }, (_, i) => `$file${i}:GitTimestamp!`);
  const fields = Array.from({ length: fileCount }, (_, i) =>
    `file${i}:history(first:1,since:$file${i},until:$end){totalCount}`);
  return `query($owner:String!,$name:String!,$head:GitObjectID!,$recent:GitTimestamp!,$end:GitTimestamp!${parameters.length ? "," + parameters.join(",") : ""}) {
    repository(owner:$owner,name:$name) {
      nameWithOwner isPrivate
      object(oid:$head) {
        ... on Commit {
          oid
          recent:history(first:1,since:$recent,until:$end){totalCount}
          ${fields.join("\n")}
        }
      }
    }
  }`;
}

async function commitSignals(
  repo: LandscapeRepository,
  at: string,
  files: LandscapeFile[],
  octokit: Octokit
): Promise<{ recent: number; files: Map<string, number> }> {
  const [owner, name] = repo.full_name.split("/");
  const variables: Record<string, string> = {
    owner, name, head: repo.head_sha,
    recent: new Date(Date.parse(at) - 90 * DAY).toISOString(), end: at,
  };
  files.forEach((file, i) => {
    if (file.last_changed === null) throw new Error("Cannot count commits without file history");
    variables[`file${i}`] = file.last_changed;
  });
  const response: unknown = await octokit.graphql(historyQuery(files.length), variables);
  const found = record(record(response)?.repository);
  const head = record(found?.object);
  if (found?.isPrivate !== false ||
      typeof found.nameWithOwner !== "string" ||
      found.nameWithOwner.toLowerCase() !== repo.full_name.toLowerCase() ||
      head?.oid !== repo.head_sha) {
    throw new Error(`Landscape ${repo.full_name} is no longer verified public at the scanned HEAD`);
  }
  const recent = count(record(head.recent)?.totalCount, `${repo.full_name} recent commits`);
  const counts = new Map<string, number>();
  files.forEach((file, i) =>
    counts.set(file.path, count(record(head[`file${i}`])?.totalCount,
      `${repo.full_name} file history`)));
  return { recent, files: counts };
}

function verifiedText(data: unknown, expectedHash: string): string | null {
  const file = record(data);
  if (file?.type !== "file" || file.encoding !== "base64" ||
      typeof file.content !== "string" || typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) return null;
  const encoded = file.content.replace(/\n/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== file.size ||
      createHash("sha256").update(bytes).digest("hex") !== expectedHash) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

async function fileScore(
  repo: LandscapeRepository,
  file: LandscapeFile,
  octokit: Octokit
): Promise<LandscapeContentSignal | null> {
  const [owner, name] = repo.full_name.split("/");
  try {
    const result = await octokit.rest.repos.getContent({
      owner, repo: name, path: file.path, ref: repo.head_sha,
    });
    const text = verifiedText(result.data, file.sha256);
    if (text === null) {
      console.warn(`Landscape content unavailable or unverified for ${repo.full_name}; rubric unknown`);
      return null;
    }
    return scoreLandscapeContent(text);
  } catch (error: unknown) {
    const status = record(error)?.status;
    if (status === 403 || status === 404) {
      console.warn(`Landscape content inaccessible for ${repo.full_name}; rubric unknown`);
      return null;
    }
    throw error;
  }
}

/**
 * Query pinned public history and grade only hash-verified bytes in memory.
 * Repositories and files beyond the fixed request budget remain unmeasured.
 */
export async function enrichLandscapeScan(
  scan: LandscapeScan,
  octokit: Octokit
): Promise<LandscapeScan> {
  const repositories = scan.repositories.map((repo) =>
    "head_sha" in repo ? { ...repo, ai_files: repo.ai_files.map((file) => ({ ...file })) } : repo);
  let fileBudget = MAX_SIGNAL_FILES;
  let repoBudget = MAX_SIGNAL_REPOS;
  for (const repo of repositories) {
    if (!("head_sha" in repo)) continue;
    repo.commits_90d = null;
    for (const file of repo.ai_files) {
      file.commits_since_change = null;
      file.content_signal = null;
    }
    if (repoBudget-- <= 0) continue;
    const fileLimit = Math.min(MAX_FILES_PER_REPO, fileBudget);
    const eligible = repo.ai_files.filter((file) =>
      file.last_changed !== null && Date.parse(file.last_changed) <= Date.parse(scan.generated_at))
      .slice(0, fileLimit);
    const history = await commitSignals(repo, scan.generated_at, eligible, octokit);
    repo.commits_90d = history.recent;
    for (const file of eligible) {
      file.commits_since_change = history.files.get(file.path) ?? null;
    }
    for (const file of repo.ai_files.slice(0, fileLimit)) {
      file.content_signal = await fileScore(repo, file, octokit);
      fileBudget--;
    }
  }
  return { ...scan, repositories };
}
