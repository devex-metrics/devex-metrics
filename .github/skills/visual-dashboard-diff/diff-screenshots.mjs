#!/usr/bin/env node
/**
 * Compares two directories of dashboard screenshots and reports what changed
 * visually.
 *
 * Usage:
 *   node diff-screenshots.mjs --baseline <dir> --current <dir> [--out <dir>]
 *                             [--threshold <0-1>] [--noise-floor <pixels>]
 *
 * The pixel comparison runs inside Chromium rather than in Node: the browser
 * already decodes and re-encodes PNGs, so the whole thing needs no image
 * library and therefore adds no dependency to the project.
 *
 * Output is a set of diff images plus `report.json` / `report.md`. Posting
 * that report anywhere (a PR comment, a CI artifact) is deliberately somebody
 * else's job — this skill only decides *what changed visually*.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, parseNumberOption, readConfig, THEMES } from "./lib/args.mjs";
import { loadChromium } from "./lib/browser.mjs";
import { diffImagesInPage } from "./lib/image-diff.mjs";
import { renderMarkdownReport } from "./lib/report.mjs";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Screenshot filenames are `<view>.<theme>.png`, or `<view>--<state>.<theme>.png`
 * for a view rendered in one of its declared states.
 */
function parseShotName(fileName) {
  const match = new RegExp(`^(.+?)(?:--(.+))?\\.(${THEMES.join("|")})\\.png$`).exec(fileName);
  return match ? { view: match[1], state: match[2] || null, theme: match[3] } : null;
}

function listShots(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const shots = new Map();
  for (const fileName of fs.readdirSync(dir)) {
    const parsed = parseShotName(fileName);
    if (parsed) shots.set(fileName, { ...parsed, fileName, filePath: path.join(dir, fileName) });
  }
  return shots;
}

/** `dashboard` for the initial render, `dashboard--all-time` for a state. */
function label({ view, state }) {
  return state ? `${view}--${state}` : view;
}

function pick({ view, state, theme }) {
  return { view, state, theme };
}

export async function diffScreenshots({ baselineDir, currentDir, outDir, threshold, overrideFloor, log = console.log }) {
  // Chart.js draws to <canvas>, and canvas output can differ by a handful of
  // anti-aliased pixels between otherwise identical runs. That tolerance is
  // declared per view (and per state) in views.config.json rather than
  // globally, so a blanket floor cannot hide a small real change elsewhere.
  const noiseFloors = new Map();
  for (const v of readConfig(SKILL_DIR).views) {
    noiseFloors.set(v.id, v.noiseFloorPixels || 0);
    for (const state of v.states || []) {
      noiseFloors.set(`${v.id}--${state.id}`, state.noiseFloorPixels ?? v.noiseFloorPixels ?? 0);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const baseline = listShots(baselineDir);
  const current = listShots(currentDir);
  const allNames = [...new Set([...baseline.keys(), ...current.keys()])].sort();
  if (allNames.length === 0) {
    throw new Error(`No screenshots found in ${baselineDir} or ${currentDir}.`);
  }

  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const comparisons = [];
  try {
    for (const name of allNames) {
      const before = baseline.get(name);
      const after = current.get(name);
      const meta = before || after;

      if (!before) {
        comparisons.push({ ...pick(meta), status: "added", current: name });
        log(`🆕 ${label(meta)} (${meta.theme}) — new screenshot`);
        continue;
      }
      if (!after) {
        comparisons.push({ ...pick(meta), status: "removed", baseline: name });
        log(`🗑️  ${label(meta)} (${meta.theme}) — no longer rendered`);
        continue;
      }

      const diffPath = path.join(outDir, `${label(meta)}.${meta.theme}.diff.png`);
      const result = await diffImagesInPage(page, before.filePath, after.filePath, diffPath, threshold);
      const noiseFloor = overrideFloor ?? noiseFloors.get(label(meta)) ?? noiseFloors.get(meta.view) ?? 0;
      const status = result.changedPixels > noiseFloor ? "changed" : "unchanged";
      comparisons.push({
        ...pick(meta),
        status,
        baseline: name,
        current: name,
        ...result,
        noiseFloor,
        diff: status === "changed" ? path.basename(diffPath) : undefined,
      });

      if (status === "unchanged") {
        fs.rmSync(diffPath, { force: true });
        const noise =
          result.changedPixels > 0 ? ` (${result.changedPixels}px within the ${noiseFloor}px canvas tolerance)` : "";
        log(`⚪ ${label(meta)} (${meta.theme}) — identical${noise}`);
      } else {
        const sizeNote = result.resized ? `, size ${result.baselineSize} → ${result.currentSize}` : "";
        log(`🎨 ${label(meta)} (${meta.theme}) — ${result.changedPercent.toFixed(2)}% of pixels differ${sizeNote}`);
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baselineDir,
    currentDir,
    threshold,
    summary: {
      changed: comparisons.filter((c) => c.status === "changed").length,
      unchanged: comparisons.filter((c) => c.status === "unchanged").length,
      added: comparisons.filter((c) => c.status === "added").length,
      removed: comparisons.filter((c) => c.status === "removed").length,
    },
    comparisons,
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "report.md"), renderMarkdownReport(report));

  const { changed, added, removed, unchanged } = report.summary;
  log(`\n${changed} changed, ${added} added, ${removed} removed, ${unchanged} unchanged`);
  log(`Report → ${path.join(outDir, "report.md")}`);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.baseline !== "string" || typeof args.current !== "string") {
    console.error(
      "Usage: node diff-screenshots.mjs --baseline <dir> --current <dir> [--out <dir>] [--threshold <0-1>] [--noise-floor <pixels>]"
    );
    process.exit(1);
  }
  const currentDir = path.resolve(args.current);
  await diffScreenshots({
    baselineDir: path.resolve(args.baseline),
    currentDir,
    outDir: path.resolve(typeof args.out === "string" ? args.out : path.join(path.dirname(currentDir), "diff")),
    // Per-channel tolerance, 0–1. Anti-aliasing and sub-pixel text rendering
    // move a channel by a hair between otherwise identical runs; 0.02 (~5/255)
    // absorbs that without hiding a real colour or layout change.
    threshold: parseNumberOption(args.threshold, "threshold", { fallback: 0.02, min: 0, max: 1 }),
    overrideFloor: parseNumberOption(args["noise-floor"], "noise-floor", {
      fallback: undefined,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    }),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
