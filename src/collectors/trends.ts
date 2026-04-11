import { getOctokit } from "../github-client.js";
import type { WeeklyTrendPoint } from "../types.js";

/**
 * Return the ISO 8601 week label ("YYYY-Www") for a UTC date.
 *
 * Uses the Thursday-anchored algorithm: the ISO year of a week is the year
 * that contains that week's Thursday.
 */
export function toIsoWeekLabel(date: Date): string {
  // Work entirely in UTC to avoid local-timezone drift.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // ISO day-of-week: Mon=1 … Sun=7
  const dow = d.getUTCDay() || 7;
  // Shift to the Thursday of the same ISO week.
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7
  );
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Return the UTC date of the Monday that starts the ISO week containing
 * `date`.
 */
function isoWeekMonday(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dow = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d;
}

/**
 * Collect weekly PR and issue activity trends aggregated across a list of
 * repos for the last `weeksBack` ISO weeks (including the current partial
 * week).
 *
 * For merged PRs, fetches individual PR details to accumulate lines
 * added/deleted per week. The total number of detail fetches is capped at
 * `maxDetailFetches` across all repos to avoid rate-limit exhaustion on
 * large organisations.
 */
export async function collectWeeklyTrends(
  repos: { owner: string; name: string }[],
  weeksBack = 12,
  maxDetailFetches = 200
): Promise<WeeklyTrendPoint[]> {
  const octokit = await getOctokit();

  // Build exactly `weeksBack` buckets: current week and the preceding ones.
  const currentMonday = isoWeekMonday(new Date());
  const startMonday = new Date(currentMonday);
  startMonday.setUTCDate(currentMonday.getUTCDate() - (weeksBack - 1) * 7);

  const weeks = new Map<string, WeeklyTrendPoint>();
  const cursor = new Date(startMonday);
  for (let i = 0; i < weeksBack; i++) {
    const label = toIsoWeekLabel(cursor);
    weeks.set(label, {
      week: label,
      prsOpened: 0,
      prsMerged: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      linesAdded: 0,
      linesDeleted: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  // cutoff = start of the oldest bucket (inclusive).
  const cutoff = startMonday;
  const cutoffIso = cutoff.toISOString();

  // Budget for individual pulls.get() detail calls (to limit API fan-out).
  let detailFetchBudget = maxDetailFetches;

  for (const { owner, name } of repos) {
    try {
      // ── Issues ────────────────────────────────────────────────────────────
      // `since` filters by updated_at ≥ cutoff, which is a superset of what
      // we want. We apply created_at / closed_at checks client-side.
      const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        owner,
        repo: name,
        state: "all",
        since: cutoffIso,
        per_page: 100,
      });

      for (const issue of issues) {
        if (issue.pull_request) continue; // issues endpoint also returns PRs

        const createdAt = new Date(issue.created_at);
        if (createdAt >= cutoff) {
          const wk = toIsoWeekLabel(createdAt);
          const bucket = weeks.get(wk);
          if (bucket) bucket.issuesOpened++;
        }

        if (issue.state === "closed" && issue.closed_at) {
          const closedAt = new Date(issue.closed_at);
          if (closedAt >= cutoff) {
            const wk = toIsoWeekLabel(closedAt);
            const bucket = weeks.get(wk);
            if (bucket) bucket.issuesClosed++;
          }
        }
      }

      // ── Pull Requests ─────────────────────────────────────────────────────
      // Sorted by updated desc so we can exit early once we pass the cutoff.
      // A PR with updated_at < cutoff cannot have created_at or merged_at
      // within the window (those dates are always ≤ updated_at).
      for await (const response of octokit.paginate.iterator(
        octokit.rest.pulls.list,
        {
          owner,
          repo: name,
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 100,
        }
      )) {
        let reachedCutoff = false;
        for (const pr of response.data) {
          if (new Date(pr.updated_at) < cutoff) {
            reachedCutoff = true;
            break;
          }

          const createdAt = new Date(pr.created_at);
          if (createdAt >= cutoff) {
            const wk = toIsoWeekLabel(createdAt);
            const bucket = weeks.get(wk);
            if (bucket) bucket.prsOpened++;
          }

          if (pr.merged_at) {
            const mergedAt = new Date(pr.merged_at);
            if (mergedAt >= cutoff) {
              const wk = toIsoWeekLabel(mergedAt);
              const bucket = weeks.get(wk);
              if (bucket) {
                bucket.prsMerged++;
                if (detailFetchBudget > 0) {
                  detailFetchBudget--;
                  try {
                    const { data: detail } = await octokit.rest.pulls.get({
                      owner,
                      repo: name,
                      pull_number: pr.number,
                    });
                    bucket.linesAdded += detail.additions;
                    bucket.linesDeleted += detail.deletions;
                  } catch {
                    // Skip line counts if detail fetch fails
                  }
                }
              }
            }
          }
        }
        if (reachedCutoff) break;
      }
    } catch (err: unknown) {
      // Skip repos that are inaccessible or have features disabled.
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 410) continue;
      console.warn(`  ⚠ trends: skipping ${owner}/${name}: ${String(err)}`);
    }
  }

  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}
