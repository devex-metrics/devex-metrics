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
  /** Weekly activity trends aggregated across all repos (last ~2 years). */
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
  /** Weekly activity trends for this repository (last ~2 years). */
  weeklyTrends?: WeeklyTrendPoint[];
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
  /** Copilot agent (coding agent) task metrics for this repository. */
  copilotAgentMetrics?: CopilotAgentMetrics;
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
  /** True when the PR was authored by any AI tool (Copilot, Claude, or Codex). */
  isCopilotAuthored: boolean;
  /** Which AI tool authored this PR ('copilot', 'claude', or 'codex'); undefined for human/other-bot authors. */
  aiAuthorType?: "copilot" | "claude" | "codex";
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
  /** True when PR was authored by any AI tool (Copilot, Claude, or Codex). */
  isCopilotAuthored: boolean;
  /** Which AI tool authored this PR ('copilot', 'claude', or 'codex'); undefined for human/other-bot authors. */
  aiAuthorType?: "copilot" | "claude" | "codex";
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
  /** Number of merged PRs authored by any AI tool (Copilot, Claude, or Codex). */
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

// ── Copilot Agent (coding agent / cloud agent) types ──────────────────────────

/** An individual session within a Copilot agent task. */
export interface CopilotAgentSession {
  /** Session UUID. */
  id: string;
  /** Session state (e.g. "completed", "failed", "in_progress"). */
  state: string;
  /**
   * Detected session source.
   * `cloud-agent` when the session has a non-empty model string or a `usage`
   * field (Copilot coding agent / cloud agent).
   * `cli-remote` otherwise (Copilot CLI / remote session).
   */
  source: "cloud-agent" | "cli-remote";
  /** Branch the session worked on. */
  headRef?: string;
  /** Base branch the session branched from. */
  baseRef?: string;
  /** Model identifier with the "sweagent-capi:" prefix stripped. */
  model?: string;
  /** ISO-8601 timestamp when the session was created. */
  createdAt: string;
  /** ISO-8601 timestamp when the session completed (terminal states only). */
  completedAt?: string;
  /** Credits consumed (cloud-agent sessions only, if reported by the API). */
  usageCredits?: number;
  /** Credit type (e.g. "premium"). */
  usageType?: string;
  /** Error message if the session failed. */
  errorMessage?: string;
  /** Hours from `createdAt` to `completedAt` (undefined when not completed). */
  durationHours?: number;
}

/** A Copilot agent task. One task can spawn multiple sessions. */
export interface CopilotAgentTask {
  /** Task UUID. */
  id: string;
  /** Human-readable task name (typically the user prompt summary). */
  name: string;
  /** Task state (e.g. "completed", "failed", "in_progress"). */
  state: string;
  /** ISO-8601 timestamp when the task was created. */
  createdAt: string;
  /** ISO-8601 timestamp when the task was last updated. */
  updatedAt: string;
  /** URL to the task in the GitHub UI. */
  htmlUrl: string;
  /** Sessions that ran as part of this task. */
  sessions: CopilotAgentSession[];
  /** PR numbers produced by this task (resolved from task artifacts). */
  prNumbers: number[];
}

/** Aggregated Copilot agent metrics for a single repository. */
export interface CopilotAgentMetrics {
  /** Total agent tasks in the collection window. */
  totalTasks: number;
  /** Tasks in the `completed` terminal state. */
  completedTasks: number;
  /** Tasks in the `failed` terminal state. */
  failedTasks: number;
  /** Tasks in the `cancelled` terminal state. */
  cancelledTasks: number;
  /** Tasks in the `timed_out` terminal state. */
  timedOutTasks: number;
  /** Tasks currently in an active state (in_progress / queued / idle / waiting_for_user). */
  activeTasksCount: number;
  /** Total sessions across all tasks. */
  totalSessions: number;
  /** Sessions identified as Copilot cloud agent sessions. */
  cloudAgentSessions: number;
  /** Sessions identified as Copilot CLI / remote sessions. */
  cliRemoteSessions: number;
  /** Sum of credits consumed across all cloud-agent sessions. */
  totalCreditsUsed: number;
  /** Average duration in hours for sessions that have completed. */
  avgCompletedSessionHours?: number;
  /** ISO-8601 timestamp of the most recently created task in this window. */
  lastTaskAt?: string;
  /** Number of distinct PRs produced by agent tasks. */
  agentCreatedPRs: number;
  /** Total GitHub Actions check-run minutes consumed on PRs created by agent tasks. */
  agentActionsMinutes: number;
}

/** Shape of the per-repo agent cache file (`data/agents-{owner}-{repo}.json`). */
export interface CopilotAgentRepoCache {
  /** Cache schema version. Bump in agent-cache.ts when the stored shape changes. */
  schemaVersion: number;
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** ISO-8601 timestamp of last active-tasks refresh. */
  activeRefreshedAt: string;
  /**
   * Tasks in terminal states (completed / failed / cancelled / timed_out).
   * These are cached permanently — terminal task data is immutable.
   */
  terminalTasks: CopilotAgentTask[];
  /** Tasks in active states — replaced on each fresh collection. */
  activeTasks: CopilotAgentTask[];
  /**
   * Cached GitHub Actions check-run minutes per PR number (string key).
   * Only closed/merged PRs are cached here; open PRs are refetched each run.
   */
  perPRActionsMinutes?: Record<string, number>;
}
