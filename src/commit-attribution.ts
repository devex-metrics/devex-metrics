import type { MergedPRSummary } from "./types.js";

/** Counts sampled PR commits by linked GitHub author identity. */
export interface CommitAttributionSummary {
  /** Sampled commits with only focus-group linked authors. */
  focusCommits: number;
  /** Sampled commits with only non-focus linked authors. */
  restCommits: number;
  /** Sampled commits with both focus and non-focus linked authors. */
  mixedCommits: number;
  /** Sampled or known-total commits whose author identities are unavailable. */
  unavailableCommits: number;
  /** Merged PRs included in the collected timeline. */
  totalPRs: number;
  /** PRs that have no commit-author sample at all. */
  unavailablePRs: number;
  /** PRs whose commit or author sample is capped or lacks totals. */
  incompletePRs: number;
}

/**
 * Classify commit-author evidence against the current roster.
 *
 * A commit is counted once, even when it has multiple co-authors. Unlinked or
 * capped author evidence is unknown, never silently assigned to the rest.
 */
export function summarizeCommitAttribution(
  prs: readonly MergedPRSummary[],
  focusUsers: readonly string[]
): CommitAttributionSummary {
  const focus = new Set(focusUsers.map((login) => login.trim().toLowerCase()));
  const summary: CommitAttributionSummary = {
    focusCommits: 0,
    restCommits: 0,
    mixedCommits: 0,
    unavailableCommits: 0,
    totalPRs: prs.length,
    unavailablePRs: 0,
    incompletePRs: 0,
  };

  for (const pr of prs) {
    const samples = pr.commitAuthorSamples;
    if (samples === undefined) {
      summary.unavailablePRs++;
      summary.unavailableCommits += pr.commitAuthorSampleTotalCount ?? 0;
      continue;
    }

    const total = pr.commitAuthorSampleTotalCount;
    const complete = pr.commitAuthorSampleComplete === true &&
      total !== undefined && samples.length === total;
    if (!complete) summary.incompletePRs++;

    for (const sample of samples) {
      const authors = new Set(sample.authors.map((login) => login.trim().toLowerCase()));
      if (!sample.complete || sample.authorCount !== sample.authors.length || authors.size === 0) {
        summary.unavailableCommits++;
        continue;
      }

      const hasFocus = [...authors].some((login) => focus.has(login));
      const hasRest = [...authors].some((login) => !focus.has(login));
      if (hasFocus && hasRest) summary.mixedCommits++;
      else if (hasFocus) summary.focusCommits++;
      else summary.restCommits++;
    }

    if (total !== undefined && samples.length < total) {
      summary.unavailableCommits += total - samples.length;
    }
  }
  return summary;
}
