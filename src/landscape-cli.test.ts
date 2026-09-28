import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { latestPath } from "./history.js";
import { landscapeLatestPath } from "./landscape.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";

const ENTRY = path.resolve("dist", "landscape-cli.js");

describe("landscape workflow adapter", () => {
  let work: string;
  let history: string;
  let output: string;

  beforeEach(() => {
    fs.mkdirSync("data", { recursive: true });
    work = fs.mkdtempSync(path.resolve("data", "landscape-cli-test-"));
    history = path.join(work, "history");
    output = path.join(work, "outputs.txt");
    const refs = [
      ["acme/public", false],
      ["acme/private", true],
      ["acme/unverified", undefined],
      ["another/cross-owner", false],
    ] as const;
    const repos: RepoMetrics[] = refs.map(([fullName, isPrivate]) => ({
      name: fullName.split("/")[1],
      fullName,
      isPrivate,
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, closed: 0, merged: 0 },
      pullRequestDetails: [],
      committerCount: 0,
      reviewerCount: 0,
      contributorCount: 0,
      dependentCount: 0,
    }));
    const data: OrgMetrics = {
      owner: "acme",
      ownerType: "org",
      collectedAt: "2026-09-25T12:00:00Z",
      repoCount: repos.length,
      repos,
    };
    const latest = latestPath(history, "acme");
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.writeFileSync(latest, JSON.stringify(data));
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  function run(command: string, config = "") {
    return spawnSync(process.execPath, [ENTRY, ...command.split(" ")], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: config,
        DEVEX_OWNER: "acme",
        DEVEX_HISTORY_DIR: history,
        DEVEX_FEATURE_LANDSCAPE: "true",
        GITHUB_OUTPUT: output,
      },
    });
  }

  it("uses the collected DevEx selection, excludes private/unverified/other-owner repos, and scopes the token", () => {
    const result = run("prepare");
    expect(result.status).toBe(0);
    const generated = JSON.parse(
      fs.readFileSync(path.join(work, "data", "landscape.config.json"), "utf8")
    );
    expect(generated).toEqual({
      schema_version: 1,
      repositories: ["acme/public"],
      stale_after_days: 90,
    });
    const outputs = fs.readFileSync(output, "utf8");
    expect(outputs).toContain("landscape-enabled=true");
    expect(outputs).toContain("landscape-scan-needed=true");
    expect(outputs).not.toContain("landscape-cli-version=");
    expect(outputs).toContain("landscape-owner=acme\n");
    expect(outputs).toContain("landscape-repositories=public\n");
    expect(outputs).not.toContain("private");
  });

  it("skips the scan and additional token when disabled", () => {
    const result = spawnSync(process.execPath, [ENTRY, "prepare"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: "",
        DEVEX_FEATURE_LANDSCAPE: "false",
        DEVEX_OWNER: "acme",
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toBe(
      "landscape-enabled=false\nlandscape-scan-needed=false\n"
    );
    expect(fs.existsSync(path.join(work, "data", "landscape.config.json"))).toBe(false);
  });

  it("rejects invalid landscape input before requesting a scan token", () => {
    const result = run(
      "prepare",
      JSON.stringify({
        owner: "acme",
        collection: { landscapeStaleAfterDays: 0, features: { landscape: true } },
      })
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("positive integer");
    expect(fs.existsSync(path.join(work, "data", "landscape.config.json"))).toBe(false);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("accepts inline feature configuration and preserves configured stale threshold", () => {
    const result = spawnSync(process.execPath, [ENTRY, "prepare"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: JSON.stringify({
          owner: "acme",
          history: { dir: history },
          collection: {
            landscapeStaleAfterDays: 120,
            features: { landscape: true },
          },
        }),
        DEVEX_OWNER: "",
        DEVEX_HISTORY_DIR: "",
        DEVEX_FEATURE_LANDSCAPE: "",
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(work, "data", "landscape.config.json"), "utf8"))
    ).toMatchObject({ stale_after_days: 120, repositories: ["acme/public"] });
    expect(fs.readFileSync(output, "utf8")).toContain("landscape-owner=acme\n");
  });

  it("does not request a broad installation token for an empty public selection", () => {
    const selected: OrgMetrics = JSON.parse(fs.readFileSync(latestPath(history, "acme"), "utf8"));
    selected.repos = selected.repos.filter(
      (repo) => repo.isPrivate !== false || !repo.fullName.startsWith("acme/")
    );
    fs.writeFileSync(latestPath(history, "acme"), JSON.stringify(selected));
    expect(run("prepare").status).toBe(0);
    const outputs = fs.readFileSync(output, "utf8");
    expect(outputs).toContain("landscape-scan-needed=false");
    expect(outputs).not.toContain("landscape-owner=");
    expect(outputs).not.toContain("landscape-repositories=");
  });

  it("passes the landscape flag to collection and the resolved settings to ingestion", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github", "workflows", "collect-metrics.yml"),
      "utf8"
    );
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const lockfile = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    const collect = workflow
      .split("      - name: Collect metrics\n")[1]
      ?.split("      - name: Prepare public landscape scan\n")[0];
    const ingest = workflow
      .split("      - name: Ingest sanitized landscape snapshots\n")[1]
      ?.split("      - name: Publish history store\n")[0];
    expect(collect).toContain("DEVEX_FEATURE_LANDSCAPE: ${{ vars.DEVEX_FEATURE_LANDSCAPE }}");
    expect(workflow).toContain("owner: ${{ steps.landscape.outputs.landscape-owner }}");
    expect(workflow).toContain(
      "repositories: ${{ steps.landscape.outputs.landscape-repositories }}"
    );
    expect(workflow).toContain(
      "if: steps.landscape.outputs.landscape-enabled == 'true' && steps.landscape.outputs.landscape-scan-needed == 'true'"
    );
    expect(workflow).toContain("run: npx --no-install repo-landscape scan");
    expect(workflow).not.toContain("Install pinned landscape CLI");
    expect(workflow).not.toContain("DEVEX_LANDSCAPE_CLI_VERSION");
    expect(workflow).not.toContain("npm install");
    expect(packageJson.dependencies["@devex-metrics/repo-landscape"]).toMatch(/^\^?\d+\.\d+\.\d+/);
    expect(packageJson.devDependencies["@devex-metrics/repo-landscape"]).toBeUndefined();
    const scannerManifest = JSON.parse(
      fs.readFileSync(
        path.resolve("node_modules", "@devex-metrics", "repo-landscape", "package.json"),
        "utf8"
      )
    );
    expect(lockfile.packages["node_modules/@devex-metrics/repo-landscape"].version).toBe(
      scannerManifest.version
    );
    expect(ingest).toContain(
      "DEVEX_LANDSCAPE_STALE_AFTER_DAYS: ${{ vars.DEVEX_LANDSCAPE_STALE_AFTER_DAYS }}"
    );
  });

  it("records a failed run, then publishes the store and rebuilds Pages", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github", "workflows", "collect-metrics.yml"),
      "utf8"
    );
    expect(workflow).toContain(
      "        id: landscape-failed\n        if: failure() || steps.landscape-token.outcome == 'failure'\n"
    );
    expect(workflow).toContain("run: node dist/landscape-cli.js mark-failed");
    expect(workflow).toContain(
      "      - name: Publish history store\n        if: success() || (failure() && steps.landscape-failed.outputs.landscape-publish == 'true')"
    );
    expect(workflow).toContain(
      "    needs: collect\n    if: success() || (failure() && needs.collect.outputs.landscape-publish == 'true')"
    );
    expect(workflow).toContain(
      "        if: failure() && steps.landscape-token.outcome == 'success'\n"
    );
    expect(workflow).toContain("run: node dist/landscape-cli.js recheck");
  });

  it("downgrades a failed scan token to a warning and skips the scan", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github", "workflows", "collect-metrics.yml"),
      "utf8"
    );
    const tokenStep = workflow
      .split("      - name: Create landscape scan token\n")[1]
      ?.split("      - name: ")[0];
    const warnStep = workflow
      .split("      - name: Warn about missing landscape token\n")[1]
      ?.split("      - name: ")[0];
    expect(tokenStep).toContain("continue-on-error: true");
    expect(warnStep).toContain("if: steps.landscape-token.outcome == 'failure'");
    expect(warnStep).toContain("::warning title=Landscape scan skipped::");
    expect(warnStep).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(workflow).toContain(
      "        id: landscape-scan\n        if: steps.landscape-token.outcome == 'success'\n"
    );
    expect(workflow).toContain(
      "        id: landscape-ingest\n        if: steps.landscape-token.outcome == 'success'\n"
    );
  });

  it("scrubs stored observations of repos no longer verified public during preparation", () => {
    const latest = landscapeLatestPath(history, "acme");
    const snapshot = path.join(path.dirname(latest), "snapshots", "old.json");
    const stored = {
      schema_version: 1,
      generated_at: "2026-09-20T12:00:00Z",
      scanner_version: "0.1.0",
      repositories: ["acme/public", "acme/private"].map((full_name) => ({
        full_name,
        head_sha: "a".repeat(40),
        ai_files: [
          {
            path: "AGENTS.md",
            kind: "instructions",
            sha256: "a".repeat(64),
            last_changed: "2026-09-01T00:00:00Z",
            age_days: 1,
            lag_days: 1,
            stale: false,
          },
        ],
        ai_summary: { count: 1, stale_count: 0, max_lag_days: 1 },
      })),
    };
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.writeFileSync(latest, JSON.stringify(stored));
    fs.writeFileSync(snapshot, JSON.stringify(stored));
    const result = run("prepare");
    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toContain("landscape-scan-needed=true");
    for (const file of [latest, snapshot]) {
      const contents = fs.readFileSync(file, "utf8");
      expect(contents).toContain("acme/public");
      expect(contents).not.toContain("acme/private");
    }
  });

  it("mark-failed keeps the last good data, scrubs, records the failure and asks to publish", () => {
    const latest = landscapeLatestPath(history, "acme");
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.writeFileSync(
      latest,
      JSON.stringify({
        schema_version: 1,
        generated_at: "2026-09-20T12:00:00Z",
        scanner_version: "0.1.0",
        repositories: ["acme/public", "acme/private"].map((full_name) => ({
          full_name,
          head_sha: "a".repeat(40),
          ai_files: [],
          ai_summary: { count: 0, stale_count: 0, max_lag_days: null },
        })),
      })
    );
    const result = spawnSync(process.execPath, [ENTRY, "mark-failed"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: "",
        DEVEX_OWNER: "acme",
        DEVEX_HISTORY_DIR: history,
        DEVEX_FEATURE_LANDSCAPE: "true",
        GITHUB_OUTPUT: output,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "acme/devex",
        GITHUB_RUN_ID: "42",
      },
    });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toContain("landscape-publish=true");
    const stored = fs.readFileSync(latest, "utf8");
    expect(stored).toContain("acme/public");
    expect(stored).not.toContain("acme/private");
    const status = JSON.parse(
      fs.readFileSync(path.join(path.dirname(latest), "status.json"), "utf8")
    );
    expect(status).toMatchObject({
      ok: false,
      run_url: "https://github.com/acme/devex/actions/runs/42",
    });
  });

  it("mark-failed still records the failure when the configuration is invalid", () => {
    const result = spawnSync(process.execPath, [ENTRY, "mark-failed"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: "{not json",
        DEVEX_OWNER: "acme",
        DEVEX_HISTORY_DIR: history,
        DEVEX_FEATURE_LANDSCAPE: "true",
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toContain("landscape-publish=true");
    const status = path.join(path.dirname(landscapeLatestPath(history, "acme")), "status.json");
    expect(JSON.parse(fs.readFileSync(status, "utf8"))).toMatchObject({ ok: false });
  });

  it("mark-failed recovers config-only settings when a landscape setting is invalid", () => {
    const result = spawnSync(process.execPath, [ENTRY, "mark-failed"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: JSON.stringify({
          owner: "acme",
          history: { dir: history },
          collection: { landscapeStaleAfterDays: 0, features: { landscape: true } },
        }),
        DEVEX_OWNER: "",
        DEVEX_HISTORY_DIR: "",
        DEVEX_FEATURE_LANDSCAPE: "",
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Configuration is invalid");
    expect(fs.readFileSync(output, "utf8")).toContain("landscape-publish=true");
    const status = path.join(path.dirname(landscapeLatestPath(history, "acme")), "status.json");
    expect(JSON.parse(fs.readFileSync(status, "utf8"))).toMatchObject({ ok: false });
  });

  it("mark-failed is a no-op when the feature is disabled", () => {
    const result = spawnSync(process.execPath, [ENTRY, "mark-failed"], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DEVEX_CONFIG: "",
        DEVEX_OWNER: "acme",
        DEVEX_HISTORY_DIR: history,
        DEVEX_FEATURE_LANDSCAPE: "false",
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status).toBe(0);
    expect(fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "").not.toContain(
      "landscape-publish"
    );
  });

  it("refuses ingestion without a restricted Contents-read token", () => {
    const rawFile = path.join(work, "raw.json");
    fs.writeFileSync(rawFile, "{}");
    const result = run(`ingest ${rawFile}`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Contents-read GITHUB_TOKEN");
  });
});
