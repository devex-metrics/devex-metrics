/**
 * GitHub Actions workflow runs, one page at a time.
 *
 * CI health is the most expensive thing in this repository to measure. The
 * obvious route — check runs per commit — costs one API call per commit and
 * would dwarf everything else the daily collection does. The workflow-runs
 * listing carries the same facts (conclusion, queue delay, wall-clock time,
 * re-run attempt) for a hundred runs per call, which is two orders of
 * magnitude cheaper for the same answers.
 *
 * This module fetches exactly one page and returns it. Deciding how many pages
 * a run may spend, and where to resume tomorrow, is the caller's job — see
 * `src/ci-health.ts`.
 */

import { getOctokit } from "../github-client.js";

/** One workflow run, reduced to the facts CI health is derived from. */
export interface WorkflowRunFacts {
  /** Run id. Stable across re-run attempts of the same run. */
  id: number;
  /** Re-run attempt. 1 for a first attempt. */
  attempt: number;
  /** Workflow name, for attributing a failure to a pipeline. */
  workflow: string;
  /** Branch the run was for. */
  branch: string;
  /** Commit the run was for. A re-run keeps the same SHA. */
  headSha: string;
  /** Triggering event (push, pull_request, schedule…). */
  event: string;
  /** queued | in_progress | completed. */
  status: string;
  /** success | failure | cancelled | skipped… ; null while still running. */
  conclusion: string | null;
  /** When the run was created — the start of the queue wait. */
  createdAt: string;
  /** When a runner picked the run up. Absent on very old runs. */
  startedAt?: string;
  /** Last update; for a completed run, when it finished. */
  updatedAt: string;
}

/** One page of workflow runs. */
export interface WorkflowRunPage {
  runs: WorkflowRunFacts[];
  /** True when GitHub reported a full page, so another may follow. */
  hasMore: boolean;
}

/**
 * Whether an auth failure has already been reported this process.
 *
 * An expired token fails identically for every repository. Warning once per
 * repository buries the run log in a thousand copies of the same line, and the
 * one time that mattered in production it buried the fact that collection had
 * stopped for twelve days. Warn once, keep going, return empty.
 */
let authFailureWarned = false;

/** Reset the auth-warning latch. Exported for tests. */
export function resetWorkflowRunAuthLatch(): void {
  authFailureWarned = false;
}

interface RawRun {
  id: number;
  name?: string | null;
  run_attempt?: number;
  head_branch?: string | null;
  head_sha: string;
  event: string;
  status?: string | null;
  conclusion?: string | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
}

function toFacts(raw: RawRun): WorkflowRunFacts {
  return {
    id: raw.id,
    attempt: raw.run_attempt ?? 1,
    workflow: raw.name ?? "",
    branch: raw.head_branch ?? "",
    headSha: raw.head_sha,
    event: raw.event,
    status: raw.status ?? "",
    conclusion: raw.conclusion ?? null,
    createdAt: raw.created_at,
    startedAt: raw.run_started_at ?? undefined,
    updatedAt: raw.updated_at,
  };
}

const PER_PAGE = 100;

/**
 * Fetch one page of workflow runs for `owner/repo` on `branch`.
 *
 * `createdBefore` (a YYYY-MM-DD date) pins the listing: the endpoint returns
 * newest first, so without an anchor a page number would mean something
 * different on every run and a resumed crawl would skip or repeat runs. With
 * one, page 7 is page 7 tomorrow too.
 *
 * Returns `null` when the repository, its Actions data or the token is not
 * usable — a missing optional collector must never abort a collection run.
 */
export async function fetchWorkflowRunPage(
  owner: string,
  repo: string,
  branch: string,
  createdBefore: string,
  page: number
): Promise<WorkflowRunPage | null> {
  let octokit;
  try {
    octokit = await getOctokit();
  } catch {
    if (!authFailureWarned) {
      authFailureWarned = true;
      console.warn(`  ⚠ ci: no usable token; skipping CI health for every repository`);
    }
    return null;
  }

  try {
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch,
      created: `<=${createdBefore}`,
      per_page: PER_PAGE,
      page,
    });
    const raw = (data.workflow_runs ?? []) as RawRun[];
    return { runs: raw.map(toFacts), hasMore: raw.length === PER_PAGE };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    if (status === 403) {
      console.warn(
        `  ⚠ ci: skipping ${owner}/${repo}: access denied (403) — the token needs "Actions: read"`
      );
      return null;
    }
    if (status === 401) {
      if (!authFailureWarned) {
        authFailureWarned = true;
        console.warn(
          `  ⚠ ci: authentication failed (401) — CI health is skipped for every repository until the token is renewed`
        );
      }
      return null;
    }
    if (typeof status === "number" && status >= 500) {
      console.warn(`  ⚠ ci: ${owner}/${repo} returned ${status}; will retry next run`);
      return null;
    }
    throw err;
  }
}
