---
name: visual-dashboard-diff
description: Render the generated GitHub Pages dashboard headlessly and detect what changed visually, producing before/after/diff screenshots for review. Use when a change touches the dashboard (src/pages/**, src/build-pages.ts, anything the site build reads) and you want to see and show what it looks like, or to check that a refactor changed nothing visually.
---

# Visual Dashboard Diff Skill

Renders the dashboard **headlessly**, screenshots it, and reports which
screenshots changed compared to a baseline commit.

The screenshots are the deliverable. **Posting them anywhere — a PR comment, a
job summary, an artifact upload — is deliberately not part of this skill.** It
answers exactly one question: *what changed visually, and what does it look
like?* Whoever wants to publish that answer reads `report.md` and the PNGs.

The publisher for pull requests is the `ui-checks` job in
`.github/workflows/ci.yml`: it runs this diff against the PR's merge base and
uploads the images; `.github/workflows/ui-checks-comment.yml` then posts the
before/after/diff images as one comment on the PR (replaced on every push)
through `gh pr comment --attach`, rendered by
`.github/workflows/scripts/visual-diff-comment.mjs`. An agent opening a
dashboard PR does not have to attach screenshots by hand — it has to make sure
the change is *visible* to this harness (see "States" below) and say in the PR
body which screenshots it expects to change.

## When to use it

- A change touches `src/pages/**` (the dashboard HTML, styles and scripts),
  `src/build-pages.ts`, `src/report.ts`, or a type or config field the site
  build reads.
- A refactor is supposed to be visually neutral and you want proof.
- You want before/after images of a UI change for a human to look at.

## How it works

The dashboard is a single static HTML page that `dist/build-pages.js` writes
to `_site/index.html`. The harness builds it exactly the way CI does — `tsc`,
then `build-pages.js` — but from a committed fixture placed where the build
looks first (the history store's `latest.json`, in a temporary directory), with
the skill's own `fixtures/dashboard.config.json` named explicitly so a developer's
local config never leaks into a screenshot. The page is then loaded from a
`file://` URL in headless Chromium through Playwright and screenshotted.

Nothing about the page is re-implemented, which is what makes the screenshots
trustworthy: if the site build changes, the screenshot changes with it.

The build writes `_site/` in the tree it runs in; for the working tree that is
the repo's own `_site/` (gitignored, rebuilt by `npm run serve:local`).

## Usage

Everything runs from the repo root after `npm ci`.

### Compare against the baseline commit (the usual case)

```bash
node .github/skills/visual-dashboard-diff/visual-diff.mjs
```

This checks out the merge base with `origin/main` into a temporary
`git worktree`, links `node_modules` into it, compiles and renders both trees,
and compares. Your checkout is never touched — no stashing, no branch switching.
The run ends by printing how long each phase took and writes the same table to
`visual-output/timings.md`, which CI appends to the job summary.

```bash
# Compare against something else, or render both colour schemes
node .github/skills/visual-dashboard-diff/visual-diff.mjs --base origin/main --theme both
node .github/skills/visual-dashboard-diff/visual-diff.mjs --view dashboard
```

Output lands in `visual-output/` (git-ignored):

```
visual-output/
├── baseline/   <view>.<theme>.png     — before
├── current/    <view>.<theme>.png     — after
├── diff/       <view>.<theme>.diff.png, report.md, report.json
└── timings.md  — how long each phase took
```

Themes: `light` (default) and `dark`; `both` renders the pair. Each theme
emulates `prefers-color-scheme`, which is what the dashboard's stylesheet keys
its dark palette on. CI renders both.

A view rendered in one of its declared states is named
`<view>--<state>.<theme>.png`, e.g. `dashboard--all-time.light.png`.

### Just screenshot the current state

```bash
node .github/skills/visual-dashboard-diff/render-site.mjs --out visual-output/current --theme both
```

### Compare two directories you already have

```bash
node .github/skills/visual-dashboard-diff/diff-screenshots.mjs \
  --baseline visual-output/baseline --current visual-output/current --out visual-output/diff
```

## Reading the result

`diff/report.md` is a Markdown summary — a table of every screenshot with its
status (changed / unchanged / added / removed), how many pixels moved, and the
image size. `report.json` is the same data for scripting.

Diff images paint changed pixels magenta over a dimmed copy of the new
screenshot, so a change is easy to locate in context.

**A changed screenshot is not automatically a problem.** Read the diff image
and decide: intended restyle, or accidental regression? The tool reports; you
judge.

## Requirements

- **Playwright with Chromium.** Intentionally *not* a dependency of
  devex-metrics — this is developer/CI tooling, not shipped code.
  `lib/browser.mjs` finds a local or global install, or the pinned one CI uses
  under `.github/workflows/dependencies/playwright`; if none exists:
  `npm install -g playwright && npx playwright install chromium`.
- **`node_modules`** in the repo (`npm ci`) — the baseline worktree links it
  rather than running a second install.
- **Network access to jsDelivr** for the two pinned Chart.js scripts the
  dashboard loads. Every other request is blocked.

## Fixtures

The dashboard renders from `fixtures/dashboard.json`, an `OrgMetrics` snapshot
(ten active repositories trimmed from the committed `data/rajbos.fixture.json`,
with a fixed `collectedAt`). The harness stamps it with the tree's own
`CURRENT_SCHEMA_VERSION` before the build, so a schema bump in a branch does
not break the diff: each side builds from the fixture at *its own* version,
and a field a newer schema introduced is simply absent, as in any older
snapshot. When a new field matters visually, add it to the fixture in the same
PR so the "after" screenshot shows it.

Every value in the fixture is fixed. A `Date.now()` anywhere in the data would
make the dashboard diff against itself.

### States — filters and toggles

The dashboard is screenshotted in its **initial render** (Last 30 Days) and in
every **state** declared in `views.config.json`. A state is a few click/select
steps replayed on a fresh page before the screenshot:

```json
{
  "id": "all-time",
  "title": "All Time period",
  "steps": [{ "click": ".filter-btn[data-period=\"all\"]" }],
  "expect": ".filter-btn[data-period=\"all\"].active"
}
```

- `steps` use `click` / `select` (+ optional `value`) / `type` (+ `text`) /
  `press`.
- `expect` (required) is what the state must be showing afterwards. If it is
  not, the render is an **error**, not a screenshot of the previous state that
  would pass as "unchanged" forever; a state without it is refused when the
  registry loads.
- `settleMs` overrides the wait after the steps.
- `noiseFloorPixels` gives a state its own tolerance (see Determinism).

**Adding a control that reveals new content means adding a state for it
here**, or the visual diff will never see what you built.

The baseline is rendered from the **base commit's own** `views.config.json`
and fixtures, plus every view and state only the current registry declares. A
state this branch introduced is attempted on the old tree and, where it
cannot render there, skipped and reported as **added**; a state this branch
removed still renders on the baseline side and is reported as **removed**.

## Determinism

Two runs of unchanged code produce identical screenshots. That is load-bearing
— without it every run reports spurious changes. It is achieved by pinning the
locale to `en-US` and the timezone to UTC, freezing the page clock
(`FROZEN_NOW` in `render-site.mjs`, an hour after the fixture's
`collectedAt`), turning Chart.js animations off before the first chart is
created, disabling CSS animations and transitions, hiding carets, waiting for
fonts to settle, and keeping all time-dependent values out of the fixture.

The viewport is grown to the page's full height *before* the screenshot rather
than letting the full-page capture do it: that capture-time resize makes every
responsive `<canvas>` redraw mid-capture.

Chart.js draws to `<canvas>`, which can differ by a handful of anti-aliased
pixels between runs on some machines, so the `dashboard` view carries a
`noiseFloorPixels` tolerance in `views.config.json`. On the machines this was
measured on the noise was zero.

## Limits

- **Only declared states are covered.** Hover, the repo picker dropdown, the
  share button and click sequences beyond the listed states are out of scope.
- **The fixture is one dataset.** Panels that only appear with a team scope, a
  trial, CI health or the landscape feature are not rendered unless the
  fixture and `fixtures/dashboard.config.json` enable them.
- **Not a substitute for looking at the deployed site**, which renders the
  real data with whatever branding the deployment configures.
