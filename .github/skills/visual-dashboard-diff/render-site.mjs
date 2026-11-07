#!/usr/bin/env node
/**
 * Renders the generated dashboard headlessly and screenshots it.
 *
 * Usage:
 *   node render-site.mjs --out <dir> [--tree <repo root>] [--theme light|dark|both]
 *                        [--view <id,...>] [--config <registry.json>] [--allow-missing]
 *                        [--skip-compile]
 *
 * For every view in `views.config.json` the site is built from the view's
 * committed fixture (see lib/site.mjs), loaded from a `file://` URL in
 * headless Chromium through Playwright, and screenshotted in its initial
 * render and in every declared state. Nothing about the dashboard is
 * re-implemented: the real `build-pages.js` output is what gets rendered.
 *
 * Determinism: locale en-US, timezone UTC, a frozen clock (`FROZEN_NOW`, an
 * hour after the fixture's `collectedAt`), animations and transitions off,
 * Chart.js animations off, carets hidden, fonts settled, and only the two
 * pinned jsDelivr script URLs the dashboard loads allowed through.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseArgs, parseThemes, readConfig, selectViews } from "./lib/args.mjs";
import { loadChromium, restrictNetwork } from "./lib/browser.mjs";
import { buildSite, compileTree, resolveInside } from "./lib/site.mjs";
import { applySteps, isShowing } from "./lib/steps.mjs";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..", "..");

/**
 * The fixtures' shared "now". The dashboard reads `new Date()` for relative
 * labels and the period cut-offs, so an unfrozen clock would make every
 * screenshot diff against itself across a minute boundary. It lives in the
 * harness rather than the registry because the baseline render uses the base
 * commit's registry, and both sides must see the same time.
 */
export const FROZEN_NOW = "2026-08-09T08:00:00.000Z";

/** The only remote resources the page may fetch: the pinned chart libraries. */
const ALLOWED_URL_PREFIXES = [
  "https://cdn.jsdelivr.net/npm/chart.js@",
  "https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@",
];

const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_SETTLE_MS = 800;
const MAX_PAGE_HEIGHT = 16000;

/**
 * Runs before any page script. Chart.js assigns `window.Chart` when its
 * bundle loads; intercepting that assignment turns its animations off before
 * the dashboard creates a single chart, so a screenshot never catches a bar
 * mid-growth.
 */
const DISABLE_CHART_ANIMATION = () => {
  let chart;
  Object.defineProperty(window, "Chart", {
    configurable: true,
    enumerable: true,
    get() {
      return chart;
    },
    set(value) {
      chart = value;
      try {
        value.defaults.animation = false;
        value.defaults.animations = { colors: false, x: false, y: false };
        value.defaults.transitions.active.animation.duration = 0;
        value.defaults.transitions.resize.animation.duration = 0;
      } catch {
        // An unexpected Chart.js shape just keeps its defaults.
      }
    },
  });
};

const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

/** `dashboard` for the initial render, `dashboard--all-time` for a state. */
function targetLabel(viewId, stateId) {
  return stateId ? `${viewId}--${stateId}` : viewId;
}

/** Every (view, state) pair to screenshot, in registry order. */
function renderTargets(views) {
  const targets = [];
  for (const view of views) {
    targets.push({ view, state: null });
    for (const state of view.states || []) targets.push({ view, state });
  }
  return targets;
}

async function renderOne(browser, { view, state, theme, htmlPath, outDir, defaults, allowMissing }) {
  const label = targetLabel(view.id, state?.id);
  const fileName = `${label}.${theme}.png`;
  const context = await browser.newContext({
    colorScheme: theme,
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: defaults.viewportWidth || DEFAULT_VIEWPORT_WIDTH, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const consoleErrors = [];
  try {
    await restrictNetwork(context, ALLOWED_URL_PREFIXES);
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().split("\n")[0]);
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err.message || err).split("\n")[0]));
    await page.clock.setFixedTime(new Date(FROZEN_NOW));
    await page.addInitScript(DISABLE_CHART_ANIMATION);

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);

    if (!(await isShowing(page, view.expect))) {
      const currentOnly = view.currentOnly === true;
      if (currentOnly && allowMissing) {
        return { label, theme, status: "skipped", reason: `view expects ${view.expect}, which is not showing` };
      }
      return { label, theme, status: "error", reason: `view expects ${view.expect}, which is not showing` };
    }

    if (state) {
      const applied = await applySteps(page, state.steps);
      const currentOnly = state.currentOnly === true || view.currentOnly === true;
      if (!applied.ok) {
        const reason = `${applied.step}: ${applied.reason}`;
        return { label, theme, status: currentOnly && allowMissing ? "skipped" : "error", reason };
      }
      if (!(await isShowing(page, state.expect))) {
        const reason = `state expects ${state.expect}, which is not showing after its steps`;
        return { label, theme, status: currentOnly && allowMissing ? "skipped" : "error", reason };
      }
    }

    await page.waitForTimeout(state?.settleMs ?? view.settleMs ?? defaults.settleMs ?? DEFAULT_SETTLE_MS);

    // Grow the viewport to the page's full height *before* the screenshot:
    // the capture-time resize a full-page screenshot performs makes every
    // responsive <canvas> redraw mid-capture.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({
      width: defaults.viewportWidth || DEFAULT_VIEWPORT_WIDTH,
      height: Math.min(Math.max(height, 600), MAX_PAGE_HEIGHT),
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, fileName), fullPage: true, animations: "disabled" });

    return {
      label,
      theme,
      status: consoleErrors.length > 0 ? "warn" : "ok",
      file: fileName,
      consoleErrors,
    };
  } finally {
    await context.close();
  }
}

/**
 * Renders every selected view and state in every theme into `outDir`.
 *
 * @returns {Promise<{ results: object[], errors: number }>}
 */
export async function renderSite({
  tree = REPO_ROOT,
  outDir,
  themes = ["light"],
  viewFilter,
  configPath,
  allowMissing = false,
  skipCompile = false,
  log = console.log,
}) {
  const registry = readConfig(SKILL_DIR, configPath);
  const views = selectViews(registry, viewFilter);
  if (views.length === 0) throw new Error("No views selected; check --view against views.config.json");
  fs.mkdirSync(outDir, { recursive: true });

  if (!skipCompile) {
    log(`Compiling ${tree} …`);
    compileTree(tree);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "devex-visual-render-"));
  const results = [];
  try {
    const pages = new Map();
    for (const view of views) {
      // A registry `baselineRegistry` wrote may point a view at the base
      // commit's fixtures; the committed registry always uses the skill's own.
      const fixtureDir = view.fixtureDir || path.join(SKILL_DIR, "fixtures");
      const fixturePath = resolveInside(fixtureDir, view.fixture, `view "${view.id}" fixture`);
      const configFile = resolveInside(fixtureDir, view.config, `view "${view.id}" config`);
      log(`Building site for view "${view.id}" from ${path.relative(REPO_ROOT, fixturePath) || fixturePath} …`);
      const viewWork = path.join(workDir, view.id);
      fs.mkdirSync(viewWork, { recursive: true });
      pages.set(view.id, buildSite({ tree, viewId: view.id, fixturePath, configPath: configFile, workDir: viewWork }));
    }

    const chromium = loadChromium();
    const browser = await chromium.launch();
    try {
      for (const theme of themes) {
        for (const { view, state } of renderTargets(views)) {
          const result = await renderOne(browser, {
            view,
            state,
            theme,
            htmlPath: pages.get(view.id),
            outDir,
            defaults: registry.defaults || {},
            allowMissing,
          });
          results.push(result);
          const icon = { ok: "✅", warn: "⚠️", skipped: "⏭️", error: "❌" }[result.status];
          const note =
            result.status === "ok"
              ? ""
              : result.status === "warn"
                ? ` — console errors: ${result.consoleErrors.join("; ")}`
                : ` — ${result.reason}`;
          log(`${icon} ${result.label} (${theme})${note}`);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(outDir, "render.json"),
    JSON.stringify({ frozenNow: FROZEN_NOW, tree, themes, results }, null, 2) + "\n"
  );
  return { results, errors: results.filter((r) => r.status === "error").length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out || args.out === true) {
    console.error("Usage: node render-site.mjs --out <dir> [--tree <dir>] [--theme light|dark|both] [--view <ids>] [--config <file>] [--allow-missing] [--skip-compile]");
    process.exit(1);
  }
  const { errors } = await renderSite({
    tree: typeof args.tree === "string" ? path.resolve(args.tree) : REPO_ROOT,
    outDir: path.resolve(args.out),
    themes: parseThemes(args.theme),
    viewFilter: typeof args.view === "string" ? args.view : undefined,
    configPath: typeof args.config === "string" ? path.resolve(args.config) : undefined,
    allowMissing: args["allow-missing"] === true,
    skipCompile: args["skip-compile"] === true,
  });
  if (errors > 0) {
    console.error(`\n${errors} render(s) failed.`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
