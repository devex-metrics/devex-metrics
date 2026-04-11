#!/usr/bin/env node
/**
 * Reads the Stryker JSON mutation report and writes a Markdown summary to stdout.
 * Pipe to $GITHUB_STEP_SUMMARY in CI:
 *   node scripts/mutation-summary.mjs >> $GITHUB_STEP_SUMMARY
 */
import { readFileSync } from "node:fs";

const REPORT_PATH = "reports/mutation/mutation.json";

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch {
  console.log("## ⚠️ Mutation Testing\n\nNo mutation report found.");
  process.exit(0);
}

// Tally mutant statuses across all files
let killed = 0, survived = 0, noCoverage = 0, timeout = 0, ignored = 0;
/** @type {Array<{file: string, line: number, mutator: string, replacement: string}>} */
const survivedList = [];

for (const [filePath, file] of Object.entries(report.files ?? {})) {
  for (const mutant of file.mutants ?? []) {
    switch (mutant.status) {
      case "Killed":       killed++;     break;
      case "Survived":     survived++;   survivedList.push({ file: filePath, line: mutant.location?.start?.line ?? 0, mutator: mutant.mutatorName, replacement: mutant.replacement }); break;
      case "NoCoverage":   noCoverage++; break;
      case "Timeout":      timeout++;    killed++; break; // timeouts count as killed
      case "Ignored":      ignored++;    break;
      // CompileError / RuntimeError: skip (not counted in score)
    }
  }
}

const tested = killed + survived + noCoverage + timeout - timeout; // timeout already added to killed
// Recalculate: score denominator is killed + survived + noCoverage (timeout already merged into killed)
const denominator = killed + survived + noCoverage;
const score = denominator > 0 ? Math.round((killed / denominator) * 100) : 100;

const { high = 80, low = 60 } = report.thresholds ?? {};
const emoji = score >= high ? "✅" : score >= low ? "⚠️" : "❌";

const lines = [
  `## ${emoji} Mutation Testing Results`,
  "",
  `**Mutation score: ${score}%** (threshold: 🟢 ≥${high}% / 🟡 ≥${low}%)`,
  "",
  "| Status | Count |",
  "| ------ | ----- |",
  `| ✅ Killed | ${killed} |`,
  `| ❌ Survived | ${survived} |`,
  `| 🔇 No coverage | ${noCoverage} |`,
  `| ⏭️ Ignored | ${ignored} |`,
  `| **Total mutants** | **${denominator + ignored}** |`,
  "",
];

if (survivedList.length > 0) {
  lines.push("<details>");
  lines.push(`<summary>🔍 ${survivedList.length} survived mutant(s) — potential test gaps</summary>`);
  lines.push("");
  lines.push("| File | Line | Mutator | Replacement |");
  lines.push("| ---- | ---- | ------- | ----------- |");
  for (const { file, line, mutator, replacement } of survivedList) {
    const shortFile = file.replace(/^.*[/\\]src[/\\]/, "src/");
    const safeReplacement = String(replacement ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    lines.push(`| \`${shortFile}\` | ${line} | ${mutator} | \`${safeReplacement}\` |`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

if (noCoverage > 0) {
  lines.push(`> **${noCoverage} mutant(s)** were not covered by any test — consider adding tests for those code paths.`);
  lines.push("");
}

console.log(lines.join("\n"));
