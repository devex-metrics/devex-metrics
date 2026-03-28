# devex-metrics

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

# Run (replace <owner> with a GitHub org or username)
GITHUB_TOKEN=ghp_xxx node dist/index.js <owner> [org|user]
```

The report is written to `data/<owner>-report.md`.

## Running in GitHub Actions

A workflow is included at `.github/workflows/collect-metrics.yml`.

1. Create a **GitHub OAuth App** or **Personal Access Token** with `repo` and `read:org` scopes.
2. Add it as a repository secret named `METRICS_GITHUB_TOKEN`.
3. The workflow runs daily at 06:00 UTC and commits updated data back to the repo.
4. You can also trigger it manually via *Actions → Collect DevEx Metrics → Run workflow*.

## Project structure

```
src/
  index.ts              # CLI entry point & orchestrator
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
data/                   # Cached JSON & generated reports
.github/workflows/
  collect-metrics.yml   # Scheduled GitHub Actions workflow
```

## Testing

```bash
npm test
```

## License

[CC0 1.0 Universal](LICENSE)
