import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "visual-diff-comment.mjs");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("data")]);

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-diff-comment-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const screenshots = path.join(root, "screenshots");
  for (const directory of ["baseline", "current", "diff"]) {
    fs.mkdirSync(path.join(screenshots, directory), { recursive: true });
  }
  return { root, screenshots };
}

const run = (root, args) =>
  execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });

test("renders before, after and diff in light-then-dark rows", (t) => {
  const { root, screenshots } = scratch(t);
  const comparisons = ["dark", "light"].map((theme) => {
    const name = `dashboard.${theme}.png`;
    for (const directory of ["baseline", "current"]) {
      fs.writeFileSync(path.join(screenshots, directory, name), PNG);
    }
    const diff = `dashboard.${theme}.diff.png`;
    fs.writeFileSync(path.join(screenshots, "diff", diff), PNG);
    return { view: "dashboard", theme, status: "changed", baseline: name, current: name, diff, changedPixels: 10, changedPercent: 1 };
  });
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify({ comparisons }));

  run(root, ["--report", "report.json", "--screenshots", "screenshots", "--out-dir", "output", "--base", "abcdef0123456789"]);

  const comment = fs.readFileSync(path.join(root, "output", "comment.md"), "utf8");
  assert.ok(comment.startsWith("<!-- visual-dashboard-diff -->\n"), "marker must be the first line");
  assert.match(comment, /merge base `abcdef012345`/);
  const rows = comment.split("\n").filter((line) => line.startsWith("| **Dashboard**"));
  assert.match(comment, /\| Name \| Before \| After \| Diff \|/);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes("(light mode)"));
  assert.ok(rows[0].includes("![Before: Dashboard light](screenshots/baseline/dashboard.light.png)"));
  assert.ok(rows[0].includes("![After: Dashboard light](screenshots/current/dashboard.light.png)"));
  assert.ok(rows[0].includes("![Diff: Dashboard light](screenshots/diff/dashboard.light.diff.png)"));
  assert.ok(rows[1].includes("(dark mode)"));

  const plain = fs.readFileSync(path.join(root, "output", "comment-plain.md"), "utf8");
  assert.doesNotMatch(plain, /!\[/);
  assert.match(plain, /dashboard-screenshots/);

  const attachments = fs.readFileSync(path.join(root, "output", "attachments.txt"), "utf8").trim().split("\n");
  assert.equal(attachments.length, 6);
  assert.equal(attachments[0], "screenshots/baseline/dashboard.light.png#Before: Dashboard light");
});

test("artifact contents are untrusted: non-PNG, oversized and unusable inputs are not attached", (t) => {
  const { root, screenshots } = scratch(t);
  for (const [name, bytes] of [["fake.png", Buffer.from("<script>")], ["good.png", PNG]]) {
    for (const directory of ["baseline", "current", "diff"]) {
      fs.writeFileSync(path.join(screenshots, directory, name), bytes);
    }
  }
  for (const directory of ["baseline", "current", "diff"]) {
    fs.writeFileSync(path.join(screenshots, directory, "big.png"), Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
  }
  const row = (view, file) => ({
    view, theme: "light", status: "changed", baseline: file, current: file, diff: file, changedPixels: 1, changedPercent: 1,
  });
  fs.writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify({ comparisons: [row("fake", "fake.png"), row("big", "big.png"), row("good <b>bold</b> | pipe", "good.png")] })
  );

  run(root, ["--report", "report.json", "--screenshots", "screenshots", "--out-dir", "output"]);
  const attachments = fs.readFileSync(path.join(root, "output", "attachments.txt"), "utf8");
  assert.ok(attachments.includes("good.png"));
  assert.ok(!attachments.includes("fake.png"));
  assert.ok(!attachments.includes("big.png"), "a PNG over the size bound must be omitted");
  const comment = fs.readFileSync(path.join(root, "output", "comment.md"), "utf8");
  assert.doesNotMatch(comment, /<b>/, "report fields must not carry markup into the comment");
  assert.doesNotMatch(comment, /good \|/, "report fields must not break the table");

  fs.writeFileSync(path.join(root, "huge.json"), " ".repeat(2 * 1024 * 1024 + 1));
  assert.match(run(root, ["--report", "huge.json", "--screenshots", "screenshots", "--out-dir", "output"]), /unusable/);
  fs.writeFileSync(path.join(root, "bad.json"), "not json");
  assert.match(run(root, ["--report", "bad.json", "--screenshots", "screenshots", "--out-dir", "output"]), /unusable/);
});

test("no changes yields an all-clear with no attachments and has_changes=false", (t) => {
  const { root } = scratch(t);
  const comparisons = ["light", "dark"].map((theme) => ({
    view: "dashboard", theme, status: "unchanged", changedPixels: 0, changedPercent: 0,
  }));
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify({ comparisons }));
  const outputFile = path.join(root, "outputs.txt");
  execFileSync(process.execPath, [script, "--report", "report.json", "--screenshots", "screenshots", "--out-dir", "output"], {
    cwd: root, env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });
  const comment = fs.readFileSync(path.join(root, "output", "comment.md"), "utf8");
  assert.match(comment, /No visual changes: all 2 dashboard screenshots are pixel-identical/);
  assert.equal(fs.readFileSync(path.join(root, "output", "attachments.txt"), "utf8"), "");
  const outputs = fs.readFileSync(outputFile, "utf8");
  assert.match(outputs, /has_report=true/);
  assert.match(outputs, /has_changes=false/);
  assert.match(outputs, /attachments=0/);
});

test("--notice writes a marker-first replacement for a stale comment", (t) => {
  const { root } = scratch(t);
  for (const kind of ["skipped", "no-report"]) {
    run(root, ["--notice", kind, "--out-dir", "output", "--run-url", "https://github.com/o/r/actions/runs/1"]);
    const body = fs.readFileSync(path.join(root, "output", "comment-plain.md"), "utf8");
    assert.ok(body.startsWith("<!-- visual-dashboard-diff -->\n"), "marker must stay the first line");
    assert.match(body, /no longer apply/);
    assert.match(body, /\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/);
  }
  assert.throws(() => execFileSync(process.execPath, [script, "--notice", "bogus"], { cwd: root, stdio: "pipe" }));
});
