/**
 * Core types for devex-metrics data collection.
 */

/** Top-level metrics for an org or user. */
export interface OrgMetrics {
  /** GitHub org or user login name. */
  owner: string;
  /** Whether target is an organization or user. */
  ownerType: "org" | "user";
  /** ISO-8601 timestamp when data was collected. */
  collectedAt: string;
  /** Total number of repositories. */
  repoCount: number;
  /** Per-repo metrics. */
  repos: RepoMetrics[];
  /** Weekly activity trends aggregated across all repos (last ~12 weeks). */
  weeklyTrends?: WeeklyTrendPoint[];
}

/** Aggregated metrics for a single repository. */
export interface RepoMetrics {
  name: string;
  fullName: string;
  /** ISO-8601 date when the repository was last pushed to. */
  pushedAt?: string;
  /** ISO-8601 timestamp when metrics for this repo were last collected. */
  collectedAt?: string;
  /** Issue counts by state. */
  issues: IssueCounts;
  /** Pull request counts by state. */
  pullRequests: PullRequestCounts;
  /** Detailed PR metrics (sampled from recently closed PRs). */
  pullRequestDetails: PullRequestDetail[];
  /**
   * ISO-8601 merged_at timestamps for the last ~100 merged PRs.
   * Used by the chart filter to show accurate per-period breakdowns.
   * Collected with a single cheap API call (no per-PR detail fetches).
   */
  mergedPRDates?: string[];
  /** Unique committers in the default branch (last 90 days). */
  committerCount: number;
  /** Unique PR reviewers (last 90 days). */
  reviewerCount: number;
  /** Number of repositories that depend on this repo (from dependency graph). */
  dependentCount: number;
}

export interface IssueCounts {
  open: number;
  closed: number;
}

export interface PullRequestCounts {
  open: number;
  closed: number;
  merged: number;
}

/** Detailed metrics for an individual pull request. */
export interface PullRequestDetail {
  number: number;
  title: string;
  state: string;
  linesAdded: number;
  linesDeleted: number;
  commentCount: number;
  commitCount: number;
  /** Total GitHub Actions minutes consumed by check-suites on this PR (0 if unavailable). */
  actionsMinutes: number;
  /** ISO-8601 date when the PR was merged. */
  mergedAt?: string;
}

/** One data point in a weekly activity trend series. */
export interface WeeklyTrendPoint {
  /** ISO week label, e.g. "2024-W03". */
  week: string;
  prsOpened: number;
  prsMerged: number;
  issuesOpened: number;
  issuesClosed: number;
  /** Total lines added across all merged PRs in this week. */
  linesAdded: number;
  /** Total lines deleted across all merged PRs in this week. */
  linesDeleted: number;
}

/** Shape of the on-disk cache file. */
export interface CacheEnvelope {
  /** ISO-8601 date (YYYY-MM-DD) the data was collected. */
  date: string;
  data: OrgMetrics;
}
