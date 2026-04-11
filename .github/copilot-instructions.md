# Copilot Instructions

## Project overview

**devex-metrics** collects Developer Experience metrics from the GitHub API for a GitHub organisation or user account and produces a Markdown report and an HTML dashboard deployed to GitHub Pages. No data is committed to the repository; collected data lives in `data/` (gitignored, persisted via `actions/cache` in CI).

## Tech stack

- **Language**: TypeScript (strict mode, ES2022 target, Node16 module resolution)
- **Runtime**: Node.js 20, ESM (`"type": "module"` in package.json)
- **GitHub API**: `@octokit/rest` + `@octokit/auth-app` + `@octokit/plugin-throttling`
- **Tests**: Vitest with globals enabled (`vitest.config.ts`)
- **Build**: `tsc` → `dist/`
- **CI**: GitHub Actions (`.github/workflows/ci.yml` runs build + test on every PR/push)

## Project structure

```
src/
  index.ts              # CLI entry point & orchestrator
  build-pages.ts        # Generates static HTML for GitHub Pages
  types.ts              # All shared TypeScript interfaces (source of truth)
  github-client.ts      # Octokit singleton (token or GitHub App auth)
  cache.ts              # JSON file-based daily cache in data/
  report.ts             # Markdown report generator
  collectors/
    index.ts            # Re-exports all collectors
    repos.ts            # List repositories
    issues.ts           # Issue open/closed counts
    pull-requests.ts    # PR counts + detailed PR metrics
    contributors.ts     # Committer & reviewer counts (last 90 days)
    dependents.ts       # Dependent repository count
data/                   # Local cache (gitignored)
_site/                  # Generated GitHub Pages output (gitignored)
.github/workflows/
  ci.yml                # Build + test on PR / push to main
  collect-metrics.yml   # Scheduled data collection + Pages deploy
```

## Code conventions

- **Imports**: always use the `.js` extension (required for Node16 ESM), e.g. `import { foo } from "./foo.js"`.
- **Types**: define all shared interfaces in `src/types.ts`. Add JSDoc comments to every exported interface and property.
- **Functions**: prefer named exports over default exports.
- **Error handling**: surface errors early; avoid swallowing exceptions silently.
- **No `any`**: use `unknown` and narrow with type guards instead.
- **Async**: use `async/await` throughout; avoid raw `.then()` chains.
- **Comments**: only add comments when intent is non-obvious; avoid restating what the code already expresses clearly.

## Adding a new collector

1. Create `src/collectors/<name>.ts` and `src/collectors/<name>.test.ts`.
2. Export a single async function that accepts an Octokit instance plus whatever parameters it needs and returns a typed value.
3. Re-export from `src/collectors/index.ts`.
4. Add the new metric fields to the relevant interface in `src/types.ts`.
5. Wire up the collector in `src/index.ts` and surface the data in `src/report.ts` and `src/build-pages.ts`.
6. Write tests using vitest; prefer fixture-driven tests (see `src/save-fixture.ts`).

## Testing

- All test files live alongside the source file they test: `src/foo.test.ts` tests `src/foo.ts`.
- Run tests with `npm test` (vitest, single run) or `npm run test:watch` (watch mode).
- Tests use vitest globals (`describe`, `it`, `expect`) — no imports needed for those.
- Use real fixture JSON files under `data/` for integration-style tests; use `vi.fn()` / `vi.spyOn()` to mock Octokit calls for unit tests.

## GitHub Actions

- **ci.yml**: runs `npm ci`, `npm run build`, `npm test` on every push/PR to `main`. Keep this fast (< 2 min).
- **collect-metrics.yml**: scheduled daily; restores cache, collects metrics, builds Pages, deploys. Does **not** commit to `main`.
- Always pin action versions to a full SHA or major-version tag.

## Auth

The CLI supports two auth modes, selected by environment variables:

| Mode | Variables required |
| ---- | ------------------ |
| PAT / OAuth | `GITHUB_TOKEN` |
| GitHub App | `APP_ID` + `APP_PRIVATE_KEY` |

The GitHub App mode is preferred for production (fine-grained permissions, higher rate limits). The installation ID is discovered automatically.
