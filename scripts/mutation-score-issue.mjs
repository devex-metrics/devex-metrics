#!/usr/bin/env node
/**
 * Reads the Stryker JSON mutation report and, when the mutation score is below
 * the `break` threshold in stryker.config.mjs, opens a GitHub issue that lists
 * the files and functions whose mutants were not detected by any test.
 *
 * Used by .github/workflows/mutation.yml, which only runs this when no issue
 * with ISSUE_LABEL is already open.
 *
 *   node scripts/mutation-score-issue.mjs            # create the issue if needed
 *   node scripts/mutation-score-issue.mjs --dry-run  # print the issue body instead
 *
 * Exit codes: 0 score is at or above the threshold, 1 score is below it (issue
 * created) or the report is missing/unreadable.
 *
 * Requires GH_TOKEN (and GITHUB_REPOSITORY outside a checkout) for the `gh` CLI.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const REPORT_PATH = "reports/mutation/mutation.json";
const ISSUE_LABEL = process.env.ISSUE_LABEL || "mutation-improvement";
const MAX_FILES = 15;
const MAX_FUNCTIONS_PER_FILE = 10;
const MAX_MUTANTS_PER_FUNCTION = 8;
// GitHub rejects issue bodies over 65 536 characters.
const MAX_BODY_LENGTH = 60_000;

const dryRun = process.argv.includes("--dry-run");

// ── Load report and threshold ─────────────────────────────────────────────────

if (!existsSync(REPORT_PATH)) {
  console.error(`❌ Mutation report not found at ${REPORT_PATH}. Did the mutation run fail?`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch (err) {
  console.error(`❌ Failed to parse mutation report: ${err.message}`);
  process.exit(1);
}

const strykerConfig = (await import(pathToFileURL(resolve("stryker.config.mjs")).href)).default;
const breakThreshold = strykerConfig.thresholds?.break;
if (typeof breakThreshold !== "number") {
  console.error("❌ stryker.config.mjs has no numeric thresholds.break — nothing to compare against.");
  process.exit(1);
}

// ── Tally, grouped by file and enclosing function ─────────────────────────────

/**
 * @typedef {{ line: number, status: string, mutator: string, replacement: string }} Gap
 * @typedef {{ name: string, startLine: number, gaps: Gap[] }} FunctionGaps
 * @typedef {{ file: string, detected: number, valid: number, functions: Map<string, FunctionGaps> }} FileStats
 */

let detected = 0;
let survived = 0;
let noCoverage = 0;
/** @type {FileStats[]} */
const files = [];

for (const [filePath, file] of Object.entries(report.files ?? {})) {
  const shortFile = filePath.replace(/\\/g, "/").replace(/^.*?\/?(src\/)/, "$1");
  /** @type {FileStats} */
  const stats = { file: shortFile, detected: 0, valid: 0, functions: new Map() };
  const sourceFile = file.source
    ? ts.createSourceFile(shortFile, file.source, ts.ScriptTarget.Latest, true)
    : null;

  for (const mutant of file.mutants ?? []) {
    const status = mutant.status;
    if (status === "Killed" || status === "Timeout") {
      detected++;
      stats.detected++;
      stats.valid++;
      continue;
    }
    if (status !== "Survived" && status !== "NoCoverage") continue; // Ignored / CompileError / RuntimeError don't count

    if (status === "Survived") survived++;
    else noCoverage++;
    stats.valid++;

    const start = mutant.location?.start ?? { line: 0, column: 1 };
    const fn = enclosingFunction(sourceFile, start.line, start.column);
    const key = `${fn.name}@${fn.startLine}`;
    if (!stats.functions.has(key)) stats.functions.set(key, { ...fn, gaps: [] });
    stats.functions.get(key).gaps.push({
      line: start.line,
      status,
      mutator: mutant.mutatorName ?? "",
      replacement: mutant.replacement ?? "",
    });
  }
  files.push(stats);
}

const valid = detected + survived + noCoverage;
const score = valid > 0 ? (detected / valid) * 100 : 100;
const scoreText = `${score.toFixed(2)}%`;

console.log(
  `Mutation score: ${scoreText} (break threshold ${breakThreshold}%) | ` +
    `Detected: ${detected} | Survived: ${survived} | No coverage: ${noCoverage}`
);

if (score >= breakThreshold) {
  console.log("✅ Mutation score is at or above the threshold. No issue needed.");
  process.exit(0);
}

// ── Build the issue body ──────────────────────────────────────────────────────

const undetected = (/** @type {FileStats} */ f) => f.valid - f.detected;
const weakFiles = files.filter((f) => undetected(f) > 0).sort((a, b) => undetected(b) - undetected(a));
const fileScore = (/** @type {FileStats} */ f) => (f.valid > 0 ? ((f.detected / f.valid) * 100).toFixed(1) : "100.0");

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
const runUrl =
  GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : null;

const lines = [
  `The daily mutation test run scored **${scoreText}**, below the \`break\` threshold of **${breakThreshold}%** set in \`stryker.config.mjs\`.`,
  "",
  "| Metric | Value |",
  "| ------ | ----- |",
  `| Mutation score | ${scoreText} |`,
  `| Break threshold | ${breakThreshold}% |`,
  `| Detected (killed + timeout) | ${detected} |`,
  `| ❌ Survived | ${survived} |`,
  `| 🔇 No coverage | ${noCoverage} |`,
  ...(GITHUB_SHA ? [`| Commit | ${GITHUB_SHA} |`] : []),
  ...(runUrl ? [`| Workflow run | ${runUrl} (full report in the \`mutation-report\` artifact) |`] : []),
  "",
  "**Survived** means a test executed the mutated code but no assertion failed — the test needs a sharper assertion. " +
    "**No coverage** means no test executes that code at all — a new test is needed.",
  "",
  "## Files with the most undetected mutants",
  "",
  "| File | Score | Survived | No coverage |",
  "| ---- | ----- | -------- | ----------- |",
];

for (const f of weakFiles) {
  const gaps = [...f.functions.values()].flatMap((fn) => fn.gaps);
  const s = gaps.filter((g) => g.status === "Survived").length;
  lines.push(`| \`${f.file}\` | ${fileScore(f)}% | ${s} | ${gaps.length - s} |`);
}
lines.push("", "## Functions that need tests", "");

const shownFiles = weakFiles.slice(0, MAX_FILES);
for (const f of shownFiles) {
  lines.push(`### \`${f.file}\` — ${fileScore(f)}%`, "");
  const fns = [...f.functions.values()].sort((a, b) => b.gaps.length - a.gaps.length);
  for (const fn of fns.slice(0, MAX_FUNCTIONS_PER_FILE)) {
    const s = fn.gaps.filter((g) => g.status === "Survived").length;
    const parts = [s > 0 ? `${s} survived` : "", fn.gaps.length - s > 0 ? `${fn.gaps.length - s} no coverage` : ""].filter(Boolean);
    lines.push("<details>");
    lines.push(`<summary><code>${escapeHtml(fn.name)}</code> (line ${fn.startLine}) — ${parts.join(", ")}</summary>`, "");
    lines.push("| Line | Status | Mutator | Replacement |", "| ---- | ------ | ------- | ----------- |");
    const gaps = [...fn.gaps].sort((a, b) => a.line - b.line);
    for (const g of gaps.slice(0, MAX_MUTANTS_PER_FUNCTION)) {
      lines.push(`| ${g.line} | ${g.status} | ${g.mutator} | ${codeCell(g.replacement)} |`);
    }
    if (gaps.length > MAX_MUTANTS_PER_FUNCTION) {
      lines.push("", `_…and ${gaps.length - MAX_MUTANTS_PER_FUNCTION} more in this function._`);
    }
    lines.push("", "</details>");
  }
  if (fns.length > MAX_FUNCTIONS_PER_FILE) {
    lines.push("", `_…and ${fns.length - MAX_FUNCTIONS_PER_FILE} more function(s) in this file._`);
  }
  lines.push("");
}
if (weakFiles.length > shownFiles.length) {
  lines.push(`_…and ${weakFiles.length - shownFiles.length} more file(s); see the full report._`, "");
}

lines.push(
  "## How to work on this",
  "",
  "1. Reproduce locally with `npm run mutation` and open `reports/mutation/index.html`; " +
    "`npx stryker run --mutate src/<file>.ts` limits the run to one file.",
  "2. Add or sharpen tests in the matching `src/<file>.test.ts` (conventions in `AGENTS.md` → Testing).",
  `3. Once the score is back above ${breakThreshold}%, close this issue. The daily workflow skips while an issue with the \`${ISSUE_LABEL}\` label is open.`,
);

let body = lines.join("\n");
if (body.length > MAX_BODY_LENGTH) {
  body = `${body.slice(0, MAX_BODY_LENGTH)}\n\n_…truncated; see the full report in the workflow run artifact._`;
}
const title = `Mutation score ${scoreText} is below the ${breakThreshold}% threshold`;

// ── Create the issue ──────────────────────────────────────────────────────────

if (dryRun) {
  console.log(`\n# ${title}\n\n${body}`);
  process.exit(1);
}

const bodyFile = join(tmpdir(), `mutation-issue-${Date.now()}.md`);
writeFileSync(bodyFile, body);

execFileSync(
  "gh",
  ["label", "create", ISSUE_LABEL, "--force", "--color", "e4e669", "--description", "Mutation score below threshold"],
  { stdio: "inherit" }
);
execFileSync("gh", ["issue", "create", "--title", title, "--label", ISSUE_LABEL, "--body-file", bodyFile], {
  stdio: "inherit",
});
console.log(`❌ Mutation score ${scoreText} is below ${breakThreshold}%; opened an issue.`);
process.exit(1);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Names the innermost named function-like node containing a 1-based
 * line/column position, e.g. `ClassName.method`, `helper` or `outer › (callback)`.
 * @param {ts.SourceFile | null} sourceFile
 * @param {number} line
 * @param {number} column
 * @returns {{ name: string, startLine: number }}
 */
function enclosingFunction(sourceFile, line, column) {
  const fallback = { name: "(module scope)", startLine: 1 };
  if (!sourceFile || line < 1) return fallback;
  let pos;
  try {
    pos = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, Math.max(0, column - 1));
  } catch {
    return fallback;
  }

  /** @type {ts.Node[]} */
  const chain = [];
  (function visit(node) {
    if (pos < node.getStart(sourceFile) || pos >= node.getEnd()) return;
    chain.push(node);
    ts.forEachChild(node, visit);
  })(sourceFile);

  const named = [];
  let innermostAnonymous = false;
  let startLine = 1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    if (!ts.isFunctionLike(node) && !ts.isClassLike(node)) continue;
    const name = nodeName(node);
    if (startLine === 1 && ts.isFunctionLike(node)) {
      startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    }
    if (name) named.unshift(name);
    else if (named.length === 0) innermostAnonymous = true;
  }
  if (named.length === 0) return fallback;
  // Keep the class and outermost + innermost function names; deeper nesting adds noise.
  const trimmed = named.length > 2 ? [named[0], named[named.length - 1]] : named;
  const joined = trimmed.join(".");
  return { name: innermostAnonymous ? `${joined} › (callback)` : joined, startLine };
}

/**
 * @param {ts.Node} node
 * @returns {string | null}
 */
function nodeName(node) {
  if ("name" in node && node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return null;
}

/** @param {string} text */
function codeCell(text) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  const clipped = oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
  return `<code>${escapeHtml(clipped).replace(/\|/g, "&#124;")}</code>`;
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
