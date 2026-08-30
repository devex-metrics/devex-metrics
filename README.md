# devex-metrics

**Website: https://devex-metrics.github.io/devex-metrics/**

DevEx reporting and dashboarding for GitHub repos and organizations.

## What it does

Collects developer-experience metrics for a GitHub **organization** or **user** and produces a Markdown report plus a JSON cache file. Metrics include:

| Metric | Scope |
| ------ | ----- |
| Number of repositories | org / user |
| Open / closed issues | per repo |
| Open / merged / closed pull requests | per repo |
| Lines added / deleted per PR | per PR |
| Comments & commits per PR | per PR |
| Time to merge (hours) | per PR |
| Estimated GitHub Actions minutes per PR | per PR |
| AI authorship (Copilot / Claude / Codex) | per PR |
| Copilot code review | per PR |
| Copilot-authored PRs (% of merged) | per repo |
| Copilot-reviewed PRs (% of sampled PRs) | per repo |
| Median cycle time | org / user |
| Weekly activity trends (PRs, issues, lines) | per repo + org |
| Issue lead time (issue created → PR merged) | per repo |
| Unique committers (last 90 days) | per repo |
| Unique reviewers (last 90 days) | per repo |
| Dependent repository count | per repo |
| Copilot agent tasks & sessions (30-day window) | per repo |
| Copilot agent credits used | per repo |
| PRs and Actions minutes from agent tasks | per repo |

Data is collected once per day and appended to a long-term history store on the
orphan `metrics-data` branch, so trends survive across runs and nothing is ever
committed to the default branch. See
[docs/CONFIGURATION.md](docs/CONFIGURATION.md) for deploying this against your
own organisation.

## Quick start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with a personal access token (replace <owner> with a GitHub org or username)
GITHUB_TOKEN=ghp_xxx node dist/index.js <owner> [org|user]

# Or run with a GitHub App
APP_ID=12345 APP_PRIVATE_KEY="$(cat private-key.pem)" node dist/index.js <owner> [org|user]

# Build the dashboard from whatever has been collected
node dist/build-pages.js <owner>
```

The report is written to `data/<owner>-report.md`, and the history store to
`data/history/<owner>/` unless `DEVEX_HISTORY_DIR` says otherwise.

Configuration comes from `DEVEX_*` environment variables — the same ones set as
GitHub Actions variables in a real deployment. For local work you can instead
copy `devex.config.example.json` to `devex.config.json` (gitignored).

## Running in GitHub Actions

A workflow is included at `.github/workflows/collect-metrics.yml`.

### Option A – Personal Access Token

1. Create a **Personal Access Token** with `repo` and `read:org` scopes.
2. Add it as a repository secret. It cannot be called `GITHUB_TOKEN` — that name
   is reserved by Actions — so use something like `METRICS_TOKEN` and map it to
   the `GITHUB_TOKEN` environment variable in the workflow step.

### Option B – GitHub App (recommended)

Using a GitHub App provides fine-grained permissions and higher rate limits.

1. [Create a GitHub App](https://docs.github.com/en/apps/creating-github-apps) with the required repository permissions (e.g. `Issues: read`, `Pull requests: read`, `Contents: read`).
2. Install the app on the target organisation or repositories.
3. Add the **App ID** as a repository variable named `APP_ID`.
4. Add the **App private key** (PEM) as a repository secret named `APP_PRIVATE_KEY`.

The installation ID is retrieved automatically at runtime.

### Deploying

1. Enable **GitHub Pages** in your repo settings (set source to *GitHub Actions*).
2. Optionally add a **fine-grained PAT** as a repository secret named `COPILOT_AGENT_TOKEN` (with the "Copilot agent tasks" permission) to enable Copilot agent task metrics. GitHub App tokens are not supported for this API.
3. Configure the deployment with Actions **variables** — at minimum `DEVEX_OWNER`.
   See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full list.
4. The workflow runs daily at 06:00 UTC. It:
   - Checks out the `metrics-data` branch (creating it on first run)
   - Collects only new / changed metrics (per-repo cache entries stay valid for 8 hours)
   - Appends a daily rollup and any new merged-PR events to the history store
   - Pushes the updated store back to `metrics-data`
   - Builds an HTML dashboard and deploys it to GitHub Pages
5. You can also trigger it manually via *Actions → Collect DevEx Metrics → Run workflow*.

Nothing is committed to the default branch. Collected data lives on the
`metrics-data` orphan branch, which is a data store only — never built, served,
or merged. The dashboard is published via GitHub Pages from an uploaded
artifact, so no branch is served directly.

### Getting the full history

The scheduled collection walks back two years to stay cheap. A background crawl
then walks each repository forward from its first pull request, a bounded number
of pages per run, until the whole history is in the event stream — and marks
each repository complete so it is never crawled again.

Everything derived from pull requests ends up reaching back to the repository's
first one. Point-in-time figures (dependent counts, Copilot agent metrics,
repository settings) cannot be recovered for past dates by any API, so
reconstructed rows leave them empty rather than guessing. See
[docs/CONFIGURATION.md](docs/CONFIGURATION.md#getting-the-full-history).

### Seeding point-in-time history from existing snapshots

If a deployment previously committed daily snapshot files, each of those commits
is a daily observation — including rolling-window metrics the collector cannot
reconstruct retroactively. Replay them into the store with:

```bash
node scripts/backfill-history.mjs data/<owner>.fixture.json .metrics-data/data
```

or tick **replay_snapshots** when running the collect workflow manually. It is safe to
re-run: a day already recorded is replaced rather than duplicated, and a pull
request already in the event stream is never appended twice.

### Improvement trials

Set `DEVEX_TEAM_REPOS` and `DEVEX_TRIAL_TITLE` (plus optionally
`DEVEX_TRIAL_START`, `DEVEX_BASELINE_FROM` / `DEVEX_BASELINE_TO` and
`DEVEX_TRIAL_MILESTONES`) and the dashboard grows a trial panel: the
intervention title, the whole org as the baseline, the team's current numbers,
and the difference between them. Durations are reported as median, p75 and p90
with sample sizes, and the panel says so plainly when there is not yet enough
team data to read a difference.

Every dashboard view is addressable — the period, repository selection, scope
and bot filter are held in the query string, and **Copy link** puts the current
slice on the clipboard.

## Project structure

```
src/
  index.ts              # CLI entry point, ESM re-export, & orchestrator
  config.ts             # Deployment config from Actions variables / DEVEX_CONFIG
  build-pages.ts        # Generates HTML site for GitHub Pages
  collect.ts            # Core collection orchestrator (cache-aware, calls all collectors)
  history.ts            # Append-only rollup + event store (metrics-data branch)
  stats.ts              # Median / percentile helpers
  types.ts              # TypeScript interfaces
  github-client.ts      # Octokit singleton wrapper
  cache.ts              # JSON file-based daily cache
  agent-cache.ts        # Per-repo Copilot agent task cache
  report.ts             # Markdown report generator
  save-fixture.ts       # CLI utility: save current API response as a test fixture
  link-header.ts        # GitHub Link header pagination helper
  collectors/
    repos.ts            # List repositories
    issues.ts           # Issue counts
    pull-requests.ts    # PR counts & detailed PR metrics
    contributors.ts     # Committer & reviewer counts
    dependents.ts       # Dependent repo count
    trends.ts           # Weekly activity trend aggregation
    repo-graphql.ts     # GraphQL-based merged PR timeline
    copilot-agent.ts    # Copilot coding agent task metrics
data/                   # Local cache (gitignored)
.metrics-data/          # History store checkout (gitignored; the metrics-data branch)
_site/                  # Generated GitHub Pages site (gitignored)
scripts/
  metrics-data.sh       # Check out / publish the metrics-data branch
  backfill-history.mjs  # Seed the history store from committed snapshots
docs/
  CONFIGURATION.md      # Every Actions variable, and how to scope a trial
.github/workflows/
  ci.yml                # Build + test on PR / push to main
  collect-metrics.yml   # Scheduled data collection, then calls pages.yml
  pages.yml             # Reusable: build the site from metrics-data and deploy
  deploy-pages.yml      # Rebuild the site without re-collecting
```

## Testing

```bash
npm test
```

## License

[CC0 1.0 Universal](LICENSE)
