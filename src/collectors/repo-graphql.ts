import { getOctokit } from "../github-client.js";

/** One author entry from a `Commit.authors` GraphQL connection node. */
export interface CommitAuthorNode {
  /** Raw email from the git trailer or commit signature. */
  email: string;
  /** Resolved GitHub user, or null when the email is not linked to an account. */
  user: { login: string; __typename: string } | null;
}

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
  /**
   * Commit count (totalCount) plus up to 10 commit nodes whose authors
   * (primary + `Co-authored-by:` co-authors, resolved server-side by GitHub)
   * are used for AI co-authorship detection on non-squash merges.
   */
  commits: {
    totalCount: number;
    nodes: Array<{
      commit: {
        authors: {
          nodes: CommitAuthorNode[];
        };
      };
    }>;
  };
  /** Up to 100 latest commit timestamps, for post-review commit counts. */
  recentCommits?: {
    totalCount: number;
    nodes: Array<{ commit: { committedDate: string } } | null>;
  };
  comments: { totalCount: number };
  /** Inline review comment threads (maps to REST `review_comments` count). */
  reviewThreads: { totalCount: number };
  /**
   * Submitted reviews. `submittedAt` and `state` are requested by the daily
   * query but typed optional: the connection is also populated from fixtures
   * and older cached responses that predate them.
   */
  reviews: { totalCount?: number; nodes: ReviewNode[] };
  /** Merge commit for MERGED PRs — null for CLOSED/OPEN PRs. */
  mergeCommit: { message: string } | null;
}

/** One submitted review on a pull request. */
export interface ReviewNode {
  /** Reviewer, or null when the account is gone. */
  author: { login: string; __typename?: string } | null;
  /** When the review was submitted; null for a review still in progress. */
  submittedAt?: string | null;
  /** APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING. */
  state?: string;
}

/** A pull request still open, from the daily query's oldest-first page. */
export interface OpenPRNode {
  number: number;
  title: string;
  createdAt: string;
  isDraft: boolean;
  /** Submitted reviews only; pending drafts are excluded by the query. */
  submittedReviews: { totalCount: number };
  author: { login: string; __typename: string } | null;
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
  /** Set when `prNodes` stops short of the two-year cutoff. */
  truncation?: GraphQLRepoTruncation;
  /**
   * Up to 100 of the oldest still-open pull requests. Requested only on the
   * first page (`@include(if: $firstPage)`), so paginating a busy repository
   * does not pay for the same list again on every page.
   */
  openPRNodes: OpenPRNode[];
}

/** Why a repository's `prNodes` stop short of the two-year cutoff. */
export interface GraphQLRepoTruncation {
  /** `page-cap`: the configured PR budget ran out. `transient`: GitHub kept failing. */
  reason: "page-cap" | "transient";
  /** Concise failure category for a `transient` truncation; never a raw payload. */
  category?: string;
  /** GitHub's support request id, when the response carried one. */
  requestId?: string;
}

/**
 * GraphQL could not return even the first page of a repository after bounded
 * retries. Distinct from `null` (not found / forbidden), which is a real answer
 * about the repository rather than a gap in the data.
 */
export interface GraphQLRepoUnavailable {
  unavailable: true;
  /** Concise failure category; never a raw payload. */
  category: string;
  /** GitHub's support request id, when the response carried one. */
  requestId?: string;
}

/** Adaptive page-size policy for the daily query. */
export interface RepoPageSizing {
  /** Floor the adaptive reduction will not go below. */
  minPageSize: number;
  /** Retry a page at a smaller size after an expensive-query signal. */
  adaptive: boolean;
}

/** Page size the daily query starts each repository at. */
const DAILY_PAGE_SIZE = 100;

/** Shape of one GraphQL page response. */
interface GraphQLPageResponse {
  repository: {
    isFork: boolean;
    openIssues: { totalCount: number };
    closedIssues: { totalCount: number };
    openPRs: { totalCount: number };
    closedPRs: { totalCount: number };
    mergedPRs: { totalCount: number };
    openPRList?: { nodes: OpenPRNode[] };
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphQLPRNode[];
    };
  };
}

const REPO_DATA_QUERY = `
  query RepoData($owner: String!, $name: String!, $cursor: String, $firstPage: Boolean!, $pageSize: Int!) {
    repository(owner: $owner, name: $name) {
      isFork
      openIssues: issues(states: [OPEN], first: 1) { totalCount }
      closedIssues: issues(states: [CLOSED], first: 1) { totalCount }
      openPRs: pullRequests(states: [OPEN], first: 1) { totalCount }
      closedPRs: pullRequests(states: [CLOSED], first: 1) { totalCount }
      mergedPRs: pullRequests(states: [MERGED], first: 1) { totalCount }
      openPRList: pullRequests(
        first: 100
        states: [OPEN]
        orderBy: { field: CREATED_AT, direction: ASC }
      ) @include(if: $firstPage) {
        nodes {
          number
          title
          createdAt
          isDraft
          submittedReviews: reviews(first: 1, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
            totalCount
          }
          author { login __typename }
        }
      }
      pullRequests(
        first: $pageSize
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
          commits(first: 10) {
            totalCount
            nodes {
              commit {
                authors(first: 10) {
                  nodes { email user { login __typename } }
                }
              }
            }
          }
          recentCommits: commits(last: 100) {
            totalCount
            nodes { commit { committedDate } }
          }
          comments(first: 1) { totalCount }
          reviewThreads(first: 1) { totalCount }
          reviews(first: 100) {
            totalCount
            nodes { author { login __typename } submittedAt state }
          }
          mergeCommit { message }
        }
      }
    }
  }
`;

/**
 * Return true when the login belongs to a Copilot bot account.
 * REST identifies Copilot code review as `copilot-pull-request-reviewer[bot]`,
 * while GraphQL returns `copilot-pull-request-reviewer` with type `Bot`.
 * Also recognizes the legacy `copilot[bot]` and `Copilot` bot logins.
 */
export function isCopilotLogin(login: string, typename?: string): boolean {
  const lower = login.toLowerCase();
  return lower === "copilot[bot]" ||
    lower === "copilot-pull-request-reviewer[bot]" ||
    ((lower === "copilot" || lower === "copilot-pull-request-reviewer") && typename === "Bot");
}

/**
 * Fetch per-repo data via a single paginated GraphQL query.
 *
 * Returns issue counts, PR counts, and an array of PR nodes (CLOSED+MERGED,
 * sorted by updatedAt descending). Stops paginating when all PRs on a page
 * were updated before the ~2-year cutoff, or when the budget of
 * `maxPages * 100` PRs is spent. The budget counts PRs rather than requests, so
 * a repository that needed smaller pages is not also given less history.
 *
 * A page that keeps failing costs a bounded number of attempts (see
 * `fetchRepoPage`) and then ends the crawl: pages already fetched are returned
 * with `truncation` set, and a failure on the first page, when nothing is known
 * yet, returns `GraphQLRepoUnavailable` so the caller can use REST.
 *
 * Returns null on 404 (repo not found) or 403 (access denied).
 * Re-throws other errors.
 */
export async function collectRepoGraphQL(
  owner: string,
  repo: string,
  maxPages = 10,
  sizing: RepoPageSizing = { minPageSize: 10, adaptive: true }
): Promise<GraphQLRepoData | GraphQLRepoUnavailable | null> {
  const octokit = await getOctokit();
  const cutoff = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000); // ~2 years
  const prBudget = maxPages * DAILY_PAGE_SIZE;

  let cursor: string | null = null;
  let firstPage = true;
  let result: GraphQLRepoData | null = null;
  const allNodes: GraphQLPRNode[] = [];
  let pageSize = DAILY_PAGE_SIZE;
  let requested = 0;
  let moreAvailable = false;
  let truncation: GraphQLRepoTruncation | undefined;

  while (requested < prBudget) {
    let response: GraphQLPageResponse;
    const remaining = prBudget - requested;
    try {
      const fetched = await fetchRepoPage(
        octokit,
        { owner, name: repo, cursor, firstPage },
        `${owner}/${repo}`,
        {
          ...sizing,
          pageSize: Math.min(pageSize, remaining),
          minPageSize: Math.min(sizing.minPageSize, remaining),
        }
      );
      response = fetched.response;
      pageSize = fetched.pageSize;
    } catch (err: unknown) {
      if (isGraphQLNotFoundOrForbidden(err)) {
        if (hasGraphQLForbiddenError(err)) {
          console.warn(`  ⚠ graphql: skipping ${owner}/${repo}: access denied (403)`);
        }
        return null;
      }
      if (!isTransientCollectionError(err)) throw err;
      const category = describeTransientError(err);
      const requestId = extractGitHubRequestId(err);
      const note = `${category}${requestId ? ` (request ${requestId})` : ""}`;
      if (result === null) {
        console.warn(`  ⚠ graphql: giving up on ${owner}/${repo}: ${note}, falling back to REST`);
        return { unavailable: true, category, requestId };
      }
      console.warn(
        `  ⚠ graphql: stopping ${owner}/${repo} after ${allNodes.length} PRs: ${note}; keeping what was fetched`
      );
      truncation = { reason: "transient", category, requestId };
      break;
    }

    if (!response?.repository) {
      const category = "empty GraphQL response";
      if (result === null) {
        console.warn(`  ⚠ graphql: empty response for ${owner}/${repo}, falling back to REST`);
        return { unavailable: true, category };
      }
      console.warn(
        `  ⚠ graphql: empty response for ${owner}/${repo} after ${allNodes.length} PRs; keeping what was fetched`
      );
      truncation = { reason: "transient", category };
      break;
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
        openPRNodes: repoData.openPRList?.nodes ?? [],
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

    requested += pageSize;
    const { hasNextPage, endCursor } = repoData.pullRequests.pageInfo;
    moreAvailable = hasNextPage && !reachedCutoff && endCursor !== null;
    if (!moreAvailable) break;
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
      openPRNodes: [],
    };
  }

  result.prNodes = allNodes;
  if (truncation) {
    result.truncation = truncation;
  } else if (moreAvailable) {
    result.truncation = { reason: "page-cap" };
  }
  return result;
}

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Return true for transient server-side HTTP errors (5xx). */
function isTransientServerError(err: unknown): boolean {
  const httpError = err as { status?: number };
  return typeof httpError.status === "number" && httpError.status >= 500 && httpError.status < 600;
}

/**
 * Return true only for the two HTTP gateway statuses (502, 504) that the
 * adaptive page-size policy documents as an "expensive query" signal.
 * Deliberately narrower than {@link isTransientServerError}: a general 5xx
 * outage (500, 503, ...) is a server-side problem unrelated to the size of
 * this particular query, so it must not trigger a page-size reduction here.
 */
function isExpensiveQueryHttpError(err: unknown): boolean {
  const httpError = err as { status?: number };
  return httpError.status === 502 || httpError.status === 504;
}

/**
 * Return true for GitHub's generic GraphQL execution failure — the
 * "Something went wrong while executing your query" response GitHub sends
 * for an internal hiccup unrelated to the query itself (distinct from a rate
 * limit, auth failure, or a validation/field error). It carries no `data`,
 * only a message and a request id for support, so it is identified by that
 * message rather than by HTTP status or GraphQL error `type` (it has
 * neither reliably).
 */
function isGenericGraphQLExecutionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const graphqlError = err as {
    errors?: Array<{ message?: string }>;
    data?: unknown;
  };
  const messages = [err.message, ...(graphqlError.errors?.map((e) => e.message) ?? [])];
  const matchesMessage = messages.some(
    (m) => typeof m === "string" && m.toLowerCase().includes("something went wrong while executing your query")
  );
  if (!matchesMessage) return false;
  // Guard against ever treating a real, data-bearing response as transient.
  return graphqlError.data === undefined || graphqlError.data === null;
}

/**
 * True for a GitHub failure that says nothing about the rest of the dataset: a
 * 5xx (Octokit also reports network failures as 500), the generic execution
 * error, or a query timeout. Authentication, permission and validation errors
 * are excluded because they would fail every repository alike.
 */
export function isTransientCollectionError(err: unknown): boolean {
  return isTransientServerError(err) || isExpensiveQuerySignal(err);
}

/**
 * `Promise.all` for requests that may fail in different ways. `Promise.all`
 * rejects with whichever failure came first, so a 504 could hide a later 401
 * and let the run carry on past the per-repository handling. This waits for
 * every task, then rejects with a non-transient failure if there is one.
 */
export async function allFatalFirst<T extends readonly unknown[] | []>(
  tasks: T
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(tasks);
  const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
  if (failures.length > 0) {
    throw failures.find((e) => !isTransientCollectionError(e)) ?? failures[0];
  }
  return results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as {
    -readonly [K in keyof T]: Awaited<T[K]>;
  };
}

/** Concise, log-safe category for a transient failure; never a raw payload. */
export function describeTransientError(err: unknown): string {
  if (isExpensiveQueryHttpError(err)) return "repeated HTTP 502/504 gateway error";
  if (isTransientServerError(err)) return `HTTP ${(err as { status: number }).status} server error`;
  return "GitHub GraphQL transient execution error";
}

/**
 * Best-effort extraction of the GitHub request id for a failed GraphQL call,
 * so operators can hand it to GitHub support. Prefers the response header;
 * falls back to the id GitHub embeds in the generic-execution-error message
 * itself (`` Please include `XXXX:XXXX:...` when reporting this issue. ``).
 */
function extractGitHubRequestId(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const graphqlError = err as { headers?: Record<string, string> };
  const headerId = graphqlError.headers?.["x-github-request-id"];
  if (headerId) return headerId;
  const match = err.message.match(/`([0-9A-F]+(?::[0-9A-F]+){2,})`/i);
  return match?.[1];
}

const TRANSIENT_BACKOFF_MS = [5_000, 15_000, 30_000];

/**
 * Fetch one page of the daily query with a bounded retry on transient errors.
 *
 * An expensive-query signal (502/504, generic execution error, query timeout)
 * also moves to the next smaller page size; any other 5xx is unrelated to the
 * size of the query and retries at the same one. Attempts are capped at the
 * longer of the size sequence and the backoff schedule: 5 attempts and 80
 * seconds of waiting by default. Non-transient errors (4xx, GraphQL
 * validation/field errors, auth failures) are re-thrown immediately.
 */
async function fetchRepoPage(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  variables: Record<string, unknown>,
  label: string,
  sizing: RepoPageSizing & { pageSize: number }
): Promise<{ response: GraphQLPageResponse; pageSize: number }> {
  const sizes = sizing.adaptive
    ? pageSizeReductionSequence(sizing.pageSize, sizing.minPageSize)
    : [sizing.pageSize];
  const maxAttempts = Math.max(sizes.length, TRANSIENT_BACKOFF_MS.length + 1);
  let sizeIndex = 0;
  for (let attempt = 1; ; attempt++) {
    const pageSize = sizes[sizeIndex];
    try {
      const response = await octokit.graphql<GraphQLPageResponse>(REPO_DATA_QUERY, {
        ...variables,
        pageSize,
      });
      return { response, pageSize };
    } catch (err) {
      if (!isTransientCollectionError(err) || attempt >= maxAttempts) throw err;
      const shrink = isExpensiveQuerySignal(err) && sizeIndex < sizes.length - 1;
      if (shrink) sizeIndex++;
      const wait = TRANSIENT_BACKOFF_MS[Math.min(attempt - 1, TRANSIENT_BACKOFF_MS.length - 1)];
      const requestId = extractGitHubRequestId(err);
      console.warn(
        `  ⚠ graphql: transient error for ${label} (attempt ${attempt}/${maxAttempts})` +
          (requestId ? ` [request ${requestId}]` : "") +
          `, retrying${shrink ? ` with page size ${sizes[sizeIndex]}` : ""} in ${wait / 1000}s…`
      );
      await sleep(wait);
    }
  }
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

// ── Historical backfill ───────────────────────────────────────────────────────

/**
 * A pull request as returned by the lean historical query.
 *
 * The daily query carries nested commit and review-thread data for AI-authorship
 * detection, which makes each page expensive. Walking a repository back to its
 * first commit multiplies that cost by every page of its life, so the historical
 * crawl asks only for facts that cannot be derived later — and skips commit-level
 * AI detection entirely, which costs nothing real: Copilot, Claude and Codex did
 * not exist before 2023, so PRs older than that are human-authored by definition.
 */
export interface HistoricalPRNode {
  number: number;
  state: "CLOSED" | "MERGED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: { login: string; __typename: string } | null;
  additions: number;
  deletions: number;
  body: string | null;
  reviews: {
    totalCount: number;
    nodes: Array<{
      submittedAt: string | null;
      author: { login: string } | null;
      /** APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED. */
      state?: string;
    }>;
  };
}

/** One page of the historical crawl. */
export interface HistoricalPRPage {
  nodes: HistoricalPRNode[];
  hasNextPage: boolean;
  endCursor: string | null;
  /**
   * The GraphQL page size that actually succeeded. Equal to the requested
   * size unless adaptive reduction kicked in, in which case the caller
   * should keep using this smaller size for the rest of the repository's
   * crawl this run (see `pageSizeReductionSequence`).
   */
  pageSize: number;
}

/** Effective page-size policy for one historical page request. */
export interface HistoricalPageSizeOptions {
  /** Size to request first — the repository's current effective page size. */
  pageSize: number;
  /** Floor the adaptive reduction will not go below. */
  minPageSize: number;
  /**
   * Retry the same cursor with a smaller page size on an expensive-query
   * signal (502/504, or a generic GraphQL execution error). When false, a
   * single request is made at `pageSize` and any such error behaves exactly
   * as it did before adaptive sizing existed (the page is abandoned for this
   * run).
   */
  adaptive: boolean;
}

/**
 * Why a historical page fetch could not return data — always a repository-
 * local, recoverable condition. Anything that is *not* one of these (auth
 * failure, GraphQL validation/schema error, an unexpected/programming error)
 * is thrown instead, so the caller can tell the two apart without having to
 * inspect error internals itself.
 */
export type HistoricalPageFailureKind = "not-found" | "forbidden" | "transient";

/** Repository-local, recoverable page-fetch failure detail for logging/reporting. */
export interface HistoricalPageFailure {
  kind: HistoricalPageFailureKind;
  /** Concise, human-readable category for logs — never a raw payload. */
  category: string;
  /** Total attempts made before giving up, when the bounded retry policy applied. */
  attempts?: number;
  /** GitHub's support request id, when the response carried one. */
  requestId?: string;
}

/**
 * Outcome of one historical page fetch. `ok: false` always means a
 * classified, repository-local, recoverable failure (see
 * `HistoricalPageFailureKind`) — never an auth failure, validation error, or
 * unexpected bug, which are thrown instead and must propagate.
 */
export type HistoricalPageOutcome =
  | { ok: true; page: HistoricalPRPage }
  | { ok: false; failure: HistoricalPageFailure };

/**
 * Ordered CREATED_AT ascending on purpose: the crawl walks *forward* from the
 * repository's first pull request, so the oldest history — the part that is
 * missing — arrives first, and new pull requests are only ever appended beyond
 * the stored cursor. A cursor saved today therefore stays valid tomorrow, which
 * is what makes the crawl resumable across runs.
 *
 * Only the first review is needed per PR (`submittedAt` ascending gives the
 * earliest), but the connection is fetched small rather than filtered so the
 * reviewer set stays available for historical reviewer counts.
 *
 * `pageSize` is a validated `Int!` variable rather than a literal so a
 * repository whose pages are too expensive to execute at the configured size
 * can be retried at a smaller one without building the query text by hand.
 */
const HISTORICAL_PR_QUERY = `
  query HistoricalPRs($owner: String!, $name: String!, $cursor: String, $pageSize: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: $pageSize
        states: [CLOSED, MERGED]
        orderBy: { field: CREATED_AT, direction: ASC }
        after: $cursor
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          state
          createdAt
          mergedAt
          closedAt
          author { login __typename }
          additions
          deletions
          body
          reviews(first: 20) {
            totalCount
            nodes { submittedAt author { login } state }
          }
        }
      }
    }
  }
`;

interface HistoricalPageResponse {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: HistoricalPRNode[];
    };
  } | null;
}

/**
 * Deterministic page-size reduction sequence used to retry a historical page
 * after an expensive-query signal: halve (rounding down), clamp to `min`, and
 * stop once `min` is reached. For the documented defaults (50, 10) this is
 * `[50, 25, 12, 10]`.
 *
 * This *is* the retry policy for the historical page fetch — each entry is
 * tried once, so the maximum number of GraphQL attempts for one page equals
 * `sizes.length` (4 by default). It intentionally does not stack with a
 * separate same-size backoff-retry loop, which would multiply attempts
 * unpredictably (e.g. 3 retries × 4 sizes = 12 undocumented attempts).
 */
export function pageSizeReductionSequence(initial: number, min: number): number[] {
  const sizes: number[] = [];
  let size = Math.max(initial, min);
  for (;;) {
    sizes.push(size);
    if (size <= min) break;
    size = Math.max(min, Math.floor(size / 2));
  }
  return sizes;
}

/**
 * True for GitHub responses that indicate the *query itself* was too
 * expensive to execute — as opposed to a permanent authentication,
 * authorization, not-found, or validation problem. These are the only
 * signals that justify retrying the same page with a smaller `pageSize`;
 * every other error is left to the caller's existing handling (403/404
 * skip, or a re-thrown fatal error).
 */
function isExpensiveQuerySignal(err: unknown): boolean {
  if (isExpensiveQueryHttpError(err)) return true; // covers HTTP 502/504 only
  if (isGenericGraphQLExecutionError(err)) return true;
  const graphqlError = err as {
    errors?: Array<{ type?: string; message?: string }>;
    data?: unknown;
  };
  if (
    !Array.isArray(graphqlError.errors) ||
    (graphqlError.data !== undefined && graphqlError.data !== null)
  ) {
    return false;
  }
  return graphqlError.errors.some((e) => {
    const msg = e.message?.toLowerCase() ?? "";
    return (
      e.type === "TIMEOUT" ||
      msg.includes("something went wrong while executing your query") ||
      msg.includes("something went wrong executing your query") ||
      msg.includes("query timeout") ||
      msg.includes("timed out")
    );
  });
}

/**
 * Fetch one page of historical pull requests for `owner/repo`.
 *
 * Resolves to `{ ok: true, page }` on success, or `{ ok: false, failure }`
 * for a classified, repository-local, recoverable condition — the
 * repository gone/renamed/inaccessible, access denied, or GitHub still
 * returning a transient failure (5xx, or its generic "something went wrong
 * executing your query" execution error) after exhausting the bounded
 * retries and the adaptive page-size reduction sequence. The caller treats
 * that as "defer this repository for now" and leaves its watermark
 * untouched so the next run resumes from the same place. Anything else —
 * auth failures, GraphQL validation/schema errors, or an
 * unexpected/programming error — is thrown, not returned, so it cannot be
 * mistaken for a recoverable per-repository condition.
 *
 * The returned page carries the `pageSize` that actually succeeded so the
 * caller can keep using it for the repository's remaining pages this run,
 * and optionally persist it as a hint for the next run.
 */
export async function fetchHistoricalPRPage(
  owner: string,
  repo: string,
  cursor: string | null,
  options: HistoricalPageSizeOptions
): Promise<HistoricalPageOutcome> {
  const octokit = await getOctokit();
  const sizes = options.adaptive
    ? pageSizeReductionSequence(options.pageSize, options.minPageSize)
    : [options.pageSize];

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    let response: HistoricalPageResponse;
    try {
      response = await octokit.graphql<HistoricalPageResponse>(HISTORICAL_PR_QUERY, {
        owner,
        name: repo,
        cursor,
        pageSize: size,
      });
    } catch (err: unknown) {
      if (isGraphQLNotFoundOrForbidden(err)) {
        const forbidden = hasGraphQLForbiddenError(err);
        return {
          ok: false,
          failure: {
            kind: forbidden ? "forbidden" : "not-found",
            category: forbidden
              ? "repository access denied (403)"
              : "repository not found",
            requestId: extractGitHubRequestId(err),
          },
        };
      }
      if (isExpensiveQuerySignal(err)) {
        if (i < sizes.length - 1) {
          const next = sizes[i + 1];
          console.warn(
            `  ⚠ backfill: ${owner}/${repo} historical page timed out at size ${size}; ` +
              `retrying the same cursor with page size ${next}`
          );
          await sleep(TRANSIENT_BACKOFF_MS[Math.min(i, TRANSIENT_BACKOFF_MS.length - 1)]);
          continue;
        }
        const requestId = extractGitHubRequestId(err);
        const category = describeTransientError(err);
        const failureDescription = options.adaptive
          ? `still failing at the minimum page size (${size})`
          : `failed at page size ${size} with adaptive sizing disabled`;
        console.warn(
          `  ⚠ backfill: ${owner}/${repo} ${failureDescription}; will retry next run`
        );
        return {
          ok: false,
          failure: {
            kind: "transient",
            category,
            attempts: i + 1,
            requestId,
          },
        };
      }
      if (isTransientServerError(err)) {
        // Says nothing about this query's size, so no smaller page is tried,
        // but it is no more fatal to the run than a 502: defer this repository.
        const category = describeTransientError(err);
        console.warn(`  ⚠ backfill: ${owner}/${repo} got ${category}; will retry next run`);
        return {
          ok: false,
          failure: { kind: "transient", category, attempts: i + 1, requestId: extractGitHubRequestId(err) },
        };
      }
      throw err;
    }

    if (!response?.repository) {
      // A successful HTTP response with no repository payload: the repository
      // disappeared, was renamed, or was archived/made inaccessible mid-crawl.
      return {
        ok: false,
        failure: {
          kind: "not-found",
          category: "repository disappeared or became inaccessible during collection",
        },
      };
    }

    const { nodes, pageInfo } = response.repository.pullRequests;
    if (i > 0) {
      console.log(`  ✓ backfill: ${owner}/${repo} continuing with page size ${size}`);
    }
    return {
      ok: true,
      page: {
        nodes: nodes ?? [],
        hasNextPage: pageInfo.hasNextPage,
        endCursor: pageInfo.endCursor,
        pageSize: size,
      },
    };
  }

  // Unreachable: `sizes` always has at least one entry, and the loop above
  // always returns or `continue`s. Kept only to satisfy the return type.
  return {
    ok: false,
    failure: { kind: "transient", category: "unreachable", attempts: 0 },
  };
}
