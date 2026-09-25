import { postReviewCommitFacts } from "./review-rework.js";
import type { MergedPRSummary } from "./types.js";

const pr: MergedPRSummary = {
  number: 1,
  createdAt: "2026-08-20T00:00:00Z",
  mergedAt: "2026-08-22T00:00:00Z",
  author: "amy",
  isBotAuthor: false,
  isCopilotAuthored: false,
  timeToMergeHours: 48,
  closesIssues: [],
  firstReviewAt: "2026-08-20T06:00:00Z",
};

describe("postReviewCommitFacts", () => {
  it("excludes commits before or exactly at the first review", () => {
    expect(postReviewCommitFacts({
      ...pr,
      totalCommitCount: 3,
      recentCommitDates: [
        "2026-08-20T05:00:00Z",
        "2026-08-20T06:00:00Z",
        "2026-08-20T07:00:00Z",
      ],
    })).toEqual({ count: 1, partial: false });
  });

  it("marks truncated and malformed commit samples as lower bounds", () => {
    expect(postReviewCommitFacts({
      ...pr, totalCommitCount: 101, recentCommitDates: ["2026-08-20T08:00:00Z"],
    })).toEqual({ count: 1, partial: true });
    expect(postReviewCommitFacts({
      ...pr, totalCommitCount: 2, recentCommitDates: ["bad-date", "2026-08-20T08:00:00Z"],
    })).toEqual({ count: 1, partial: true });
  });

  it("keeps missing data unavailable, not zero", () => {
    expect(postReviewCommitFacts(pr)).toBeUndefined();
    expect(postReviewCommitFacts({ ...pr, firstReviewAt: undefined, totalCommitCount: 0, recentCommitDates: [] }))
      .toBeUndefined();
    expect(postReviewCommitFacts({ ...pr, totalCommitCount: 0, recentCommitDates: [] }))
      .toEqual({ count: 0, partial: false });
  });
});
