import { getOctokit } from "../github-client.js";

/**
 * Count unique committers (last 90 days) and unique PR reviewers
 * for a repository.
 *
 * When `reviewerLogins` is provided (pre-fetched from GraphQL), the REST
 * pulls.list + listReviews loop is skipped entirely and the provided set is
 * used directly.
 */
export async function collectContributors(
  owner: string,
  repo: string,
  reviewerLogins?: Set<string>
): Promise<{ committerCount: number; reviewerCount: number }> {
  const octokit = await getOctokit();
  const since = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000
  ).toISOString();

  // --- Unique committers ---
  const committers = new Set<string>();
  try {
    for await (const response of octokit.paginate.iterator(
      octokit.rest.repos.listCommits,
      { owner, repo, since, per_page: 100 }
    )) {
      for (const commit of response.data) {
        if (commit.author?.login) {
          committers.add(commit.author.login);
        } else if (commit.commit?.author?.email) {
          committers.add(commit.commit.author.email);
        }
      }
    }
  } catch {
    // Repo may be empty or inaccessible
  }

  // --- Unique reviewers ---
  // When pre-fetched from GraphQL, skip the REST review loop entirely.
  if (reviewerLogins !== undefined) {
    return {
      committerCount: committers.size,
      reviewerCount: reviewerLogins.size,
    };
  }

  const reviewers = new Set<string>();
  try {
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 50,
    });

    for (const pr of prs) {
      try {
        const { data: reviews } = await octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        });
        for (const review of reviews) {
          if (review.user?.login) {
            reviewers.add(review.user.login);
          }
        }
      } catch {
        // Skip inaccessible reviews
      }
    }
  } catch {
    // Repo may have no PRs
  }

  return {
    committerCount: committers.size,
    reviewerCount: reviewers.size,
  };
}
