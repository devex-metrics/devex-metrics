#!/usr/bin/env node
/**
 * Reads the Stryker JSON mutation report and creates or updates a GitHub issue
 * for the Copilot coding agent to address test gaps.
 *
 * Requires GH_TOKEN in the environment (set automatically in GitHub Actions).
 * Uses the `gh` CLI to manage issues.
 *
 * Behaviour:
 *   - No report file         → exit 1 (mutation run likely failed)
 *   - 0 survived + 0 uncovered → close any open improvement issue, exit 0
 *   - Findings present       → create a new issue (assigned to copilot) or
 *                              update the body of an existing open one
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const REPORT_PATH = "reports/mutation/mutation.json";
const ISSUE_LABEL = "mutation-improvement";
const MAX_MUTANTS_IN_BODY = 20;

// ── 1. Load report ────────────────────────────────────────────────────────────

if (!existsSync(REPORT_PATH)) {
  console.error(
    `❌ Mutation report not found at ${REPORT_PATH}. Did the mutation run fail?`
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch (err) {
  console.error(`❌ Failed to parse mutation report: ${err.message}`);
  process.exit(1);
}

// ── 2. Tally results ──────────────────────────────────────────────────────────

let killed = 0,
  survived = 0,
  noCoverage = 0;
/** @type {Array<{file: string, line: number, mutator: string, replacement: string}>} */
const survivedList = [];

for (const [filePath, file] of Object.entries(report.files ?? {})) {
  for (const mutant of file.mutants ?? []) {
    switch (mutant.status) {
      case "Killed":
      case "Timeout":
        killed++;
        break;
      case "Survived":
        survived++;
        survivedList.push({
          file: filePath,
          line: mutant.location?.start?.line ?? 0,
          mutator: mutant.mutatorName ?? "",
          replacement: mutant.replacement ?? "",
        });
        break;
      case "NoCoverage":
        noCoverage++;
        break;
    }
  }
}

const denominator = killed + survived + noCoverage;
const score =
  denominator > 0 ? Math.round((killed / denominator) * 100) : 100;
const { high = 80, low = 60 } = report.thresholds ?? {};
const scoreEmoji = score >= high ? "✅" : score >= low ? "⚠️" : "❌";

console.log(
  `Mutation score: ${score}% | Survived: ${survived} | No coverage: ${noCoverage}`
);

// ── 3. Ensure the label exists ────────────────────────────────────────────────

try {
  execSync(`gh label create "${ISSUE_LABEL}" --color "e4e669" --description "Mutation test coverage gap" 2>/dev/null`, {
    stdio: "pipe",
  });
  console.log(`Created label "${ISSUE_LABEL}"`);
} catch {
  // Label already exists — that's fine
}

// ── 4. Find any existing open improvement issue ───────────────────────────────

/** @type {string | null} */
let existingIssueNumber = null;
try {
  const raw = execSync(
    `gh issue list --label "${ISSUE_LABEL}" --state open --json number --limit 1`,
    { encoding: "utf8" }
  );
  const issues = JSON.parse(raw.trim() || "[]");
  if (issues.length > 0) {
    existingIssueNumber = String(issues[0].number);
  }
} catch (err) {
  console.error(`Warning: could not check for existing issues: ${err.message}`);
}

// ── 5. No findings → close open issue (if any) and exit ──────────────────────

if (survived === 0 && noCoverage === 0) {
  console.log("✅ No mutation findings. Nothing to do.");
  if (existingIssueNumber) {
    execSync(
      `gh issue close ${existingIssueNumber} --comment "All mutation findings have been resolved. Closing automatically. 🎉"`,
      { stdio: "inherit" }
    );
    console.log(`Closed issue #${existingIssueNumber}`);
  }
  process.exit(0);
}

// ── 6. Build issue body ───────────────────────────────────────────────────────

const displayedMutants = survivedList.slice(0, MAX_MUTANTS_IN_BODY);
const truncated = survivedList.length - displayedMutants.length;

const mutantRows = displayedMutants
  .map(({ file, line, mutator, replacement }) => {
    const shortFile = file.replace(/^.*[/\\]src[/\\]/, "src/");
    const safeReplacement = String(replacement)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|");
    return `| \`${shortFile}\` | ${line} | ${mutator} | \`${safeReplacement}\` |`;
  })
  .join("\n");

const body = `## ${scoreEmoji} Mutation score: ${score}%

The weekly mutation test run has found **${survived} survived mutant(s)** and **${noCoverage} uncovered code path(s)** that need better test coverage.

| Metric | Value |
| ------ | ----- |
| Mutation score | ${score}% |
| 🟢 High threshold | ${high}% |
| 🟡 Low threshold | ${low}% |
| ❌ Survived mutants | ${survived} |
| 🔇 No coverage | ${noCoverage} |

${
  survived > 0
    ? `### Survived mutants

Each of these code changes was **not caught by any test** — a test gap exists.

| File | Line | Mutator | Replacement |
| ---- | ---- | ------- | ----------- |
${mutantRows}
${truncated > 0 ? `\n_…and ${truncated} more. Run \`npm run mutation\` locally for the full HTML report._` : ""}`
    : ""
}
${noCoverage > 0 ? `\n### No-coverage paths\n\n**${noCoverage} mutant(s)** were not executed by any test at all. These code paths need test coverage.\n` : ""}
---

### Instructions for Copilot

Please improve the test suite to address the findings above. Follow the conventions in \`.github/copilot-instructions.md\`:

- Test files live alongside source: \`src/foo.test.ts\` tests \`src/foo.ts\`
- Use vitest globals (\`describe\`, \`it\`, \`expect\`, \`vi\`)
- For collectors, inject a fake Octokit via \`setOctokit\` / \`resetOctokit\`
- For orchestrators, use \`vi.mock\` to replace cache and collector modules
- For pure functions, call directly with no mocking
- Use \`.js\` extensions in imports (Node16 ESM)
- After writing tests, verify with \`npm test\` and \`npm run mutation:ci\`

Open a PR with the improved tests once the mutation score has improved.`;

// ── 7. Create or update the issue ─────────────────────────────────────────────

if (existingIssueNumber) {
  execSync(
    `gh issue edit ${existingIssueNumber} --body ${JSON.stringify(body)}`,
    { stdio: "inherit" }
  );
  console.log(`Updated issue #${existingIssueNumber} with latest findings`);
} else {
  execSync(
    `gh issue create --title "test: improve mutation test coverage" --label "${ISSUE_LABEL}" --assignee "copilot" --body ${JSON.stringify(body)}`,
    { stdio: "inherit" }
  );
  console.log("Created new improvement issue and assigned to Copilot");
}
