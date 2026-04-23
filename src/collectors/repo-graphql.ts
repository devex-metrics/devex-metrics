import { getOctokit } from "../github-client.js";

const COPILOT_LOGIN = "copilot[bot]";

/** A single PR node returned by the GraphQL query. */
export interface GraphQLPRNode {
  number: number;
  title: string;
  /** GraphQL state: "OPEN" | "CLOSED" | "MERGED" */
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  /** Git OID (SHA) of the head commit — used for checks.listForRef. */
  headRefOid: string;
  body: string | null;
  author: { login: string; __typename: string } | null;
  additions: number;
  deletions: number;
  commits: { totalCount: number };
  comments: { totalCount: number };
  /** Inline review comment threads (maps to REST `review_comments` count). */
  reviewThreads: { totalCount: number };
  reviews: { nodes: Array<{ author: { login: string } | null }> };
}

/** Aggregated repository data returned from the GraphQL query. */
export interface GraphQLRepoData {
  isFork: boolean;
  openIssueCount: number;
  closedIssueCount: number;
  openPRCount: number;
  closedPRCount: number;
  mergedPRCount: number;
  /** PR nodes, sorted by updatedAt descending, up to maxPages*100. */
  prNodes: GraphQLPRNode[];
}

/** Shape of one GraphQL page response. */
interface GraphQLPageResponse {
  repository: {
    isFork: boolean;
    openIssues: { totalCount: number };
    closedIssues: { totalCount: number };
    openPRs: { totalCount: number };
    closedPRs: { totalCount: number };
    mergedPRs: { totalCount: number };
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphQLPRNode[];
    };
  };
}

const REPO_DATA_QUERY = `
  query RepoData($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      isFork
      openIssues: issues(states: [OPEN], first: 1) { totalCount }
      closedIssues: issues(states: [CLOSED], first: 1) { totalCount }
      openPRs: pullRequests(states: [OPEN], first: 1) { totalCount }
      closedPRs: pullRequests(states: [CLOSED], first: 1) { totalCount }
      mergedPRs: pullRequests(states: [MERGED], first: 1) { totalCount }
      pullRequests(
        first: 100
        states: [CLOSED, MERGED]
        orderBy: { field: UPDATED_AT, direction: DESC }
        after: $cursor
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          state
          createdAt
          mergedAt
          closedAt
          updatedAt
          headRefOid
          body
          author { login __typename }
          additions
          deletions
          commits(first: 1) { totalCount }
          comments(first: 1) { totalCount }
          reviewThreads(first: 1) { totalCount }
          reviews(first: 100) {
            nodes { author { login } }
          }
        }
      }
    }
  }
`;

/**
 * Determine whether the author login represents a known Copilot bot.
 * Checks for exact match of copilot[bot] login.
 */
export function isCopilotLogin(login: string): boolean {
  return login.toLowerCase() === COPILOT_LOGIN;
}

/**
 * Fetch per-repo data via a single paginated GraphQL query.
 *
 * Returns issue counts, PR counts, and an array of PR nodes (CLOSED+MERGED,
 * sorted by updatedAt descending). Stops paginating when all PRs on a page
 * were updated before the ~13-month cutoff, or when maxPages is reached.
 *
 * Returns null on 404 (repo not found) or 403 (access denied).
 * Re-throws other errors.
 */
export async function collectRepoGraphQL(
  owner: string,
  repo: string,
  maxPages = 10
): Promise<GraphQLRepoData | null> {
  const octokit = await getOctokit();
  const cutoff = new Date(Date.now() - 395 * 24 * 60 * 60 * 1000); // ~13 months

  let cursor: string | null = null;
  let firstPage = true;
  let result: GraphQLRepoData | null = null;
  const allNodes: GraphQLPRNode[] = [];

  for (let page = 0; page < maxPages; page++) {
    let response: GraphQLPageResponse;
    try {
      response = await octokit.graphql<GraphQLPageResponse>(REPO_DATA_QUERY, {
        owner,
        name: repo,
        cursor,
      });
    } catch (err: unknown) {
      if (isGraphQLNotFoundOrForbidden(err)) {
        if (hasGraphQLForbiddenError(err)) {
          console.warn(`  ⚠ graphql: skipping ${owner}/${repo}: access denied (403)`);
        }
        return null;
      }
      throw err;
    }

    const repoData = response.repository;

    if (firstPage) {
      result = {
        isFork: repoData.isFork,
        openIssueCount: repoData.openIssues.totalCount,
        closedIssueCount: repoData.closedIssues.totalCount,
        openPRCount: repoData.openPRs.totalCount,
        closedPRCount: repoData.closedPRs.totalCount,
        mergedPRCount: repoData.mergedPRs.totalCount,
        prNodes: [],
      };
      firstPage = false;
    }

    const nodes = repoData.pullRequests.nodes;
    let reachedCutoff = false;
    for (const node of nodes) {
      if (new Date(node.updatedAt) < cutoff) {
        reachedCutoff = true;
        break;
      }
      allNodes.push(node);
    }

    const { hasNextPage, endCursor } = repoData.pullRequests.pageInfo;
    if (!hasNextPage || reachedCutoff || endCursor === null) break;
    cursor = endCursor;
  }

  if (result === null) {
    // maxPages=0 or something prevented first page — return empty
    return {
      isFork: false,
      openIssueCount: 0,
      closedIssueCount: 0,
      openPRCount: 0,
      closedPRCount: 0,
      mergedPRCount: 0,
      prNodes: [],
    };
  }

  result.prNodes = allNodes;
  return result;
}

/** Check if a GraphQL error indicates the resource was not found or is forbidden. */
function isGraphQLNotFoundOrForbidden(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Octokit GraphQL throws GraphqlResponseError for server-side errors
  const graphqlError = err as { errors?: Array<{ type?: string; message?: string }> };
  if (graphqlError.errors) {
    return graphqlError.errors.some(
      (e) =>
        e.type === "NOT_FOUND" ||
        e.type === "FORBIDDEN" ||
        e.message?.toLowerCase().includes("not found") ||
        e.message?.toLowerCase().includes("forbidden") ||
        e.message?.toLowerCase().includes("could not resolve")
    );
  }
  // HTTP-level 403/404 on the GraphQL endpoint
  const httpError = err as { status?: number };
  return httpError.status === 404 || httpError.status === 403;
}

/** Check if the error is specifically a forbidden (403) type. */
function hasGraphQLForbiddenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const graphqlError = err as { errors?: Array<{ type?: string; message?: string }>; status?: number };
  if (graphqlError.status === 403) return true;
  if (graphqlError.errors) {
    return graphqlError.errors.some(
      (e) =>
        e.type === "FORBIDDEN" ||
        e.message?.toLowerCase().includes("forbidden")
    );
  }
  return false;
}
