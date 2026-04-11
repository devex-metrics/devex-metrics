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
  collect.ts            # Core collection orchestrator (cache-aware, calls all collectors)
  types.ts              # All shared TypeScript interfaces (source of truth)
  github-client.ts      # Octokit singleton (token or GitHub App auth)
  link-header.ts        # GitHub Link header pagination helper
  cache.ts              # JSON file-based daily cache in data/
  report.ts             # Markdown report generator
  save-fixture.ts       # CLI utility: save current API response as a test fixture
  collectors/
    index.ts            # Re-exports all collectors
    repos.ts            # List repositories
    issues.ts           # Issue open/closed counts
    pull-requests.ts    # PR counts + detailed PR metrics
    contributors.ts     # Committer & reviewer counts (last 90 days)
    dependents.ts       # Dependent repository count
    trends.ts           # Weekly activity trend aggregation
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
5. Wire up the collector in `src/collect.ts`, surface the data in `src/report.ts` and `src/build-pages.ts`.
6. **If the new field is required for correct behaviour** (e.g. the chart filter depends on it), bump `CURRENT_SCHEMA_VERSION` in `src/cache.ts` and add a line to the version history comment there. This invalidates all cached/fixture data that pre-dates the change and forces a fresh collection on the next run.
7. Write tests using vitest (see Testing section below for patterns).

## Cache schema versioning

`CURRENT_SCHEMA_VERSION` is exported from `src/cache.ts`. It is stored in every `OrgMetrics` object produced by `collect.ts`. When data is loaded from disk (`loadCache`, `loadRawCache`, `loadFixture`), the stored version is compared to the constant; a mismatch causes the loader to return `null` so the caller falls back to a fresh API collection.

**When to bump the version:** any time a new field is added to `OrgMetrics` (or a nested type) that the dashboard or report rely on and that would be absent in data collected with an older build. Increment by 1, update the version-history comment in `cache.ts`, and update `makeSampleMetrics()` in `cache.test.ts` if needed.

**Do not** bump the version for purely additive optional fields where the absence can be handled gracefully with a fallback.

## Testing

- All test files live alongside the source file they test: `src/foo.test.ts` tests `src/foo.ts`.
- Run tests with `npm test` (vitest, single run) or `npm run test:watch` (watch mode).
- Tests use vitest globals (`describe`, `it`, `expect`, `vi`) — no imports needed for those, though explicit imports are fine for clarity.
- **CI runs `npm test` on every PR and push to `main`** — all tests must pass before merging.

### Mock patterns

**API collectors** (`collectors/*.ts`) — inject a fake Octokit via `setOctokit` / `resetOctokit`:

```ts
import { setOctokit, resetOctokit } from "../github-client.js";

afterEach(() => resetOctokit());

it("counts correctly", async () => {
  setOctokit({ rest: { ... }, paginate: { ... } } as unknown as Octokit);
  const result = await collectFoo("owner", "repo");
  expect(result).toEqual(...);
});
```

For collectors that use `paginate.iterator`, create an async generator and attach it:

```ts
async function* fakeIterator() { yield { data: [...] }; }
const paginateFn = Object.assign(vi.fn(), { iterator: fakeIterator });
```

**Orchestrators** (`collect.ts`) — use `vi.mock` to replace the cache and collector modules:

```ts
vi.mock("./cache.js", () => ({ loadCache: vi.fn(), saveCache: vi.fn(), ... }));
vi.mock("./collectors/index.js", () => ({ collectRepos: vi.fn(), ... }));
// imports below receive the mocked versions
import { collect } from "./collect.js";
```

**Pure functions** (`report.ts`, `link-header.ts`) — call directly; no mocking needed.

### What to test

- **Happy path**: verify the correct shape and values of the result.
- **Error paths**: 404 returns a zero/empty default; 403 returns a zero/empty default *and* calls `console.warn`; non-404/403 errors are re-thrown.
- **Partial failures**: in collectors with independent `try/catch` blocks (e.g. `contributors.ts`), verify that one path failing does not zero out the other.
- **Edge cases**: empty repos, pagination (multiple pages accumulate), deduplication, null fields with defined fallbacks.
- Avoid testing implementation details or mocking things that don't need it. Don't aim for 100% coverage — focus on behaviours that could regress.

## Mutation testing

Mutation testing is provided by [Stryker](https://stryker-mutator.io/) with the vitest runner.

- **Config**: `stryker.config.mjs` (ESM). Mutates all `src/**/*.ts` except test files, `types.ts`, `index.ts`, `save-fixture.ts`, and `build-pages.ts` (the last is excluded because its tests run via subprocess and Stryker cannot track coverage that way).
- **Run locally** (before creating a PR): `npm run mutation` — produces an HTML report at `reports/mutation/index.html` and a text summary in the terminal.
- **Run in CI mode**: `npm run mutation:ci` — outputs JSON + text (no HTML). The `mutation` job in `ci.yml` reads `reports/mutation/mutation.json` and posts a Markdown summary to the GitHub Actions step summary via `node scripts/mutation-summary.mjs >> $GITHUB_STEP_SUMMARY`.
- **Thresholds**: `high: 80`, `low: 60` for colour-coding only; `break: null` so the CI job never fails purely on score. Tighten `break` once you have a stable baseline.
- **Interpreting results**: a survived mutant means a code change was not caught by any test — it may indicate a test gap worth addressing. NoCoverage mutants mean no test exercises that line at all.
- **reports/** is gitignored — never commit Stryker output.

## GitHub Actions

- **ci.yml**: runs `npm ci`, `npm run build`, `npm test` on every push/PR to `main`. A second `mutation` job (depends on `test`) runs Stryker and posts a step summary; it runs on every PR but does not block merging on score.
- **collect-metrics.yml**: scheduled daily; restores cache, collects metrics, builds Pages, deploys. Does **not** commit to `main`.
- Always pin action versions to a full SHA or major-version tag.

## Auth

The CLI supports two auth modes, selected by environment variables:

| Mode | Variables required |
| ---- | ------------------ |
| PAT / OAuth | `GITHUB_TOKEN` |
| GitHub App | `APP_ID` + `APP_PRIVATE_KEY` |

The GitHub App mode is preferred for production (fine-grained permissions, higher rate limits). The installation ID is discovered automatically.
