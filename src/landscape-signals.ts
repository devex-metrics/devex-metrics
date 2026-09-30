import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { LandscapeContentSignal, LandscapeFile, LandscapeRepository, LandscapeScan } from "./types.js";

export const MAX_SIGNAL_REPOS = 150;
export const MAX_SIGNAL_FILES = 1000;
export const MAX_FILES_PER_REPO = 200;
export const MAX_FILE_BYTES = 64 * 1024;
const HISTORY_BATCH = 20;
const CONTENT_BATCH = 4;
const TEAM_PAGE = 100;
const MAX_TEAM_COMMITS = 500;
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

function historyQuery(fileCount: number, includeTeam: boolean): string {
  const parameters = Array.from({ length: fileCount }, (_, i) => `$file${i}:GitTimestamp!`);
  const fields = Array.from({ length: fileCount }, (_, i) =>
    `file${i}:history(first:1,since:$file${i},until:$end){totalCount}`);
  return `query($owner:String!,$name:String!,$head:GitObjectID!,$month:GitTimestamp!,$recent:GitTimestamp!,$end:GitTimestamp!${parameters.length ? "," + parameters.join(",") : ""}) {
    repository(owner:$owner,name:$name) {
      nameWithOwner isPrivate
      object(oid:$head) {
        ... on Commit {
          oid
          month:history(first:1,since:$month,until:$end){totalCount}
          recent:history(first:1,since:$recent,until:$end){totalCount}
          ${includeTeam ? "team:history(first:100,since:$recent,until:$end){totalCount pageInfo{hasNextPage endCursor} nodes{oid committedDate author{user{login}}}}" : ""}
          ${fields.join("\n")}
        }
      }
    }
  }`;
}

function teamPageQuery(): string {
  return `query($owner:String!,$name:String!,$head:GitObjectID!,$recent:GitTimestamp!,$end:GitTimestamp!,$after:String!) {
    repository(owner:$owner,name:$name) {
      nameWithOwner isPrivate
      object(oid:$head) {
        ... on Commit {
          oid
          team:history(first:100,since:$recent,until:$end,after:$after){
            totalCount pageInfo{hasNextPage endCursor} nodes{oid committedDate author{user{login}}}
          }
        }
      }
    }
  }`;
}

function verifiedHead(data: unknown, repo: LandscapeRepository): Record<string, unknown> | null {
  const found = record(record(data)?.repository);
  const head = record(found?.object);
  if (found?.isPrivate !== false ||
      typeof found.nameWithOwner !== "string" ||
      found.nameWithOwner.toLowerCase() !== repo.full_name.toLowerCase() ||
      head?.oid !== repo.head_sha) {
    console.warn(`Landscape Git history unavailable at the verified public head of ${repo.full_name}`);
    return null;
  }
  return head;
}

async function publicHistory(
  query: string, variables: Record<string, string>, repo: LandscapeRepository, octokit: Octokit
): Promise<unknown> {
  try {
    return await octokit.graphql(query, variables);
  } catch (error: unknown) {
    const status = record(error)?.status;
    if (status === 403 || status === 404) {
      console.warn(`Landscape Git history inaccessible for ${repo.full_name}; counts unknown`);
      return null;
    }
    throw error;
  }
}

async function teamCounts(
  first: unknown, total: number, repo: LandscapeRepository, variables: Record<string, string>,
  at: string, handles: readonly string[], octokit: Octokit
): Promise<{ month: number; recent: number } | null> {
  if (total > MAX_TEAM_COMMITS) {
    console.warn(`Landscape team history exceeds ${MAX_TEAM_COMMITS} commits for ${repo.full_name}`);
    return null;
  }
  const roster = new Set(handles.map((handle) => handle.toLowerCase()));
  const seen = new Set<string>();
  const cutoff = Date.parse(at) - 30 * DAY;
  const earliest = Date.parse(at) - 90 * DAY;
  let month = 0;
  let recent = 0;
  let page: unknown = first;
  for (let offset = 0; offset < MAX_TEAM_COMMITS; offset += TEAM_PAGE) {
    const history = record(page);
    const nodes = history?.nodes;
    const info = record(history?.pageInfo);
    if (typeof history?.totalCount !== "number" || history.totalCount !== total ||
        !Array.isArray(nodes) || nodes.length > TEAM_PAGE ||
        typeof info?.hasNextPage !== "boolean") {
      console.warn(`Landscape team history is incomplete for ${repo.full_name}`);
      return null;
    }
    for (const value of nodes) {
      const node = record(value);
      const login = record(record(node?.author)?.user)?.login;
      const date = typeof node?.committedDate === "string" ? Date.parse(node.committedDate) : NaN;
      if (typeof node?.oid !== "string" || seen.has(node.oid) ||
          !Number.isFinite(date) || date < earliest || date > Date.parse(at) ||
          typeof login !== "string") {
        console.warn(`Landscape team attribution is incomplete for ${repo.full_name}`);
        return null;
      }
      seen.add(node.oid);
      if (roster.has(login.toLowerCase())) {
        recent++;
        if (date >= cutoff) month++;
      }
    }
    if (!info.hasNextPage) {
      if (seen.size !== total) {
        console.warn(`Landscape team history is incomplete for ${repo.full_name}`);
        return null;
      }
      return { month, recent };
    }
    if (typeof info.endCursor !== "string" || !info.endCursor ||
        seen.size >= total || offset + TEAM_PAGE >= MAX_TEAM_COMMITS) {
      console.warn(`Landscape team pagination is incomplete for ${repo.full_name}`);
      return null;
    }
    const response = await publicHistory(teamPageQuery(),
      { ...variables, after: info.endCursor }, repo, octokit);
    if (!response) return null;
    const head = verifiedHead(response, repo);
    if (!head) return null;
    page = head.team;
  }
  return null;
}

async function commitSignals(
  repo: LandscapeRepository, at: string, files: LandscapeFile[],
  handles: readonly string[], octokit: Octokit
): Promise<{ month: number; recent: number; team: { month: number; recent: number } | null;
  files: Map<string, number> } | null> {
  const [owner, name] = repo.full_name.split("/");
  const variables: Record<string, string> = {
    owner, name, head: repo.head_sha,
    month: new Date(Date.parse(at) - 30 * DAY).toISOString(),
    recent: new Date(Date.parse(at) - 90 * DAY).toISOString(), end: at,
  };
  const counts = new Map<string, number>();
  let month = 0;
  let recent = 0;
  let team: { month: number; recent: number } | null = null;
  for (let start = 0; start < Math.max(1, files.length); start += HISTORY_BATCH) {
    const batch = files.slice(start, start + HISTORY_BATCH);
    const batchVariables = { ...variables };
    batch.forEach((file, index) => { batchVariables[`file${index}`] = file.last_changed!; });
    const response = await publicHistory(
      historyQuery(batch.length, start === 0 && handles.length > 0), batchVariables, repo, octokit
    );
    if (!response) return null;
    const head = verifiedHead(response, repo);
    if (!head) return null;
    const thisMonth = count(record(head.month)?.totalCount, `${repo.full_name} 30-day commits`);
    const thisRecent = count(record(head.recent)?.totalCount, `${repo.full_name} 90-day commits`);
    if (thisMonth > thisRecent || (start > 0 && (thisMonth !== month || thisRecent !== recent)))
      throw new Error(`Landscape Git history windows disagree for ${repo.full_name}`);
    month = thisMonth;
    recent = thisRecent;
    batch.forEach((file, index) => {
      const observed = count(record(head[`file${index}`])?.totalCount,
        `${repo.full_name} commits since change`);
      if (Date.parse(file.last_changed!) >= Date.parse(variables.recent) && observed > recent)
        throw new Error(`Landscape file history exceeds 90-day commits for ${repo.full_name}`);
      counts.set(file.path, observed);
    });
    if (start === 0 && handles.length > 0)
      team = await teamCounts(head.team, recent, repo, variables, at, handles, octokit);
  }
  return { month, recent, team, files: counts };
}

function verifiedText(data: unknown, expectedHash: string): string | null {
  const file = record(data);
  if (file?.type !== "file" || file.encoding !== "base64" ||
      typeof file.content !== "string" || typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) return null;
  const encoded = file.content.replace(/\n/g, "");
  if (encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
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

async function fileScore(repo: LandscapeRepository, file: LandscapeFile, octokit: Octokit): Promise<LandscapeContentSignal | null> {
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
 * Query pinned public Git history and grade hash-verified bytes in memory only.
 * Fixed request/file budgets leave unmeasured signals null, never zero.
 */
export async function enrichLandscapeScan(
  scan: LandscapeScan, octokit: Octokit, handles: readonly string[] = []
): Promise<LandscapeScan> {
  const repositories = scan.repositories.map((repo) =>
    "head_sha" in repo ? { ...repo, ai_files: repo.ai_files.map((file) => ({ ...file })) } : repo);
  let fileBudget = MAX_SIGNAL_FILES;
  let repoBudget = MAX_SIGNAL_REPOS;
  for (const repo of repositories) {
    if (!("head_sha" in repo)) continue;
    repo.commits_30d = null;
    repo.commits_90d = null;
    repo.team_commits_30d = null;
    repo.team_commits_90d = null;
    for (const file of repo.ai_files) {
      file.commits_since_change = null;
      file.content_signal = null;
    }
    if (repoBudget-- <= 0) {
      if (repoBudget === -1) console.warn(`Landscape signals limited to ${MAX_SIGNAL_REPOS} repositories`);
      continue;
    }
    const batch = repo.ai_files.slice(0, Math.min(MAX_FILES_PER_REPO, fileBudget));
    if (batch.length < repo.ai_files.length)
      console.warn(`Landscape signals limited to ${batch.length} of ${repo.ai_files.length} files in ${repo.full_name}`);
    const eligible = batch.filter((file) =>
      file.last_changed !== null && Date.parse(file.last_changed) <= Date.parse(scan.generated_at));
    const history = await commitSignals(repo, scan.generated_at, eligible, handles, octokit);
    if (!history) continue;
    repo.commits_30d = history.month;
    repo.commits_90d = history.recent;
    repo.team_commits_30d = history.team?.month ?? null;
    repo.team_commits_90d = history.team?.recent ?? null;
    for (const file of eligible) file.commits_since_change = history.files.get(file.path) ?? null;
    for (let start = 0; start < batch.length; start += CONTENT_BATCH) {
      const group = batch.slice(start, start + CONTENT_BATCH);
      const scores = await Promise.all(group.map((file) => fileScore(repo, file, octokit)));
      group.forEach((file, index) => { file.content_signal = scores[index]; });
    }
    fileBudget -= batch.length;
  }
  return { ...scan, repositories };
}
