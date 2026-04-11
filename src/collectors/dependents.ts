import { getOctokit } from "../github-client.js";

/**
 * Get the number of repositories that depend on a given repository.
 *
 * GitHub exposes no REST or GraphQL API for this count. We scrape the
 * `/network/dependents` page instead. Forks always return 0 because GitHub
 * disables the dependency graph for forked repositories.
 *
 * Authentication note: if `GITHUB_TOKEN` is set it is forwarded as an
 * `Authorization` header. GitHub App tokens cannot be extracted from the
 * Octokit instance, so App-auth setups rely on unauthenticated scraping
 * (which works for public repositories).
 */
export async function collectDependentCount(
  owner: string,
  repo: string
): Promise<number> {
  const octokit = await getOctokit();

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });

    // Forks do not have their own dependency graph; dependents are not tracked.
    if (repoData.fork) {
      return 0;
    }

    // Scrape the dependents page — no REST/GraphQL API exists for this count.
    const url = `https://github.com/${owner}/${repo}/network/dependents?dependent_type=REPOSITORY`;
    const headers: Record<string, string> = {
      Accept: "text/html",
      "User-Agent": "devex-metrics/1.0",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      return 0;
    }

    const html = await response.text();

    // Guard against being redirected to a login page.
    if (html.includes('action="/session"') || html.includes("/login?return_to=")) {
      return 0;
    }

    // The count is displayed in the selected "Repositories" tab link:
    //   <a class="btn-link selected" href="...?dependent_type=REPOSITORY">
    //     <svg>…</svg>
    //     22,371
    //     Repositories
    //   </a>
    // `\s+` covers both same-line and multi-line whitespace between count and label.
    const match = html.match(
      /href="[^"]*dependent_type=REPOSITORY"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)\s+Repositor/
    );
    if (match) {
      return parseInt(match[1].replace(/,/g, ""), 10);
    }

    return 0;
  } catch {
    return 0;
  }
}
