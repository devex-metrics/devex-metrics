import type { MergedPRSummary } from "./types.js";

/**
 * Count sampled PR commits recorded strictly after the first submitted review.
 * An incomplete sample is a lower bound, not an exact count of rework.
 */
export function postReviewCommitFacts(
  pr: MergedPRSummary,
): { count: number; partial: boolean } | undefined {
  if (!pr.firstReviewAt || !pr.recentCommitDates || pr.totalCommitCount === undefined) {
    return undefined;
  }
  const firstReviewTime = Date.parse(pr.firstReviewAt);
  if (!Number.isFinite(firstReviewTime)) return undefined;

  let count = 0;
  let valid = 0;
  for (const date of pr.recentCommitDates) {
    const time = Date.parse(date);
    if (Number.isFinite(time)) {
      valid++;
      if (time > firstReviewTime) count++;
    }
  }
  return { count, partial: valid < pr.totalCommitCount };
}
