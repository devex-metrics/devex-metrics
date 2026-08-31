export { collectRepos } from "./repos.js";
export { collectIssueCounts, collectIssueLeadTimes } from "./issues.js";
export {
  collectPullRequestCounts,
  collectPullRequestDetails,
  collectMergedPRTimeline,
  computeCopilotAdoption,
  buildPullRequestCounts,
  buildMergedPRTimeline,
  collectPullRequestDetailsFromNodes,
  buildClosedPRTimeline,
  buildOpenPRTimeline,
  countReviewerLoad,
  summariseReviews,
  parseRevertRef,
  extractReviewerLogins,
} from "./pull-requests.js";
export type { ReviewFacts } from "./pull-requests.js";
export { collectContributors } from "./contributors.js";
export { collectDependentCount } from "./dependents.js";
export { collectWeeklyTrends } from "./trends.js";
export type { WeeklyTrendsResult } from "./trends.js";
export { collectRepoGraphQL } from "./repo-graphql.js";
export type {
  GraphQLPRNode,
  GraphQLRepoData,
  OpenPRNode,
  ReviewNode,
} from "./repo-graphql.js";
export {
  collectCopilotAgentMetrics,
  computeAgentMetrics,
} from "./copilot-agent.js";
