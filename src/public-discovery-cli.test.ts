import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { createCloneBudget } from "../scripts/public-discovery-clone-budget.mjs";
import { latestPath } from "./history.js";

const entry = path.resolve("dist", "public-discovery-cli.js");

describe("full-history public discovery workflow adapter", () => {
  let work: string;
  let history: string;
  let output: string;

  beforeEach(() => {
    fs.mkdirSync("data", { recursive: true });
    work = fs.mkdtempSync(path.resolve("data", "discovery-cli-test-"));
    history = path.join(work, "history");
    output = path.join(work, "outputs.txt");
    const latest = latestPath(history, "acme");
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.writeFileSync(
      latest,
      JSON.stringify({
        owner: "acme",
        collectedAt: "2026-09-29T12:00:00Z",
        repos: [
          {
            fullName: "acme/b",
            isPrivate: false,
            sizeKb: 100,
            mergedPRTimeline: [{ mergedAt: "2026-09-28T00:00:00Z" }],
          },
          {
            fullName: "acme/huge",
            isPrivate: false,
            sizeKb: 6_448_427,
            mergedPRTimeline: Array(5).fill({ mergedAt: "2026-09-28T00:00:00Z" }),
          },
          {
            fullName: "acme/a",
            isPrivate: false,
            sizeKb: 100,
            mergedPRTimeline: [{ mergedAt: "2026-09-28T00:00:00Z" }],
          },
          { fullName: "acme/private", isPrivate: true, sizeKb: 50, mergedPRTimeline: [] },
        ],
      })
    );
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  function run(command: string, override: Record<string, string> = {}) {
    return spawnSync(process.execPath, [entry, ...command.split(" ")], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: "",
        DEVEX_OWNER: "acme",
        DEVEX_HISTORY_DIR: history,
        DEVEX_FEATURE_PUBLIC_DISCOVERY: "true",
        DEVEX_PUBLIC_DISCOVERY_MAX_REPOS: "2",
        GITHUB_OUTPUT: output,
        ...override,
      },
    });
  }

  it("prepares only the exact ranked, size-safe selection and a nonempty owner-scoped token list", () => {
    expect(run("prepare").status).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(work, "data", "public-discovery.config.json"), "utf8"))
    ).toEqual({ schema_version: 1, repositories: ["acme/a", "acme/b"], stale_after_days: 90 });
    expect(fs.readFileSync(output, "utf8")).toContain("discovery-repositories=a,b\n");
    expect(fs.readFileSync(output, "utf8")).toContain("discovery-max-size-kb=512000\n");
    expect(fs.readFileSync(output, "utf8")).toContain("discovery-max-clone-size-kb=8388608\n");
    expect(fs.readFileSync(output, "utf8")).toContain("discovery-clone-minutes=60\n");
    expect(fs.readFileSync(output, "utf8")).not.toContain("huge");
    expect(fs.existsSync(path.join(work, "data", "public-discovery.heads.json"))).toBe(false);
  });

  it("disabled feature never prepares a selection or asks for a token", () => {
    expect(run("prepare", { DEVEX_FEATURE_PUBLIC_DISCOVERY: "false" }).status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toBe(
      "discovery-enabled=false\ndiscovery-scan-needed=false\n"
    );
    expect(fs.existsSync(path.join(work, "data", "public-discovery.config.json"))).toBe(false);
  });

  it("fails invalid limits before requesting a token and requires auth for pin", () => {
    const bad = run("prepare", { DEVEX_PUBLIC_DISCOVERY_MAX_REPOS: "2.5" });
    expect(bad.status).not.toBe(0);
    expect(fs.existsSync(output)).toBe(false);
    expect(run("prepare", { DEVEX_PUBLIC_DISCOVERY_MAX_CLONE_SIZE_KB: "0" }).status).not.toBe(0);
    expect(run("prepare").status).toBe(0);
    const pin = run("pin", { GITHUB_TOKEN: "" });
    expect(pin.status).not.toBe(0);
    expect(pin.stderr).toContain("Contents-read GITHUB_TOKEN");
  });

  it("rejects a selection beyond the installed CLI limit before writing clone configuration", () => {
    const latest = latestPath(history, "acme");
    const data = JSON.parse(fs.readFileSync(latest, "utf8"));
    data.repos = Array.from({ length: 501 }, (_, i) => ({
      fullName: `acme/repo-${i}`,
      isPrivate: false,
      sizeKb: 100,
    }));
    fs.writeFileSync(latest, JSON.stringify(data));
    const result = run("prepare", { DEVEX_PUBLIC_DISCOVERY_MAX_REPOS: "0" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("500-repository limit");
    expect(fs.existsSync(path.join(work, "data", "public-discovery.config.json"))).toBe(false);
  });

  it("rejects dot-path repository names before resolving clone destinations", () => {
    const folder = path.join(work, "data");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "public-discovery.config.json"),
      JSON.stringify({ repositories: ["acme/.."] })
    );
    fs.writeFileSync(
      path.join(folder, "public-discovery.heads.json"),
      JSON.stringify({ "acme/..": "a".repeat(40) })
    );
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts", "public-discovery-clone.mjs")],
      {
        cwd: work,
        encoding: "utf8",
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid or empty public discovery clone selection");
    expect(fs.existsSync(path.join(folder, "public-discovery-clones"))).toBe(false);
  });

  it("scopes the App token, enforces heads and clone budgets, and publishes independent failures", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github", "workflows", "collect-metrics.yml"),
      "utf8"
    );
    const pages = fs.readFileSync(path.resolve(".github", "workflows", "pages.yml"), "utf8");
    expect(workflow).toContain("steps.discovery-prepare.outputs.discovery-repositories");
    expect(workflow).toContain("permission-contents: read");
    expect(workflow).toContain("node dist/public-discovery-cli.js pin");
    expect(workflow).toContain(
      "--repos-dir data/public-discovery-clones --expected-heads data/public-discovery.heads.json"
    );
    expect(workflow).toContain(
      "node dist/public-discovery-cli.js ingest data/public-discovery-raw.json"
    );
    expect(workflow).toContain("node dist/public-discovery-cli.js mark-failed");
    expect(workflow).toContain(
      "      discovery-publish: ${{ steps.discovery-failed.outputs.discovery-publish }}"
    );
    expect(workflow).toContain(
      "if: always() && steps.discovery-failed.outputs.discovery-publish == 'true'"
    );
    expect(workflow).toContain("needs.collect.outputs.discovery-publish == 'true'");
    expect(workflow).toContain("history-published: ${{ steps.publish-history.outcome }}");
    expect(workflow).toContain("id: publish-history");
    expect(workflow).toContain("DEVEX_PUBLIC_DISCOVERY_MAX_CLONE_SIZE_KB: ${{ steps.discovery-prepare.outputs.discovery-max-clone-size-kb }}");
    expect(workflow).toContain("DEVEX_PUBLIC_DISCOVERY_CLONE_MINUTES: ${{ steps.discovery-prepare.outputs.discovery-clone-minutes }}");
    expect(pages).toContain(
      "DEVEX_FEATURE_PUBLIC_DISCOVERY: ${{ vars.DEVEX_FEATURE_PUBLIC_DISCOVERY }}"
    );
    expect(workflow).toContain("if: always() && steps.discovery-pin.outcome == 'success'");
    const script = fs.readFileSync(path.resolve("scripts", "public-discovery-clone.mjs"), "utf8");
    expect(script).toContain('"--no-tags"');
    expect(script).toContain("head !== heads[name]");
    expect(script).toContain("controller.abort()");
    expect(script).toContain("budget.check(target)");
    expect(script).toContain("budget.remainingMs()");
    expect(script).toContain('[\".\", \"..\"].includes(name.split(\"/\")[1])');
  });

  it("enforces combined disk and elapsed-time budgets across completed and active clones", () => {
    const root = path.join(work, "clones");
    const first = path.join(root, "acme", "first");
    const second = path.join(root, "acme", "second");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    let elapsed = 0;
    const budget = createCloneBudget(root, 0, 3, 1, () => elapsed);
    fs.writeFileSync(path.join(first, "data"), Buffer.alloc(2048));
    budget.check(first);
    fs.writeFileSync(path.join(second, "data"), Buffer.alloc(1024));
    budget.check(second);
    fs.appendFileSync(path.join(second, "data"), Buffer.alloc(1));
    expect(() => budget.check(second)).toThrow(/clone directory exceeded 3072 bytes total/);
    fs.truncateSync(path.join(second, "data"), 1024);
    elapsed = 60_000;
    expect(() => budget.check(first)).toThrow(/clone deadline exceeded \(1 minutes total\)/);
  });

  it("retains the independent per-repository disk guard", () => {
    const root = path.join(work, "clones");
    const target = path.join(root, "acme", "first");
    fs.mkdirSync(target, { recursive: true });
    const budget = createCloneBudget(root, 1, 4, 1, () => 0);
    fs.writeFileSync(path.join(target, "data"), Buffer.alloc(2048));
    budget.check(target);
    fs.appendFileSync(path.join(target, "data"), Buffer.alloc(1));
    expect(() => budget.check(target)).toThrow(/exceeded 2048 bytes per repository/);
    expect(() => createCloneBudget(root, 0, 0, 1)).toThrow(/Invalid public discovery clone budget/);
  });

  it("deploys either failure notice only after a successful history-store publish", () => {
    const workflow = fs.readFileSync(path.resolve(".github", "workflows", "collect-metrics.yml"), "utf8");
    const expression = workflow.match(/  pages:\r?\n    needs: collect\r?\n    if: ([^\r\n]+)/)?.[1];
    expect(expression).toBeDefined();
    const javascript = expression!.replace(
      /needs\.collect\.outputs\.([a-z-]+)/g,
      (_, key: string) => `needs.collect.outputs["${key}"]`
    );
    for (const { collectSucceeded, publish, landscape, discovery, deploy } of [
      { collectSucceeded: true, publish: "success", landscape: "false", discovery: "false", deploy: true },
      { collectSucceeded: false, publish: "success", landscape: "true", discovery: "false", deploy: true },
      { collectSucceeded: false, publish: "success", landscape: "false", discovery: "true", deploy: true },
      { collectSucceeded: false, publish: "success", landscape: "false", discovery: "false", deploy: false },
      { collectSucceeded: false, publish: "failure", landscape: "true", discovery: "true", deploy: false },
      { collectSucceeded: false, publish: "skipped", landscape: "true", discovery: "false", deploy: false },
      { collectSucceeded: true, publish: "failure", landscape: "false", discovery: "true", deploy: false },
    ]) {
      const result = runInNewContext(javascript, {
        success: () => collectSucceeded,
        failure: () => !collectSucceeded,
        needs: { collect: { outputs: {
          "history-published": publish,
          "landscape-publish": landscape,
          "discovery-publish": discovery,
        } } },
      });
      expect(result).toBe(deploy);
    }
  });
});
