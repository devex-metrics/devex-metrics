import { getOctokit } from "../github-client.js";
import { matchesGlobs } from "../config.js";
import type { DevexConfig } from "../config.js";

/** A repository as returned by discovery, before any metrics are collected. */
export interface DiscoveredRepo {
  name: string;
  fullName: string;
  /** ISO-8601 date of the last push ("" when GitHub reports none). */
  pushedAt: string;
  /** True when the repository is archived. */
  archived: boolean;
  /** True when the repository is a fork. */
  fork: boolean;
  /** True when the repo matches the configured team globs. */
  isTeamRepo: boolean;
  /**
   * Default branch. Comes free with the same listing call and is what the CI
   * crawl treats as the trunk; empty when GitHub reports none.
   */
  defaultBranch: string;
}

interface RawRepo {
  name: string;
  full_name: string;
  pushed_at?: string | null;
  archived?: boolean;
  fork?: boolean;
  default_branch?: string | null;
}

function toDiscovered(repo: RawRepo): DiscoveredRepo {
  return {
    name: repo.name,
    fullName: repo.full_name,
    pushedAt: repo.pushed_at ?? "",
    archived: repo.archived ?? false,
    fork: repo.fork ?? false,
    isTeamRepo: false,
    defaultBranch: repo.default_branch ?? "",
  };
}

/**
 * Fetch all repos for an org or user.
 * Returns basic repo info used by downstream collectors.
 */
export async function collectRepos(
  owner: string,
  ownerType: "org" | "user"
): Promise<DiscoveredRepo[]> {
  const octokit = await getOctokit();
  const repos: DiscoveredRepo[] = [];

  if (ownerType === "org") {
    for await (const response of octokit.paginate.iterator(
      octokit.rest.repos.listForOrg,
      { org: owner, per_page: 100, type: "all" }
    )) {
      for (const repo of response.data) {
        repos.push(toDiscovered(repo));
      }
    }
  } else {
    // GET /users/{username}/repos only returns repos where the user is an
    // explicit per-repo collaborator — it misses org repos accessible purely
    // via org membership (even public ones). When the token belongs to the
    // same user we're collecting for, use GET /user/repos instead, which
    // includes repos reachable through org membership.
    let useAuthEndpoint = false;
    try {
      const { data: authUser } = await octokit.rest.users.getAuthenticated();
      useAuthEndpoint = authUser.login.toLowerCase() === owner.toLowerCase();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 401 && status !== 403) {
        // Unexpected error — log and fall back gracefully
        console.warn(`  ⚠ repos: could not determine authenticated user, falling back to public list: ${String(err)}`);
      }
      // 401/403 means the token has no user context (e.g. GitHub App) — silent fallback
    }

    if (useAuthEndpoint) {
      for await (const response of octokit.paginate.iterator(
        octokit.rest.repos.listForAuthenticatedUser,
        { per_page: 100, type: "all" }
      )) {
        for (const repo of response.data) {
          repos.push(toDiscovered(repo));
        }
      }
    } else {
      for await (const response of octokit.paginate.iterator(
        octokit.rest.repos.listForUser,
        { username: owner, per_page: 100, type: "all" }
      )) {
        for (const repo of response.data) {
          repos.push(toDiscovered(repo));
        }
      }
    }
  }
  return repos;
}

/** What `filterRepos` decided, for the run log. */
export interface RepoFilterResult {
  repos: DiscoveredRepo[];
  /** Number of repos dropped, keyed by the rule that dropped them. */
  dropped: Record<string, number>;
}

/**
 * Apply the configured repository filters and flag the team's repos.
 *
 * When `team.discoverAll` is false the team globs act as a hard filter, so a
 * trial can be collected without paying for the rest of the organisation.
 * When it is true (the default) every repo is kept — the org is the baseline —
 * and the team's repos are merely flagged.
 */
export function filterRepos(
  repos: readonly DiscoveredRepo[],
  config: DevexConfig
): RepoFilterResult {
  const { include, exclude, excludeArchived, excludeForks, maxIdleDays } = config.repos;
  const teamGlobs = config.team?.repos ?? [];
  const teamOnly = config.team !== undefined && !config.team.discoverAll;

  const dropped: Record<string, number> = {};
  const drop = (reason: string): false => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
    return false;
  };

  const idleCutoff =
    maxIdleDays > 0 ? Date.now() - maxIdleDays * 24 * 60 * 60 * 1000 : null;

  const kept = repos.filter((repo) => {
    if (excludeArchived && repo.archived) return drop("archived");
    if (excludeForks && repo.fork) return drop("fork");
    if (include.length > 0 && !matchesGlobs(repo.fullName, include)) {
      return drop("not included");
    }
    if (exclude.length > 0 && matchesGlobs(repo.fullName, exclude)) {
      return drop("excluded");
    }
    if (teamOnly && !matchesGlobs(repo.fullName, teamGlobs)) {
      return drop("outside team");
    }
    if (idleCutoff !== null) {
      // A repo with no recorded push has never been written to; treat it as idle.
      const pushed = repo.pushedAt ? new Date(repo.pushedAt).getTime() : 0;
      if (!Number.isFinite(pushed) || pushed < idleCutoff) return drop("idle");
    }
    return true;
  });

  return {
    repos: kept.map((repo) => ({
      ...repo,
      isTeamRepo: matchesGlobs(repo.fullName, teamGlobs),
    })),
    dropped,
  };
}

/** Render `filterRepos` bookkeeping as a single log line. */
export function describeFiltering(
  discovered: number,
  result: RepoFilterResult
): string {
  const reasons = Object.entries(result.dropped)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");
  const teamCount = result.repos.filter((r) => r.isTeamRepo).length;
  const parts = [`${result.repos.length}/${discovered} repositories kept`];
  if (reasons) parts.push(`skipped ${reasons}`);
  if (teamCount > 0) parts.push(`${teamCount} flagged as team repos`);
  return parts.join(" · ");
}
