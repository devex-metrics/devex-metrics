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
| Estimated GitHub Actions minutes per PR | per PR |
| Unique committers (last 90 days) | per repo |
| Unique reviewers (last 90 days) | per repo |
| Dependent repository count | per repo |

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

1. Create a **GitHub OAuth App** or **Personal Access Token** with `repo` and `read:org` scopes.
2. Add it as a repository secret named `METRICS_GITHUB_TOKEN`.

### Option B – GitHub App (recommended)

Using a GitHub App provides fine-grained permissions and higher rate limits.

1. [Create a GitHub App](https://docs.github.com/en/apps/creating-github-apps) with the required repository permissions (e.g. `Issues: read`, `Pull requests: read`, `Contents: read`).
2. Install the app on the target organisation or repositories.
3. Add the **App ID** as a repository variable named `APP_ID`.
4. Add the **App private key** (PEM) as a repository secret named `APP_PRIVATE_KEY`.

The installation ID is retrieved automatically at runtime.

### Deploying

3. Enable **GitHub Pages** in your repo settings (set source to *GitHub Actions*).
4. The workflow runs daily at 06:00 UTC. It:
   - Restores the previous day's cached data from `actions/cache`
   - Collects only new / changed metrics (skips if cached data is still fresh)
   - Saves the updated cache for the next run
   - Builds an HTML dashboard and deploys it to GitHub Pages
5. You can also trigger it manually via *Actions → Collect DevEx Metrics → Run workflow*.

No data is committed to the main branch — the cache lives in GitHub Actions and the report is published via GitHub Pages.

## Project structure

```
src/
  index.ts              # CLI entry point & orchestrator
  build-pages.ts        # Generates HTML site for GitHub Pages
  types.ts              # TypeScript interfaces
  github-client.ts      # Octokit singleton wrapper
  cache.ts              # JSON file-based daily cache
  report.ts             # Markdown report generator
  collectors/
    repos.ts            # List repositories
    issues.ts           # Issue counts
    pull-requests.ts    # PR counts & detailed PR metrics
    contributors.ts     # Committer & reviewer counts
    dependents.ts       # Dependent repo count
data/                   # Local cache (gitignored; persisted via actions/cache in CI)
_site/                  # Generated GitHub Pages site (gitignored)
.github/workflows/
  collect-metrics.yml   # Scheduled GitHub Actions workflow
```

## Testing

```bash
npm test
```

## License

[CC0 1.0 Universal](LICENSE)
