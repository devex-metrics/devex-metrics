#!/usr/bin/env node
/**
 * Reads the Vitest json-summary coverage report and writes a Markdown summary
 * to stdout. Pipe to $GITHUB_STEP_SUMMARY in CI:
 *   node scripts/coverage-summary.mjs >> $GITHUB_STEP_SUMMARY
 */
import { readFileSync } from "node:fs";

const REPORT_PATH = "coverage/coverage-summary.json";

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch {
  console.log("## ⚠️ Code Coverage\n\nNo coverage report found.");
  process.exit(0);
}

const total = report.total ?? {};
const metrics = ["lines", "statements", "functions", "branches"];

const pctOf = (metric) => total[metric]?.pct ?? 0;
const overall = metrics.reduce((sum, m) => sum + pctOf(m), 0) / metrics.length;
const emoji = overall >= 80 ? "✅" : overall >= 60 ? "⚠️" : "❌";

const lines = [
  `## ${emoji} Code Coverage Results`,
  "",
  "| Metric | Covered / Total | % |",
  "| ------ | ---------------- | - |",
];

for (const metric of metrics) {
  const m = total[metric];
  if (!m) continue;
  const label = metric.charAt(0).toUpperCase() + metric.slice(1);
  lines.push(`| ${label} | ${m.covered} / ${m.total} | ${m.pct}% |`);
}

lines.push("");
lines.push("Full Cobertura report uploaded as a build artifact.");
lines.push("");

console.log(lines.join("\n"));
