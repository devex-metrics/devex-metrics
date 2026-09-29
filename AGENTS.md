# Copilot Instructions

## Project overview

**devex-metrics** collects Developer Experience metrics from the GitHub API for a GitHub organisation or user account and produces a Markdown report and an HTML dashboard deployed to GitHub Pages. It is built to be deployed at customer sites: everything site-specific is configured through GitHub Actions variables (see `docs/CONFIGURATION.md`), never by editing tracked files.

Nothing is committed to the default branch. Collected data is appended to an orphan `metrics-data` branch — a data store only, never built or served — and read back from there by the site build. `data/` remains a gitignored local scratch area.

## Tech stack

- **Language**: TypeScript (strict mode, ES2022 target, Node16 module resolution)
- **Runtime**: Node.js 22, ESM (`"type": "module"` in package.json). The version lives in `.nvmrc`; workflows read it via `node-version-file` — do not hard-code a version in a workflow.
- **GitHub API**: `@octokit/rest` + `@octokit/auth-app` + `@octokit/plugin-throttling`
- **Tests**: Vitest with globals enabled (`vitest.config.ts`)
- **Build**: `tsc` → `dist/`
- **CI**: GitHub Actions (`.github/workflows/ci.yml` runs build + test on every PR/push)

## Project structure

```
src/
  index.ts              # CLI entry point & orchestrator
  config.ts             # Deployment config: defaults < file < DEVEX_CONFIG < DEVEX_* vars
  build-pages.ts        # Generates static HTML for GitHub Pages
  build-multi-site.ts   # Local-only: builds a page per discovered dataset/group with a nav switcher
  collect.ts            # Core collection orchestrator (cache-aware, calls all collectors)
  collect-group.ts      # CLI: collect metrics for repos discovered from a local folder ("group")
  local-repo-discovery.ts # Scans a folder for local git repos and resolves their GitHub owner/repo
  dataset-key.ts        # Slugify a group name into a cache/site key
  history.ts            # Append-only rollup + PR event store
  stats.ts              # median / percentile / quantiles
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
data/                   # Local cache (gitignored); also holds local "group" datasets
.metrics-data/          # Checkout of the metrics-data branch (gitignored)
_site/                  # Generated GitHub Pages output (gitignored)
.github/workflows/
  ci.yml                # Build + test on PR / push to main
  collect-metrics.yml   # Scheduled data collection, then calls pages.yml
  pages.yml             # Reusable: build from metrics-data and deploy
  deploy-pages.yml      # Rebuild the site without re-collecting
```

## Configuration

Never hard-code an owner, repo list, team, trial or branding string. Everything site-specific is resolved by `loadConfig()` in `src/config.ts` and reaches the code as a `DevexConfig`. Adding a setting means: add the field and its JSDoc, give it a default in `defaultConfig()`, map a `DEVEX_*` variable in `applyEnv()`, document it in `docs/CONFIGURATION.md`, show it in `devex.config.example.json`, and pass it through in the workflow `env:` blocks.

Team membership and trial metadata are presentation concerns: `applyScope()` re-derives them at site-build time from the current configuration, so re-scoping a team or retitling a trial needs a Pages rebuild, not a re-collection.

## History store

`src/history.ts` writes three files per scope under the configured history dir:
`rollup.ndjson` (one line per repo per day, replaced when a day is re-run),
`events.ndjson` (one line per merged PR, appended once and never rewritten) and
`latest.json` (the newest full snapshot). Prefer adding a raw fact to the event
stream over adding a derived aggregate to the rollup — events can be recomputed
into new metrics later, aggregates cannot.

## Fixtures

Committed fixtures are opt-in: `loadCache` / `loadRawCache` only consult them when `DEVEX_USE_FIXTURE` is set. They are for local development and offline demos, never a data source in CI — a fixture has no date restriction, so an unnoticed stale one would let a run "succeed" while publishing numbers of unknown age.

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

- **Config**: `stryker.config.mjs` (ESM). Mutates all `src/**/*.ts` except test files, `types.ts`, `index.ts`, `save-fixture.ts`, `build-pages.ts`, `collect-group.ts`, and `build-multi-site.ts` (CLI entry points excluded because they're hard to unit test or are tested via subprocess, so Stryker cannot track coverage that way).
- **Run locally** (before creating a PR): `npm run mutation` — produces an HTML report at `reports/mutation/index.html` and a text summary in the terminal.
- **Run in CI mode**: `npm run mutation:ci` — outputs JSON + text (no HTML). The `mutation` job in `ci.yml` reads `reports/mutation/mutation.json` and posts a Markdown summary to the GitHub Actions step summary via `node scripts/mutation-summary.mjs >> $GITHUB_STEP_SUMMARY`.
- **Thresholds**: `high: 80`, `low: 60` for colour-coding; `break: 60` fails the run below 60% (baseline 61.87% measured 2026-09-27). Raise `break` as the score improves; never lower it to get a PR green.
- **vitest 5 runner shim**: `stryker.config.mjs` loads `scripts/stryker-vitest5-runner.mjs` instead of `@stryker-mutator/vitest-runner` directly. The upstream runner (10.0.0) filters each mutant run by space-joined test names, but vitest 5 matches `testNamePattern` against `fullTestName` (`"suite > test"`), so every test inside a `describe` was skipped and every mutant "survived" (score ~0%). The shim lets spaces in the pattern also match `" > "`. Delete it once the upstream runner is fixed. (The `Converting circular structure to JSON` error seen with `--logLevel debug` is an unrelated upstream debug-logging bug.)
- **Interpreting results**: a survived mutant means a code change was not caught by any test — it may indicate a test gap worth addressing. NoCoverage mutants mean no test exercises that line at all.
- **reports/** is gitignored — never commit Stryker output.

## Code coverage

- Coverage is collected with Vitest's built-in `@vitest/coverage-v8` provider, configured in `vitest.config.ts`.
- **Run locally**: `npm run coverage` — writes `coverage/cobertura-coverage.xml`, `coverage/coverage-summary.json`, and an HTML report to `coverage/` (gitignored).
- **Run in CI**: the `coverage` job in `ci.yml` runs `npm run coverage`, uploads `coverage/cobertura-coverage.xml` as a build artifact (`coverage-cobertura`), and posts a Markdown summary to the step summary via `node scripts/coverage-summary.mjs >> $GITHUB_STEP_SUMMARY`.
- Coverage is informational only (no enforced threshold) — same "don't chase 100%" philosophy as the Testing section above.

## GitHub Actions

- **ci.yml**: three jobs on every push/PR to `main` — `test` (build + `npm test` + `npm run lint`, combined into one job since each is fast enough that the checkout/setup/install overhead of a separate job outweighs any parallelism benefit), `coverage`, and `mutation` (`needs: test`; Stryker builds `dist` inside its own sandbox via `buildCommand`, since the sandbox copy respects `.gitignore` and never contains a build produced by an outer CI step). Mutation posts a step summary and fails the build when the score drops below `break` (see the Mutation testing section above). Each job caches `node_modules` (keyed on `package-lock.json`) via `actions/cache` and skips `npm ci` on a cache hit, so repeated installs across jobs don't each pay full install cost.
- **collect-metrics.yml**: scheduled daily; checks out `metrics-data`, collects metrics, appends to the history store, pushes it back, then calls `pages.yml`. Does **not** commit to `main`.
- **pages.yml**: reusable (`workflow_call`); builds the site from the `metrics-data` checkout and deploys to Pages.
- Always pin action versions to a full SHA or major-version tag.

## Addressing review feedback

Automated reviewers (Copilot code review and similar) re-review every push. Fixing only the exact line a comment points at invites the next round to flag the same mistake a few lines further on, which turns one finding into five review rounds, five CI runs and five sets of AI credits. Treat every finding as a possible **pattern**, not a one-off.

### Before changing anything

1. **Check what was reviewed.** Compare the commit the review ran on with the PR head. If newer commits exist (including a merge from `main`), check whether the finding still applies before acting on it. Don't fix what is already fixed.
2. **Collect all open findings first.** Read every unresolved comment from the latest review before touching code, so they can be fixed together in one push.

### For each finding

1. **Name the underlying rule.** Restate the finding as a general rule, e.g. "`loadCache` does not check the schema version" becomes "every loader that reads persisted data must check `CURRENT_SCHEMA_VERSION`". If a rule cannot be stated, it is probably a one-off.
2. **Sweep for other occurrences.** Search the whole codebase for the same shape (Grep for the API, the idiom or sibling functions/collectors/workflows), not just the file in the diff. Include code the PR did not touch when it is the same defect class, but keep unrelated clean-ups out of the PR; flag those separately instead.
3. **Fix the class, not the instance.** Fix every occurrence in the same commit. If the fix is shared logic, extract it rather than repeating the patch.
4. **Guard against regressions.** Where practical, add a test (or lint rule, or type) that fails for the whole class, so the reviewer and future changes cannot re-introduce it.
5. **Decide deliberately when you disagree.** If a finding is wrong or not worth the change, reply with the reason and resolve it rather than making a token change that will draw a follow-up comment.

### Pushing and replying

- **One push per review round.** Batch all fixes, run `npm run build`, `npm test` and `npm run lint` locally, then push once. Never push per comment.
- **Reply with the scope.** On each thread, say what the rule was and where else it was applied ("Fixed here and in `issues.ts`, `contributors.ts`; added a test covering all collectors"), so the reviewer and the human can see the pattern was closed.
- **Recognise a loop.** If a new round raises a finding that is a variation of an earlier one, the earlier sweep was too narrow: widen it and say so. After three review rounds on the same PR, or when findings are becoming nitpicks, stop pushing and summarise the remaining open findings for a human to decide on.

## Auth

The CLI supports two auth modes, selected by environment variables:

| Mode | Variables required |
| ---- | ------------------ |
| PAT / OAuth | `GITHUB_TOKEN` |
| GitHub App | `APP_ID` + `APP_PRIVATE_KEY` |

The GitHub App mode is preferred for production (fine-grained permissions, higher rate limits). The installation ID is discovered automatically.
