/**
 * Core types for devex-metrics data collection.
 */

/** Top-level metrics for an org or user. */
export interface OrgMetrics {
  /**
   * Cache schema version. Compared against `CURRENT_SCHEMA_VERSION` in
   * `cache.ts` when loading cached data. Absent in pre-versioning fixtures.
   */
  schemaVersion?: number;
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
   * Enriched timeline of the last ~1 000 merged PRs (up to 10 pages × 100).
   * Includes author, timing, and issue-ref data extracted from the cheap
   * pulls.list call (no per-PR detail fetches).
   */
  mergedPRTimeline?: MergedPRSummary[];
  /** Per-repo Copilot adoption summary. */
  copilotAdoption?: CopilotAdoption;
  /** Lead-time data for issues referenced by merged PRs. */
  issueLeadTimes?: IssueLeadTime[];
  /** Unique committers in the default branch (last 90 days). */
  committerCount: number;
  /** Unique PR reviewers (last 90 days). */
  reviewerCount: number;
  /** Unique contributors (union of committers and reviewers, last 90 days). */
  contributorCount: number;
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
  /** ISO-8601 timestamp when the PR was created. */
  createdAt: string;
  /** GitHub login of the PR author. */
  author: string;
  /** True when the PR was authored by copilot[bot] (Copilot Cloud Agent). */
  isCopilotAuthored: boolean;
  /** True when the PR received a review from copilot[bot] (Copilot Review). */
  hasCopilotReview: boolean;
  linesAdded: number;
  linesDeleted: number;
  commentCount: number;
  commitCount: number;
  /** Total GitHub Actions minutes consumed by check-suites on this PR (0 if unavailable). */
  actionsMinutes: number;
  /** Hours from PR created to PR merged (undefined if not merged). */
  timeToMergeHours?: number;
  /** ISO-8601 date when the PR was merged. */
  mergedAt?: string;
}

/** Lightweight timeline entry for each merged PR (from paginated pulls.list). */
export interface MergedPRSummary {
  /** PR number. */
  number: number;
  /** ISO-8601 timestamp when the PR was created. */
  createdAt: string;
  /** ISO-8601 timestamp when the PR was merged. */
  mergedAt: string;
  /** GitHub login of the PR author. */
  author: string;
  /** True when PR author is a bot (dependabot[bot], copilot[bot], etc.). */
  isBotAuthor: boolean;
  /** True when PR was authored by copilot[bot] (Copilot Cloud Agent). */
  isCopilotAuthored: boolean;
  /** Hours from PR created to PR merged. */
  timeToMergeHours: number;
  /** Issue numbers referenced via "Fixes #N" / "Closes #N" in the PR body. */
  closesIssues: number[];
  /**
   * Lines added by this PR. Populated when the timeline is sourced from
   * GraphQL (which exposes additions/deletions on the PR node for free);
   * undefined when sourced from the REST fallback path, which only paginates
   * `pulls.list` and does not fetch per-PR detail.
   */
  linesAdded?: number;
  /** Lines deleted by this PR. See `linesAdded` for source caveats. */
  linesDeleted?: number;
}

/** Per-repo Copilot adoption summary. */
export interface CopilotAdoption {
  /** Number of merged PRs authored by copilot[bot]. */
  copilotAuthoredPRs: number;
  /** Number of detailed PRs that received a Copilot review. */
  copilotReviewedPRs: number;
  /** Total merged PRs in the timeline (denominator for authored %). */
  totalMergedPRs: number;
  /** Total detailed PRs sampled (denominator for reviewed %). */
  totalDetailedPRs: number;
}

/** Lead-time data for an issue resolved by a merged PR. */
export interface IssueLeadTime {
  /** The issue number. */
  issueNumber: number;
  /** ISO-8601 timestamp when the issue was created. */
  issueCreatedAt: string;
  /** The PR number that closed this issue. */
  prNumber: number;
  /** ISO-8601 timestamp when the closing PR was merged. */
  prMergedAt: string;
  /** Hours from issue creation to PR merge. */
  leadTimeHours: number;
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
