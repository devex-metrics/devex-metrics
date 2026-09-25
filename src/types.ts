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
  /**
   * Human-friendly name for a custom dataset collected from an explicit list
   * of repos (e.g. discovered from a local folder) rather than a full
   * org/user listing. Used to label and store this data as its own local
   * "group" separate from the main owner-based dataset. Absent for regular
   * org/user collections.
   */
  groupName?: string;
  /**
   * Where this data came from: a fresh API collection, the daily cache, or an
   * explicitly opted-in fixture. Surfaced in the dashboard so a stale page is
   * never mistaken for a fresh one.
   */
  dataSource?: "fresh" | "cache" | "fixture";
  /** The team under study, when one is configured. */
  team?: TeamSummary;
  /** The improvement trial this collection is measuring, when one is configured. */
  trial?: TrialSummary;
}

/** Sanitized, portable v1 repo-landscape scan; never contains file contents or evidence. */
export interface LandscapeScan {
  /** Portable JSON contract version. */
  schema_version: 1;
  /** ISO-8601 time of this scan. */
  generated_at: string;
  /** Version of the external scanner which produced the observation. */
  scanner_version: string;
  /** Public repositories observed or explicitly reported unavailable. */
  repositories: (LandscapeRepository | LandscapeUnavailableRepository)[];
}

/** An explicitly denied or failed scan; it carries no file or path data. */
export interface LandscapeUnavailableRepository {
  /** Canonical GitHub owner/repository name. */
  full_name: string;
  /** The scanner could not observe this repository. */
  status: "denied" | "error";
}

/** One public repository's observed AI instruction files at a specific head. */
export interface LandscapeRepository {
  /** Canonical GitHub owner/repository name. */
  full_name: string;
  /** Commit SHA from which the files were observed. */
  head_sha: string;
  /** Paths and content hashes only, never file contents. */
  ai_files: LandscapeFile[];
  /** Counts derived from the observed files. */
  ai_summary: LandscapeSummary;
}

/** Public instruction-file metadata, sanitized from the scanner's output. */
export interface LandscapeFile {
  /** Relative Git path, permitted for public repositories only. */
  path: string;
  /** Scanner's classification of this instruction file. */
  kind: string;
  /** SHA-256 of the contents, not the contents themselves. */
  sha256: string;
  /** Last changed time, or null when file history is unavailable. */
  last_changed: string | null;
  /** Age in days, or null when file history is unavailable. */
  age_days: number | null;
  /** Lag from the current head in days, or null when history is unavailable. */
  lag_days: number | null;
  /** Scanner's age signal; null is unknown, not "not stale". */
  stale: boolean | null;
  /** Whether historical file signals could be established. */
  status: "known" | "unknown";
}

/** File counts and known/unknown age-signal coverage. */
export interface LandscapeSummary {
  /** Number of observed instruction files. */
  count: number;
  /** Number with a positive stale signal (not a correctness assessment). */
  stale_count: number;
  /** Maximum known lag in days, or null if no lag is known. */
  max_lag_days: number | null;
  /** Number of files without historical age signals. */
  unknown_count: number;
  /** Known or partial_unknown when one or more file histories are unknown. */
  status: "known" | "partial_unknown";
}

/** Observed path changes relative to the last successful scan of this repo. */
export interface LandscapeDrift {
  /** Time of the successful observation compared against. */
  compared_at: string;
  /** Head commit of that successful observation. */
  compared_head_sha: string;
  /** Paths absent before and present now. */
  added: string[];
  /** Paths present before but absent now. */
  removed: string[];
  /** Paths whose SHA-256 changed at the same path. */
  content_changed: string[];
}

/** A DevEx repository joined to landscape observations, including unknowns. */
export interface LandscapeRepoView {
  /** Canonical DevEx owner/repository name. */
  fullName: string;
  /** No observation is represented as unknown, never as zero files. */
  status: "observed" | "unknown";
  /** Why this repository has no trusted observation. */
  reason?: "private" | "visibility_unknown" | "not_scanned" | "denied" | "scan_error";
  /** Scan time for an observed repository. */
  collectedAt?: string;
  /** Scanner version for an observed repository. */
  scannerVersion?: string;
  /** Head commit for an observed repository. */
  headSha?: string;
  /** Files from the newest successful observation, for public repositories only. */
  files?: LandscapeFile[];
  /** Summary for an observed repository. */
  summary?: LandscapeSummary;
  /** Changes from its last successful observation, if one exists. */
  drift?: LandscapeDrift;
}

/** The configured team, copied into the dataset so the site can render it. */
export interface TeamSummary {
  /** Stable identifier, also used in share URLs. */
  id: string;
  /** Display name. */
  name: string;
  /** Full names ("owner/repo") of the repositories in the team. */
  repos: string[];
  /** True when the whole org was collected to form a baseline. */
  discoverAll: boolean;
}

/** The configured trial, copied into the dataset so the site can render it. */
export interface TrialSummary {
  /** Headline shown above the comparison. */
  title: string;
  /** What the intervention is expected to change. */
  hypothesis?: string;
  /** ISO-8601 date the intervention started. */
  interventionStart?: string;
  /** Start of the baseline window (ISO-8601 date). */
  baselineFrom?: string;
  /** End of the baseline window (ISO-8601 date). */
  baselineTo?: string;
  /** Dated milestones rendered as secondary chart annotations. */
  milestones: { date: string; label: string }[];
}

/** Aggregated metrics for a single repository. */
export interface RepoMetrics {
  name: string;
  fullName: string;
  /**
   * GitHub repository privacy from discovery. Absent in older snapshots; an
   * unknown visibility is never treated as public for landscape scanning.
   */
  isPrivate?: boolean;
  /** ISO-8601 date when the repository was last pushed to. */
  pushedAt?: string;
  /**
   * Default branch, from repository discovery. Absent in data collected before
   * it was recorded; the CI crawl skips a repository whose trunk it does not
   * know rather than guessing one.
   */
  defaultBranch?: string;
  /** ISO-8601 timestamp when metrics for this repo were last collected. */
  collectedAt?: string;
  /**
   * True when this repository matches the configured team globs. Absent in
   * data collected before teams existed, which reads as "not a team repo".
   */
  isTeamRepo?: boolean;
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
  /**
   * Pull requests closed without merging, from the same GraphQL page as the
   * merged ones. Absent in data collected before abandonment was tracked.
   */
  closedPRTimeline?: ClosedPRSummary[];
  /**
   * Up to 100 of the oldest pull requests still open at collection time per
   * repository. Used for the median age of open work and the review queue;
   * absent when GraphQL collection is unavailable.
   */
  openPRTimeline?: OpenPRSummary[];
  /**
   * Reviews per reviewer across the collected pull requests, for review-load
   * concentration. Bot accounts (e.g. `dependabot[bot]`) are excluded, and
   * only PRs from the collected review timeline (same population as
   * `mergedPRTimeline` / `closedPRTimeline`, roughly the last ~2 years)
   * contribute — a different population from `reviewerCount` below. Absent
   * in older data.
   */
  reviewerLoad?: ReviewerLoad[];
  /** Lead-time data for issues referenced by merged PRs. */
  issueLeadTimes?: IssueLeadTime[];
  /** Unique committers on the default branch in the last 90 days (by commit author login/email). */
  committerCount: number;
  /**
   * Unique accounts that submitted at least one pull request review
   * (approval, comment, or changes-requested), sampled from the collected
   * PR review timeline (GraphQL: roughly the last ~2 years; REST: the 50 most
   * recently updated PRs; neither is a strict 90-day window despite sharing a
   * row with `committerCount`). Unlike
   * `reviewerLoad`, this includes bot accounts.
   */
  reviewerCount: number;
  /** Unique contributors (union of committers and reviewers). See `committerCount` and `reviewerCount` for each side's window and bot-inclusion rules. */
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
  /**
   * True when any AI tool (Copilot, Claude, or Codex) is attributed to this
   * PR — despite the name, this is **not** Copilot-specific; see
   * `MergedPRSummary.isCopilotAuthored` for the exact attribution rules.
   */
  isCopilotAuthored: boolean;
  /** Which AI tool authored this PR ('copilot', 'claude', or 'codex'); undefined for human/other-bot authors. */
  aiAuthorType?: "copilot" | "claude" | "codex";
  /** True when the PR received a review from a Copilot code review bot. */
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
  /**
   * True when *any* AI tool — Copilot, Claude, or Codex, not Copilot alone
   * despite the field name — is attributed to this PR. A match on any of the
   * following marks it true (first match wins, see `aiAuthorType`):
   *  1. The PR author's login/type (e.g. `copilot[bot]`, `copilot-swe-agent`,
   *     `claude[bot]`, `codex[bot]`, and their `[agent]` / dedicated-account
   *     variants).
   *  2. A `Co-authored-by:` trailer in the merge-commit message.
   *  3. A `Co-authored-by:` trailer, or an AI tool's noreply commit email, on
   *     any of the first 10 commits (GraphQL path only — AI co-authorship
   *     beyond that window is not detected).
   *  4. Known prose signatures in the PR body (e.g. "generated by Copilot").
   *
   * Rules 2, 3, and 4 are only checked on the GraphQL collection path; the
   * REST merged-PR timeline checks only rule 1 (PR-author login), so AI
   * co-authorship via merge commits, individual commits, or PR-body text is
   * not detected when the timeline comes from REST.
   *
   * This means a **human-authored PR that merely includes one AI-assisted
   * commit counts as AI-authored** — it is not restricted to PRs opened by
   * an AI account. Generic dependency bots (`dependabot[bot]`,
   * `renovate[bot]`, etc.) are not matched by these rules and are not
   * expected to be misclassified, unless their commit/PR text happens to
   * contain one of the patterns above.
   */
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
  /**
   * When the first review was submitted. A raw fact, not a latency: the
   * definition of "review latency" is free to change without re-collecting.
   */
  firstReviewAt?: string;
  /** When the first approving review was submitted. */
  firstApprovalAt?: string;
  /** Total reviews submitted on the PR. */
  reviewCount?: number;
  /** PR conversation comments (excludes inline review comments). */
  conversationCommentCount?: number;
  /** Number of inline review threads (not individual comments). GraphQL only. */
  reviewThreadCount?: number;
  /** Recorded commit timestamps from up to the last 100 PR commits, in GitHub's order. */
  recentCommitDates?: string[];
  /** Total number of PR commits; compare with recentCommitDates.length for sample coverage. */
  totalCommitCount?: number;
  /** Reviews that requested changes — one per review round. */
  changesRequestedCount?: number;
  /**
   * The pull request this one reverts, when its body carries GitHub's
   * "Reverts owner/repo#N" reference. Absent for hand-written reverts that
   * drop the reference, so revert rates read as a lower bound.
   */
  revertsPR?: number;
}

/**
 * A pull request closed without being merged.
 *
 * Collected from the same GraphQL page as the merged ones — the query already
 * asks for CLOSED and MERGED together — so abandonment costs no extra calls.
 */
export interface ClosedPRSummary {
  /** PR number. */
  number: number;
  /** ISO-8601 timestamp when the PR was created. */
  createdAt: string;
  /** ISO-8601 timestamp when the PR was closed. */
  closedAt: string;
  /** GitHub login of the PR author. */
  author: string;
  /** True when the PR author is a bot. */
  isBotAuthor: boolean;
  /** Which AI tool authored this PR; undefined for human/other-bot authors. */
  aiAuthorType?: "copilot" | "claude" | "codex";
  /** Lines added by this PR. */
  linesAdded?: number;
  /** Lines deleted by this PR. */
  linesDeleted?: number;
}

/** A pull request still open when the collection ran. */
export interface OpenPRSummary {
  /** PR number. */
  number: number;
  /** PR title, for identifying the waiting work. */
  title: string;
  /** ISO-8601 timestamp when the PR was created. */
  createdAt: string;
  /** True while the PR is still a draft and not yet ready for review. */
  isDraft: boolean;
  /** Whether at least one submitted review was recorded, including dismissed reviews. */
  hasReview: boolean;
  /** GitHub login of the PR author. */
  author: string;
  /** True when the PR author is a bot. */
  isBotAuthor: boolean;
  /** Which AI tool authored this PR; undefined for human/other-bot authors. */
  aiAuthorType?: "copilot" | "claude" | "codex";
}

/**
 * One completed CI run, reduced to what the dashboard needs.
 *
 * Built at site-build time from the CI run stream, not stored in `OrgMetrics`:
 * CI health is crawled on its own budgeted watermark and lives in its own
 * append-only file, so it never enters the daily collection's cache.
 */
export interface CiRunSample {
  /** Bare repository name, so the dashboard's repo filter matches on it. */
  repo: string;
  /** Workflow name, for attributing a failure to a pipeline. */
  workflow: string;
  /** ISO-8601 timestamp when the run finished. */
  finishedAt: string;
  /** True when the final attempt concluded successfully. */
  success: boolean;
  /** True when the run passed only after a re-run of the same commit. */
  flaky: boolean;
  /** Wall-clock minutes from runner pickup to conclusion. */
  durationMinutes?: number;
  /** Minutes the run waited for a runner before starting. */
  queueMinutes?: number;
}

/**
 * How many reviews one (human, non-bot) reviewer submitted in the collected
 * PR review window. See `RepoMetrics.reviewerLoad` for the exact population.
 */
export interface ReviewerLoad {
  /** Reviewer's GitHub login. */
  reviewer: string;
  /** Reviews submitted across the collected pull requests. */
  reviews: number;
}

/** Per-repo Copilot adoption summary. */
export interface CopilotAdoption {
  /**
   * Number of merged PRs with *any* AI tool attributed — Copilot, Claude, or
   * Codex, despite the field name. See `MergedPRSummary.isCopilotAuthored`
   * for the exact attribution rules (author login, commit co-author
   * trailers/emails, or PR body signatures — a human-opened PR containing
   * one AI-assisted commit counts; commit and PR-body matching are
   * GraphQL-path only). Measured over `totalMergedPRs` (the
   * collected history window, roughly the last ~2 years / 1,000 most
   * recently updated merged PRs per repo), not a calendar-fixed window.
   */
  copilotAuthoredPRs: number;
  /**
   * Number of detailed PRs that received a review from a Copilot code review bot
   * specifically (unlike `copilotAuthoredPRs`, this one really is
   * Copilot-only — Claude/Codex reviews are not counted). Measured over
   * `totalDetailedPRs`, up to 10 PRs per repo: the REST fallback starts from
   * the 10 most recently updated closed PRs before filtering to merged, while
   * the GraphQL path selects the 10 most recently merged from the fetched
   * timeline, a much smaller population than the merged-PR timeline used for
   * authorship.
   */
  copilotReviewedPRs: number;
  /** Total merged PRs in the collected timeline (includes bots; denominator for `copilotAuthoredPRs`). */
  totalMergedPRs: number;
  /** Total detailed PRs sampled — up to 10 per repo (denominator for `copilotReviewedPRs`). */
  totalDetailedPRs: number;
  /** Merged PRs authored by humans (excludes all bots and AI tools). Not currently used as a percentage denominator in the report — see `totalMergedPRs`. */
  humanMergedPRs: number;
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
  /**
   * Repository-scoped PR numbers produced by this task.
   *
   * The Agent Tasks API's "pull" artifacts only report a database ID and a
   * GraphQL global node ID — never the PR number directly — so these are
   * resolved via a GraphQL node lookup and verified to belong to the task's
   * own repository before being included here.
   */
  prNumbers: number[];
}

/**
 * Aggregated Copilot agent metrics for a single repository.
 *
 * This whole interface comes from the Copilot coding agent Task API — a
 * different, narrower source than `CopilotAdoption.copilotAuthoredPRs`. It
 * tracks only the "Copilot coding agent" / "Copilot CLI" product directly
 * (no Claude, no Codex, no commit-trailer heuristics), scoped to the last
 * ~30 days by default (`daysBack` in `collectCopilotAgentMetrics`), not the
 * ~2-year collected-history window used for PR authorship.
 */
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
  /**
   * Number of distinct PRs resolved from Copilot agent task artifacts in
   * this ~30-day window. Not comparable to `CopilotAdoption.copilotAuthoredPRs`:
   * that one covers ~2 years of collected history and matches on commit/PR
   * text across all three AI tools, this one is Copilot-agent-task-linked
   * PRs only, over a much shorter window.
   */
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
