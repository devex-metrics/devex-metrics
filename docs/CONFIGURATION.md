# Configuring a deployment

Everything that makes a deployment site-specific lives in **GitHub Actions
variables**. Nothing needs to be committed, so a customer's repository stays a
clean fork of this one and upgrades are a fast-forward rather than a merge.

`devex.config.example.json` documents the full shape. Copy it to
`devex.config.json` for local development — that filename is gitignored.

## Resolution order

Later entries win:

1. Built-in defaults
2. `devex.config.json` in the working directory (or `DEVEX_CONFIG_FILE`)
3. `DEVEX_CONFIG` — the whole config object as a JSON string, in one variable
4. Discrete `DEVEX_*` variables

Use `DEVEX_CONFIG` for the bulk of the setup and discrete variables for the
values you tweak often — a trial start date, the team repo list.

## Variables

Set these under **Settings → Secrets and variables → Actions → Variables**.

| Variable | Type | Meaning |
| --- | --- | --- |
| `DEVEX_OWNER` | string | GitHub org or username to collect. **Required.** |
| `DEVEX_OWNER_TYPE` | `org` \| `user` | How to enumerate repositories. Default `org`, auto-corrected to `user` when the owner turns out to be a personal account. |
| `DEVEX_CONFIG` | JSON | The whole config object, as in the example file. |
| `DEVEX_TITLE` | string | Dashboard title. |
| `DEVEX_ATTRIBUTION` | string | Attribution line in the header. |
| `DEVEX_ATTRIBUTION_URL` | string | Where the attribution links to. |
| `DEVEX_REPOS_INCLUDE` | list | Globs to keep. Empty means every repo. |
| `DEVEX_REPOS_EXCLUDE` | list | Globs to drop, applied after include. |
| `DEVEX_EXCLUDE_ARCHIVED` | bool | Skip archived repos. Default `true`. |
| `DEVEX_EXCLUDE_FORKS` | bool | Skip forks. Default `false`. |
| `DEVEX_MAX_IDLE_DAYS` | int | Skip repos with no push in N days. `0` disables. |
| `DEVEX_TEAM_REPOS` | list | Globs marking the trial team's repos. |
| `DEVEX_TEAM_NAME` | string | Team display name. |
| `DEVEX_TEAM_ID` | string | Stable id used in history rows and share URLs. |
| `DEVEX_DISCOVER_ALL` | bool | Collect the whole org as a baseline. Default `true`. |
| `DEVEX_TRIAL_TITLE` | string | Intervention headline. |
| `DEVEX_TRIAL_HYPOTHESIS` | string | What the intervention should change. |
| `DEVEX_TRIAL_START` | date | Intervention start, `YYYY-MM-DD`. |
| `DEVEX_BASELINE_FROM` | date | Baseline window start. |
| `DEVEX_BASELINE_TO` | date | Baseline window end. |
| `DEVEX_TRIAL_MILESTONES` | list | `2026-04-01=Training complete; 2026-05-15=Rollout` |
| `DEVEX_HISTORY_WEEKS` | int | Weeks of weekly trends to build. Default `104`. |
| `DEVEX_MAX_PR_PAGES` | int | Pages of merged PRs per repo. Default `10`. |
| `DEVEX_MAX_REPO_AGE_HOURS` | int | Per-repo cache freshness. Default `8`. |
| `DEVEX_INCREMENTAL` | bool | Collect only repos with a push or issue/PR activity since today's cached baseline. Default `false`; the collect workflow turns it on for manual runs (see *Fast manual refreshes*). |
| `DEVEX_FEATURE_DEPENDENTS` | bool | Dependent-repo counts. Default `false`. |
| `DEVEX_FEATURE_COPILOT_AGENT` | bool | Copilot agent metrics. Default `true`. |
| `DEVEX_FEATURE_CI_HEALTH` | bool | CI health crawl (build success, duration, queue time, flaky re-runs). Default `false`. |
| `DEVEX_FEATURE_LANDSCAPE` | bool | Opt in to the public-repository landscape scan and show its results on Pages. Default `false`; disabled preparation skips scanning and requesting an additional token. The scanner is installed by the normal `npm ci` regardless of this flag. |
| `DEVEX_LANDSCAPE_STALE_AFTER_DAYS` | int | Landscape file staleness threshold in days (`collection.landscapeStaleAfterDays`). Default `90`. |
| `DEVEX_FEATURE_PUBLIC_DISCOVERY` | bool | Separate full-history public repository discovery panel (`collection.features.publicDiscovery`). Default `false`. |
| `DEVEX_PUBLIC_DISCOVERY_MAX_REPOS` | int | Optional number of public repositories to scan ranked by merged PRs in the collected 90-day timeline (`collection.publicDiscoveryMaxRepos`). Default `0` means all eligible repositories. Set `20` for the initial public deployment. |
| `DEVEX_PUBLIC_DISCOVERY_MAX_SIZE_KB` | int | Maximum GitHub API repository size in KiB before skipping a full-history clone (`collection.publicDiscoveryMaxSizeKb`). Default `512000` (~500 MiB). `0` disables this safety limit deliberately. |
| `DEVEX_PUBLIC_DISCOVERY_MAX_CLONE_SIZE_KB` | int | Maximum combined on-disk size of all full-history clones in KiB (`collection.publicDiscoveryMaxCloneSizeKb`). Default `8388608` (8 GiB). Must be positive; still enforced if the per-repo size limit is `0`. |
| `DEVEX_PUBLIC_DISCOVERY_CLONE_MINUTES` | int | Maximum elapsed time for the entire full-history clone phase (`collection.publicDiscoveryCloneMinutes`). Default `60`; accepted range `1`–`360`. Each individual clone also has a 15-minute limit. |
| `DEVEX_CI_PAGES_PER_RUN` | int | CI crawl budget per run, all repos. Default `20`. |
| `DEVEX_CI_MAX_PAGES_PER_REPO` | int | CI crawl cap per repo per run. Default `5`. |
| `DEVEX_CI_WINDOW_DAYS` | int | Days of CI history the dashboard reads back. Default `90`. |
| `DEVEX_HISTORY_ENABLED` | bool | Append to the history store. Default `true`. |
| `DEVEX_HISTORY_DIR` | path | Where the history store lives. Set by the workflow. |
| `DEVEX_BACKFILL_ENABLED` | bool | Crawl history back to each repo's first PR. Default `true`. |
| `DEVEX_BACKFILL_PAGES_PER_RUN` | int | Crawl budget per run, all repos. Default `200`. |
| `DEVEX_BACKFILL_MAX_PAGES_PER_REPO` | int | Cap per repo per run. Default `20`. |
| `DEVEX_BACKFILL_RECOMPUTE` | bool | Rebuild historical rollups from events. Default `true`. |
| `DEVEX_BACKFILL_PAGE_SIZE` | int | Historical GraphQL page size, 1–100. Default `50`. |
| `DEVEX_BACKFILL_MIN_PAGE_SIZE` | int | Floor for adaptive reduction, 1–100, ≤ page size. Default `10`. |
| `DEVEX_BACKFILL_ADAPTIVE_PAGE_SIZE` | bool | Shrink a repo's page size after a timeout instead of giving up. Default `true`. |

Lists accept commas, semicolons or newlines. Booleans accept
`1/true/yes/on` — anything else is false. Setting a list variable to an empty
string clears it rather than falling back to the default.

Globs support `*` and `?`, and are matched against both `repo` and
`owner/repo`, case-insensitively.

### Collecting a personal account

`DEVEX_OWNER` may name a personal account rather than an organisation. Leaving
`DEVEX_OWNER_TYPE` unset is fine: discovery notices that the owner is not an
org and re-lists it as a user, warning once per run. Setting
`DEVEX_OWNER_TYPE=user` explicitly skips the check and the warning.

When the owner is also the account the token authenticates as, discovery lists
that account's own repositories, which includes repos it reaches through
organisation membership — so a personal-account deployment usually sees more
than the account's public profile does.

## Baselining the org, measuring the team

The default posture for an improvement trial:

```
DEVEX_OWNER          = acme
DEVEX_OWNER_TYPE     = org
DEVEX_DISCOVER_ALL   = true                 # collect every repo -> org baseline
DEVEX_TEAM_REPOS     = acme/api, acme/web   # ...and flag these as the team
DEVEX_TRIAL_TITLE    = Trunk-based development
DEVEX_TRIAL_START    = 2026-05-01
```

Collection walks the whole org, so the rest of the org is the comparison group,
and the dashboard shows the team's numbers against that baseline.

`DEVEX_TEAM_REPOS` alone is enough for that comparison: the dashboard renders a
baseline-versus-focus table — every collected repository on one side, the team's
repositories on the other — as soon as a team is configured. The `DEVEX_TRIAL_*`
variables are an overlay on top of it, adding a headline, a hypothesis, an
intervention date and milestone markers on the charts. Configure the comparison
first and add the trial framing when an experiment actually starts.

The comparison includes median wait from opening a PR to its first submitted
review, as well as PR cycle time. Both columns use the selected period by
default; `DEVEX_BASELINE_FROM` / `DEVEX_BASELINE_TO` pin the all-repos baseline
to historical dates instead. The baseline includes the team's PRs. Review wait
uses reviewed merged PRs only (including bot reviews), with separate reviewed
PR sample sizes; unreviewed or still-open PRs are not counted. Team scope
means PRs in the configured repositories, regardless of the author's team. The
note below the table also compares team wait with non-team repositories over
the same selected period, even when the trial baseline is historical. Above
the table, the absolute gap between team and all-repo medians is highlighted.
The **Awaiting first review** tab shows the oldest five open, non-draft PRs
without a submitted review in the configured team's repositories. It uses
the collection-time snapshot regardless of the selected period or repository
picker; the bot toggle still applies. Only the 100 oldest open PRs per repo
are sampled, and the tab warns if a repo has more or if GraphQL review status
was unavailable. A new collection is needed to populate review status in
older open-PR snapshots.

The **Reviews and rework by repository** table uses merged PRs in the selected
period and follows the repository picker and bot filter. Median review rounds
mean submitted reviews per reviewed PR, not distinct back-and-forth cycles.
Conversation comments exclude inline review comments; review threads are
displayed separately as thread counts, not comment counts. Commits after the
first submitted review are identified by recorded commit timestamps, which
cannot establish that a review prompted the changes or when they were pushed.
GitHub supplies at most the latest 100 commit timestamps per PR; incomplete
counts are shown as lower bounds. The expandable repository rows link to up to
five PRs with the highest post-review commit counts. REST fallback cannot
provide these review/comment/commit facts for the timeline and is shown as
unavailable rather than zero. The Markdown report also shows per-repository
sample sizes and lower bounds. Newly collected raw comment and commit facts
are retained in future events; older append-only events are not rewritten.

To collect *only* the team's repos — much cheaper, but no baseline — set
`DEVEX_DISCOVER_ALL=false`. Repos are then filtered to `DEVEX_TEAM_REPOS`
during discovery, so the API cost drops to the team's repos alone.

## Keeping the first run affordable

On a large org, start with `DEVEX_MAX_IDLE_DAYS=180` and
`DEVEX_EXCLUDE_ARCHIVED=true`. Dormant repositories usually make up most of the
repo count and none of the signal.

## Fast manual refreshes

The scheduled run is always a full collection. When it finishes, it saves the
collected snapshot to the Actions cache under a key that includes the UTC date
(`metrics-snapshot-<owner>-<YYYY-MM-DD>-<run>`).

A manual **Collect DevEx Metrics** run restores the newest snapshot from
*today* and sets `DEVEX_INCREMENTAL=true`. It then collects only the delta:

- A repository is re-collected if its `pushed_at` changed, if the Search API
  shows issue or pull-request updates since the snapshot (comments, merges,
  PRs from forks, issue triage), or if it had open pull requests in the
  snapshot. A submitted review does not reliably bump a pull request's
  `updated_at`, so repositories with open PRs are always refreshed.
- Every other repository reuses its snapshot data, including its weekly
  trends. The org-wide trend series is re-summed from the per-repo series.
- The historical backfill is skipped, because the nightly run does it. Pass
  `backfill_pages` to crawl anyway.

Every successful run saves a new snapshot, so later manual runs that day build
on the newest one. The date in the key breaks the chain each day. If no
snapshot from today exists, the run collects everything. That happens when a
manual run starts before the scheduled one, or when the scheduled run failed.
The same full collection happens when the activity search can't give a complete
answer (it errors, or returns more than 1000 results).

Tick **full_refresh** on a manual run to ignore the snapshot and re-collect
everything.

Some changes are only picked up by the next full run. The main ones are
contributor counts drifting as the 90-day window moves, and Copilot agent tasks
that have not yet produced a push or PR activity.

## Getting the full history

A scheduled collection is deliberately cheap: it walks back two years and stops.
Everything older is not lost, only unrequested — GitHub still holds it. The
backfill crawls each repository forward from its first pull request, a bounded
number of pages per run, until the whole history is in the event stream.

It runs automatically after each collection. A repository that reports no
further pages is marked complete in `backfill.json` and never costs anything
again, so the crawl converges and then stops paying for itself.

```
DEVEX_BACKFILL_PAGES_PER_RUN = 200     # ~20k pull requests per run
DEVEX_BACKFILL_MAX_PAGES_PER_REPO = 20 # no single repo starves the rest
```

Roughly: a personal account of a few thousand pull requests finishes in one or
two runs. A 200-repo organisation is a few thousand pages, so it lands over a
week or so of daily runs. Raise `DEVEX_BACKFILL_PAGES_PER_RUN` to go faster —
the ceiling is the GraphQL rate limit, and the crawl uses a lean query that is
several times cheaper per page than the daily one.

To sprint through it once, run the workflow manually with **backfill_pages** set
high (say `2000`), then leave the default in place for the steady state.

### Adaptive page sizing

A very large repository can make a single historical page (`first: 50` PRs,
each with reviews and body text) take 10+ seconds, which risks a GitHub 502/504
or a generic GraphQL execution error — even though the account's primary
GraphQL rate limit is nowhere near exhausted. Rather than fail the whole
repository, the crawl retries the *same* page at a smaller size:

```
DEVEX_BACKFILL_PAGE_SIZE = 50           # requested `first` per historical page
DEVEX_BACKFILL_MIN_PAGE_SIZE = 10       # adaptive reduction stops here
DEVEX_BACKFILL_ADAPTIVE_PAGE_SIZE = true
```

On a timeout the size is halved (`50 → 25 → 12 → 10`) and the same cursor is
retried — never the next page, and the watermark never advances until a
request actually succeeds. Once a smaller size works, the repository keeps
using it for the rest of the run, and the size is remembered so a later run
does not repeat the same failed large request. A repository that keeps failing
even at the minimum size is simply retried on a later run, exactly like any
other transient backfill failure — no manual intervention is required.

Because a "page" always means one *successful* page regardless of its size,
shrinking the page size trades some pull requests per budgeted page for a
crawl that reliably makes progress on expensive repositories; `pagesPerRun`
and `maxPagesPerRepo` keep their existing meaning.

## Public repository landscape (opt-in)

The landscape scan is **off by default**. The published
`@devex-metrics/repo-landscape` scanner is a production npm dependency installed
with the rest of the application by `npm ci` and updated through Dependabot.
No additional token is created and no repositories are scanned unless the
feature is enabled via `DEVEX_FEATURE_LANDSCAPE` or `DEVEX_CONFIG`:

1. Ensure the GitHub App has `Contents: read` and its installation on the
   configured owner includes **every selected public repository**, including
   the first one. Public visibility alone does not give the App access.
   Empty repositories (no commits) are left out of the selection, since they
   have no HEAD commit to scan.
   Configure its `APP_ID` variable and `APP_PRIVATE_KEY` secret (also used for
   the existing collection).
2. Set `DEVEX_FEATURE_LANDSCAPE=true` (or
   `collection.features.landscape=true` in `DEVEX_CONFIG`) and run **Collect
   DevEx Metrics**. Disable that setting to stop scans and hide landscape
   results on Pages.

After the normal collection, `landscape-cli.js prepare` always runs. It
resolves `DEVEX_CONFIG` and discrete variables (discrete variables take
precedence), then returns disabled without scanning or minting a token
when the feature is off. When enabled, it reads the latest selected
`RepoMetrics` from `DEVEX_HISTORY_DIR` to write `data/landscape.config.json`
with an explicit public-only
`{ "schema_version": 1, "repositories": ["owner/repo"], "stale_after_days": 90 }`
config (shown with the default threshold). `stale_after_days` uses
`collection.landscapeStaleAfterDays`, overridden by
`DEVEX_LANDSCAPE_STALE_AFTER_DAYS`. The scanner does not rediscover
repositories: prepare derives the public, same-owner subset from the
DevEx-selected snapshot. Only if preparation says a scan is needed does the
workflow mint an installation token scoped to the configured owner
**and only the selected public repositories** with `Contents: read` and run
the CLI already in `node_modules` with
`npx --no-install`. The lockfile pins the installed version; ingestion verifies
the raw scan's `scanner_version` matches that package's version before
persisting the sanitized scan. The CLI requires Python 3.11 or newer.
Prepare supplies comma-separated same-owner repository names to the token
action; if that list is missing or invalid when a scan is needed, the workflow
fails before minting a token rather than falling back to all repositories in
the installation. The App private key is supplied only to the token-creation
action, not the scanner; the scanner receives only the short-lived
installation token.
A failure to create the scan token does not fail the collection: the run
reports a **Landscape scan skipped** warning with the fix in its step summary,
keeps the last good landscape data and records the landscape run as failed, so
the dashboard marks it as stale.
If **Create landscape scan token** fails with a `404` for
`GET /repos/{owner}/{first-repository}/installation`, check that the App
identified by `APP_ID` is installed with access to that first selected
repository, then confirm the installation covers every other selected public
repository and grants `Contents: read`. The action accepts both comma- and
newline-separated repository names; the comma-separated list is not the cause
of this error. Upgrading the token action does not grant missing App access.
Ingestion uses that same restricted token to re-check every repository is
still public before persisting any file paths. A privacy change, failed
re-check or missing token fails the scan rather than publishing stale paths.
Stored observations of any repository that is no longer verified public are
removed from the latest landscape observation and every stored snapshot, at
three points: `prepare` drops every repository outside the refreshed public
selection (now private, unknown visibility or no longer selected), before it
requests the scan token; any failure after the scan token is created
re-checks the selection with that token; and ingestion re-checks the whole
prepared selection before it reads the scanner output, so
a partial or malformed output cannot skip it. Those repositories then show as
unknown instead of keeping their old paths online. Earlier commits on the
`metrics-data` branch still contain them.

**Failed runs keep the last good data, marked as stale.** When any step of a
collection run fails with the landscape feature enabled, a final
`mark-failed` step scrubs repositories outside the current public selection,
records the failed attempt (time and run link) in `landscape/status.json`, and
the run still publishes the history store and rebuilds Pages before reporting
its failure. The dashboard keeps showing the last successful observation for
repositories that are still public, under a "Stale data" notice that names the
failed run and the time of the data shown. The next successful scan clears the
notice. Because the store is published on this path, DevEx history written
before the failure is published too.

The installation token is scoped to one owner and its selected repos. In user
mode, the DevEx selection may include public repositories belonging to other
owners; that token cannot be assumed to cover them. Cross-owner scanning needs
separate authorization. Until that is supported, prepare must leave those
repositories unknown or fail closed, never treat them as successfully scanned.

The raw scan stays in gitignored `data/landscape-raw.json`. Only when the
feature is enabled does ingestion read that raw file and sanitize it into a
**distinct landscape history stream** under `DEVEX_HISTORY_DIR` on the
data-only `metrics-data` branch before publication. Private repositories are
never scanned; their paths and contents must never be published. Sanitized
metrics-data retains public repository file paths, which the file-level
dashboard displays. A repository-level `403` or `404` from the scanner makes
the scan step fail before ingestion, so unreadable repos cannot produce
success-shaped landscape data; the post-failure re-check described above
scrubs any repository that is no longer public, and the rest keep their last
good observation under the stale-data notice. Within a
scanned repo, each file has a `known` or `unknown` status. If file history is
unavailable, age, lag and stale are `null`, not zero or healthy; the summary
reports `unknown_count` and `partial_unknown` status for incomplete coverage.
Hash drift means recorded hashes changed between comparable snapshots; it is
not a measure of code quality, security or freshness.

The Pages landscape defaults to **attention first**, rather than repository
name. Its overview distinguishes repositories with an observed zero AI
instruction files, older file-age signals, incomplete file history, and no
verified observation. Active repositories with an observed missing or older
file signal lead the table; unavailable scans and private/unverified
repositories stay unknown, not healthy or zero-readiness. Sortable columns
include attention, observed 90-day merged PRs, file count, oldest known age
(with head lag shown alongside), hash drift, and scan time. Sorting is local
to this panel; restore attention order with its reset button.

The **merged PRs / 90d** column comes from each repository's DevEx
`mergedPRTimeline` within the 90 days ending at `OrgMetrics.collectedAt`.
It counts observed PRs, including bot-authored ones, not Git commits or
team-attributed work; the budgeted timeline may be incomplete, so even a
displayed zero means no PR was *observed* in that window, not proven
inactivity. Missing or invalid timelines show **Unknown**. The landscape
scan itself has no commit-activity counts, per-file commits since the AI file
changed, team attribution, ADR count, or AI-instruction quality verdict. Optional
full-history public discovery can provide separate public commit/ADR metrics
when independently enabled, but never supplies or gates this AI-only view.
Age, lag, stale and hash drift are maintenance/observation signals only.
The landscape's 90-day window does not change with dashboard period or
bot filters, and it does not change `data.json` or `landscape.json`.

## Full-history public repository discovery (opt-in)

This is **separate** from `DEVEX_FEATURE_LANDSCAPE`: enabling either feature
does not enable or alter the other. The new panel appears after all DevEx and
AI-instruction sections. The base `data.json`, Markdown report, existing
metrics and filters remain unchanged. To activate this deployment, its
administrator must create Actions **variables**
`DEVEX_FEATURE_PUBLIC_DISCOVERY=true` and
`DEVEX_PUBLIC_DISCOVERY_MAX_REPOS=20`; repository variables cannot be set by
this code change. The default count for other installations remains unlimited,
subject to the default 512,000 KiB per-repository size limit. Operators can
lower the size limit to stay within runner resources or deliberately set `0`
to disable it. GitHub's size value estimates the current repository and may
understate full Git history; the clone step also imposes a 15-minute timeout
and a disk-space cap of twice the configured reported-size limit per repo.
Disabling the per-repo size guard also disables that per-repo disk guard, **not**
the combined 8 GiB on-disk clone budget or 60-minute total clone deadline.
The entire clone directory is checked during and between clones; exceeding
either total budget fails the scan instead of publishing partial observations,
and the last safe data is marked stale once the history store is published.
Increase the total budget only when the runner has enough disk and time; large
installations should also set an explicit repository count.

After normal collection, preparation derives the precise selection from its
latest filtered `RepoMetrics`. Only repositories positively marked public,
nonempty, within the configured owner, and within the size limit qualify.
Unknown size is always skipped, including when the limit is disabled. The CLI
accepts at most 500 selected repositories; if an installation exceeds that,
set an explicit repository count cap. With a repository
count cap, ranks are based on `mergedPRTimeline[].mergedAt` within the 90 days
ending at `OrgMetrics.collectedAt` (not `pushedAt` or lifetime PR counts).
Missing 90-day timeline is *ranking unknown* under a cap, not zero PRs;
the underlying DevEx timeline is budgeted and its ranked count can be a
lower bound. Ties break by case-insensitive full name. Oversized candidates
are skipped and the next eligible ranked repository fills the count cap.
Unselected, oversized, private, cross-owner, empty, or unverified repositories
show an explicit unknown/not-scanned reason and have no discovery metrics.

Only a **nonempty** selected list is sent to a Contents-read GitHub App token
scoped to those exact names; otherwise no extra token is minted. The adapter
independently confirms public visibility, same-owner identity, current size
and default-branch SHA using that token before cloning. Anonymous HTTPS clones
are full-history, not shallow; a repository whose HEAD moved between pinning
and clone fails closed rather than scanning an unpinned checkout. The installed
CLI runs in `local_git/full` mode with `--repos-dir`, `--expected-heads`, an
explicit selection config and `--output`; only then does the adapter re-check
public visibility using a fresh Contents-read App token scoped to the same
exact repository list (the pre-clone token may have expired). If refreshing
the token fails, ingestion is skipped and the run is marked stale. The adapter
then validates scanner version, provenance, selected names, all required fields
and every pinned HEAD. CLI denied, malformed, partial
or missing output is not considered an empty repository. Raw CLI output and
clones stay under gitignored `data/` and are never served or committed.
The App must have Contents-read access to *all* selected repositories; a
missing permission results in a stale notice and no new observation.

The independently versioned `public-discovery/latest.json` and at most 14
retained snapshots in `metrics-data` contain only allowlisted, bounded
aggregates: file/byte/source LOC counts, top five languages by physical source
LOC (ties by name), 30/90-day commit counts and a 90-point daily trend,
anonymous contributor count, ADR count, and manifest/produced/consumed counts.
Manifest count covers recognized manifests; produced/consumed artifact counts
and connection evidence can also
come from GitHub Actions and Jenkins configuration. Evidence-labeled heuristic
connections between verified-public repositories retain at most 50 edges,
two safe relative public file paths per edge, and **no** raw dependency names.
README body, title/summary, author identities, commit messages, unreviewed
paths and raw full-scan JSON are discarded. The site publishes a separate
`public-discovery.json` and removes it when the feature is disabled. Deltas
compare the latest successful observation with the previous successful
snapshot; a failed attempt keeps previously safe data under a stale banner
rather than replacing unknowns with zeros. Preparation scrubs newly
unselected/now-private observations and their edges from latest and retained
snapshots; failed scans and ingestion re-check visibility and scrub it again
before publishing. Prior Git commits on the data-only `metrics-data` branch
may still retain historical observations; access and retention of that
branch should be reviewed before enabling publication. Only public file
evidence from selected repositories can reach the site.

## CI health

Off by default. Build success rate, pipeline duration, runner queue time and
flaky re-runs are among the most useful things a team can measure and the most
expensive to fetch honestly: per-commit check runs cost one API call per commit,
for the life of every repository.

So this is not fetched by the daily collection at all. It uses the same
budgeted-watermark pattern as the pull-request backfill, against the workflow-runs
listing, which carries the same facts for a hundred runs per call:

```
DEVEX_FEATURE_CI_HEALTH      = true   # opt in; nothing is fetched otherwise
DEVEX_CI_PAGES_PER_RUN       = 20     # ~2 000 workflow runs per run, all repos
DEVEX_CI_MAX_PAGES_PER_REPO  = 5      # no single repo starves the rest
```

With the defaults that is **at most 20 extra REST calls a day**, and none at all
while the flag is off. Each repository keeps a cursor pinned to an anchor date,
so a page number means the same thing tomorrow as it did today. A repository
that reports a short page is caught up; on the next run its watermark is
re-armed against a fresh anchor and it costs one page to pick up new builds.

Runs are stored raw in `ci.ndjson` — one row per run attempt, with conclusion,
queue and timing — so a definition that changes later can be recomputed over
everything already collected. What the dashboard derives from them:

- **Default-branch build success rate.** Cancelled and skipped runs are dropped:
  a human changing their mind is not a broken pipeline.
- **Build duration** and **runner queue time**, as p50/p75/p90 with their sample
  sizes. Queue time is `run_started_at` minus `created_at` — how long a run
  waited before a runner picked it up.
- **Flaky rate**: runs that passed only on a re-run of the same commit. This is
  measured per *run*, not per job — job-level attribution would need one extra
  call per re-run, and the run-level signal answers the same question. A
  pipeline that is never re-run cannot appear, so the figure is a lower bound.

The token needs `Actions: read`. Without it the crawl warns once and collects
nothing; it never fails a run.

### What the history can and cannot contain

Once the crawl completes, everything derived from pull requests reaches back to
each repository's first one: cycle time, PR size and the share over 400 lines,
merge and abandonment counts, AI-versus-human authorship, review-load
concentration, and the raw review timestamps behind the three legs of review
latency (opened → first review → approval → merged) and the review-round count.
Newly collected events also retain conversation comments, review-thread counts
and up to 100 latest commit timestamps for the per-repository rework view;
previously written events are immutable and may lack these facts.
Historical rollup rows are recomputed from those events and marked
`reconstructed: true`.

Four things cannot be recovered for dates before this deployment started
running, because no GitHub API reports what they were on a past date:

- dependent-repository counts
- Copilot agent tasks, sessions and credits (the API exposes ~30 days)
- branch protection and other repository settings
- stars, forks and watchers

Reconstructed rows leave those fields at zero rather than guessing. For them,
the daily observations from now on — plus anything recovered by replaying
committed snapshots — is all there will ever be.

### Replaying committed snapshots

Separate from the API crawl: if a deployment previously committed daily snapshot
files, each commit is a daily observation of exactly those point-in-time
metrics. Replay them with:

```bash
node scripts/backfill-history.mjs data/<owner>.fixture.json .metrics-data/data
```

or tick **replay_snapshots** when running the collect workflow manually. This is
the only way to recover point-in-time history, and it only reaches as far back
as the oldest committed snapshot.
