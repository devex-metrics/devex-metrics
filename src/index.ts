import { loadCache, saveCache } from "./cache.js";
import {
  collectRepos,
  collectIssueCounts,
  collectPullRequestCounts,
  collectPullRequestDetails,
  collectContributors,
  collectDependentCount,
  collectWeeklyTrends,
} from "./collectors/index.js";
import { generateReport } from "./report.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Collect metrics for every repo owned by `owner`.
 */
export async function collect(
  owner: string,
  ownerType: "org" | "user"
): Promise<OrgMetrics> {
  // Check cache first
  const cached = loadCache(owner);
  if (cached) {
    console.log(`Using cached data for ${owner} (collected ${cached.collectedAt})`);
    return cached;
  }

  console.log(`Collecting fresh metrics for ${owner} (${ownerType})…`);

  const repoList = await collectRepos(owner, ownerType);
  console.log(`Found ${repoList.length} repositories`);

  const repos: RepoMetrics[] = [];

  for (const { fullName } of repoList) {
    console.log(`  → ${fullName}`);

    // fullName is "repoOwner/repoName" – repos may belong to a different org/user
    // than the top-level owner (e.g. org repos returned for a user query).
    const slashIndex = fullName.indexOf("/");
    if (slashIndex <= 0 || slashIndex === fullName.length - 1) {
      console.warn(`  ⚠ Skipping repo with unexpected fullName format: ${fullName}`);
      continue;
    }
    const repoOwner = fullName.slice(0, slashIndex);
    const repoName = fullName.slice(slashIndex + 1);

    const [issues, prCounts, prDetails, contributors, dependentCount] =
      await Promise.all([
        collectIssueCounts(repoOwner, repoName),
        collectPullRequestCounts(repoOwner, repoName),
        collectPullRequestDetails(repoOwner, repoName),
        collectContributors(repoOwner, repoName),
        collectDependentCount(repoOwner, repoName),
      ]);

    repos.push({
      name: repoName,
      fullName,
      issues,
      pullRequests: prCounts,
      pullRequestDetails: prDetails,
      committerCount: contributors.committerCount,
      reviewerCount: contributors.reviewerCount,
      dependentCount,
    });
  }

  console.log("Collecting weekly trends…");
  const trendRepos = repos.map((r) => {
    const slash = r.fullName.indexOf("/");
    return { owner: r.fullName.slice(0, slash), name: r.name };
  });
  const weeklyTrends = await collectWeeklyTrends(trendRepos);

  const metrics: OrgMetrics = {
    owner,
    ownerType,
    collectedAt: new Date().toISOString(),
    repoCount: repos.length,
    repos,
    weeklyTrends,
  };

  saveCache(owner, metrics);
  return metrics;
}

/**
 * CLI entry-point.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx ts-node src/index.ts <owner> [org|user]
 */
async function main(): Promise<void> {
  const owner = process.argv[2];
  const ownerType = (process.argv[3] ?? "org") as "org" | "user";

  if (!owner) {
    console.error("Usage: devex-metrics <owner> [org|user]");
    process.exit(1);
  }

  const metrics = await collect(owner, ownerType);

  // Write Markdown report
  const report = generateReport(metrics);
  const reportPath = path.resolve(process.cwd(), "data", `${owner}-report.md`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to ${reportPath}`);

  // Also write JSON
  const jsonPath = path.resolve(process.cwd(), "data", `${owner}.json`);
  console.log(`JSON data cached at ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
