#!/usr/bin/env node
/**
 * Renders the dashboard at the merge base and in the working tree, then
 * reports what changed visually.
 *
 * Usage:
 *   node .github/skills/visual-dashboard-diff/visual-diff.mjs
 *     [--base origin/main] [--theme light|dark|both] [--view <ids>]
 *     [--out visual-output] [--threshold <0-1>]
 *
 * The base commit is checked out into a temporary detached `git worktree`
 * (your checkout is never touched — no stashing, no branch switching), its
 * node_modules linked to this checkout's, and both trees are compiled and
 * rendered with `render-site.mjs`. The baseline uses the base commit's own
 * registry and fixtures (see `baselineRegistry` in lib/args.mjs), so an old
 * site is always driven the way its own registry drove it.
 *
 * Output: `<out>/baseline/`, `<out>/current/`, `<out>/diff/` (diff images,
 * report.md, report.json) and `<out>/timings.md`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { baselineRegistry, parseArgs, parseNumberOption, parseThemes, readConfig } from "./lib/args.mjs";
import { diffScreenshots } from "./diff-screenshots.mjs";
import { renderSite } from "./render-site.mjs";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..", "..");
const SKILL_RELATIVE = path.relative(REPO_ROOT, SKILL_DIR);

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

/** A git ref from the command line: never empty, never an option in disguise. */
function checkRef(ref) {
  if (typeof ref !== "string" || ref.trim() === "" || ref.startsWith("-")) {
    throw new Error(`--base must name a git ref, got ${JSON.stringify(ref)}`);
  }
  return ref;
}

function mergeBaseWith(ref) {
  try {
    return git(["merge-base", "HEAD", ref]);
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    throw new Error(`Could not find the merge base of HEAD and ${ref} (${detail}). Fetch it first: git fetch origin main`);
  }
}

/** Links this checkout's node_modules into the worktree instead of a second install. */
function linkNodeModules(worktree) {
  const source = path.join(REPO_ROOT, "node_modules");
  if (!fs.existsSync(source)) throw new Error(`${source} is missing — run npm ci first`);
  fs.symlinkSync(source, path.join(worktree, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}

/**
 * The registry to render the base commit with: the base commit's own, with
 * the current registry's additions flagged so they can be skipped there.
 */
function writeBaselineRegistry(worktree, outDir) {
  const current = readConfig(SKILL_DIR);
  const baseSkillDir = path.join(worktree, SKILL_RELATIVE);
  const baseConfig = path.join(baseSkillDir, "views.config.json");
  let base = null;
  if (fs.existsSync(baseConfig)) {
    try {
      base = JSON.parse(fs.readFileSync(baseConfig, "utf8"));
    } catch {
      base = null;
    }
  }
  const registry = baselineRegistry(current, base, {
    baseFixtureDir: path.join(baseSkillDir, "fixtures"),
    currentFixtureDir: path.join(SKILL_DIR, "fixtures"),
  });
  const file = path.join(outDir, "baseline-registry.json");
  fs.writeFileSync(file, JSON.stringify(registry, null, 2));
  return file;
}

function formatMs(ms) {
  return ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = checkRef(args.base === undefined ? "origin/main" : args.base);
  const themes = parseThemes(args.theme);
  const outDir = path.resolve(typeof args.out === "string" ? args.out : path.join(REPO_ROOT, "visual-output"));
  const threshold = parseNumberOption(args.threshold, "threshold", { fallback: 0.02, min: 0, max: 1 });
  const viewFilter = typeof args.view === "string" ? args.view : undefined;

  const mergeBase = mergeBaseWith(baseRef);
  console.log(`Baseline: ${mergeBase.slice(0, 12)} (merge base of HEAD and ${baseRef})`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const timings = [];
  const timed = async (name, fn) => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      timings.push([name, Date.now() - started]);
    }
  };

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "devex-visual-base-"));
  let worktreeAdded = false;
  try {
    await timed("checkout base", async () => {
      // mkdtemp created the directory; git wants to create it itself.
      fs.rmSync(worktree, { recursive: true, force: true });
      git(["worktree", "add", "--detach", worktree, mergeBase]);
      worktreeAdded = true;
      linkNodeModules(worktree);
    });

    const registryFile = writeBaselineRegistry(worktree, outDir);
    const baseline = await timed("render baseline", () =>
      renderSite({
        tree: worktree,
        outDir: path.join(outDir, "baseline"),
        themes,
        viewFilter,
        configPath: registryFile,
        allowMissing: true,
        log: (line) => console.log(`[baseline] ${line}`),
      })
    );
    const current = await timed("render current", () =>
      renderSite({
        tree: REPO_ROOT,
        outDir: path.join(outDir, "current"),
        themes,
        viewFilter,
        log: (line) => console.log(`[current] ${line}`),
      })
    );
    if (baseline.errors > 0 || current.errors > 0) {
      throw new Error(`${baseline.errors + current.errors} render(s) failed; see the lines above.`);
    }

    await timed("compare", () =>
      diffScreenshots({
        baselineDir: path.join(outDir, "baseline"),
        currentDir: path.join(outDir, "current"),
        outDir: path.join(outDir, "diff"),
        threshold,
      })
    );
  } finally {
    if (worktreeAdded) {
      try {
        git(["worktree", "remove", "--force", worktree]);
      } catch (error) {
        console.warn(`Could not remove the baseline worktree at ${worktree}: ${String(error.message).split("\n")[0]}`);
      }
    }
    fs.rmSync(worktree, { recursive: true, force: true });
    const table = ["| Phase | Took |", "| --- | --- |", ...timings.map(([n, ms]) => `| ${n} | ${formatMs(ms)} |`)];
    fs.writeFileSync(path.join(outDir, "timings.md"), `### Visual diff timings\n\n${table.join("\n")}\n`);
    console.log(`\n${table.join("\n")}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
