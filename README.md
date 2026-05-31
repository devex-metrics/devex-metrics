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

Data is cached as JSON in `data/<owner>.json` and only refreshed once per day.

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
```

The report is written to `data/<owner>-report.md`.

## Running in GitHub Actions

A workflow is included at `.github/workflows/collect-metrics.yml`.

### Option A – Personal Access Token

1. Create a **Personal Access Token** with `repo` and `read:org` scopes.
2. Add it as a repository secret named `GITHUB_TOKEN` (or set the `GITHUB_TOKEN` environment variable locally).

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
3. The workflow runs daily at 06:00 UTC. It:
   - Restores the previous day's cached data from `actions/cache`
   - Collects only new / changed metrics (skips if cached data is still fresh)
   - Saves the updated cache for the next run
   - Builds an HTML dashboard and deploys it to GitHub Pages
4. You can also trigger it manually via *Actions → Collect DevEx Metrics → Run workflow*.

No data is committed to the main branch — the cache lives in GitHub Actions and the report is published via GitHub Pages.

## Project structure

```
src/
  index.ts              # CLI entry point, ESM re-export, & orchestrator
  build-pages.ts        # Generates HTML site for GitHub Pages
  collect.ts            # Core collection orchestrator (cache-aware, calls all collectors)
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
data/                   # Local cache (gitignored; persisted via actions/cache in CI)
_site/                  # Generated GitHub Pages site (gitignored)
.github/workflows/
  ci.yml                # Build + test on PR / push to main
  collect-metrics.yml   # Scheduled data collection + Pages deploy
```

## Testing

```bash
npm test
```

## License

[CC0 1.0 Universal](LICENSE)
