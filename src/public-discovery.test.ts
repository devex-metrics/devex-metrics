import * as fs from "node:fs";
import * as path from "node:path";
import type { Octokit } from "@octokit/rest";
import { defaultConfig } from "./config.js";
import {
  discoveryLatestPath,
  loadPublicDiscoveryStatus,
  loadPublicDiscoveryView,
  parsePublicDiscoveryScan,
  recheckPublicDiscovery,
  savePublicDiscoveryScan,
  savePublicDiscoveryStatus,
  scrubPublicDiscovery,
  selectPublicDiscovery,
  validatePublicDiscoveryOutput,
} from "./public-discovery.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const DATE = "2026-09-29T12:00:00Z";
const VERSION = "0.1.1";

function repo(
  name: string,
  merges: string[] = [],
  details: Partial<RepoMetrics> = {}
): RepoMetrics {
  return {
    name,
    fullName: `acme/${name}`,
    isPrivate: false,
    sizeKb: 100,
    mergedPRTimeline: merges.map((mergedAt, number) => ({
      number,
      createdAt: mergedAt,
      mergedAt,
      author: "test",
      isBotAuthor: false,
    })),
    issues: { open: 0, closed: 0 },
    pullRequests: { open: 0, closed: 0, merged: 0 },
    pullRequestDetails: [],
    committerCount: 0,
    reviewerCount: 0,
    contributorCount: 0,
    dependentCount: 0,
    ...details,
  };
}

function metrics(repos: RepoMetrics[]): OrgMetrics {
  return { owner: "acme", ownerType: "org", collectedAt: DATE, repoCount: repos.length, repos };
}

function fullRepo(fullName = "acme/a", head = A) {
  return {
    full_name: fullName,
    head_sha: head,
    head_committed_at: DATE,
    ai_files: [{ path: "AGENTS.md", content: "DO NOT PUBLISH", evidence: { author: "private" } }],
    ai_summary: { count: 1 },
    title: "README SECRET",
    summary: "README BODY SECRET",
    repo_type: "repo",
    metrics: { files: 6, bytes: 1250, source_loc: 40, estimated_code_lines: 40 },
    languages: [{ name: "TypeScript", files: 2, loc: 40 }],
    extensions: [{ name: ".ts", files: 2 }],
    git: {
      branch: "main",
      commit_count: 20,
      commits_30d: 2,
      commits_90d: 2,
      commits_90d_trend: [...Array(88).fill(0), 1, 1],
      contributor_count: 3,
      hotspots_90d: [{ path: "private/author", changes: 8 }],
    },
    architecture: { adr_count: 1, adr_files: ["docs/adr.md"] },
    manifests: ["package.json"],
    produces: [{ name: "package", source: "package.json" }],
    consumes: [{ name: "another", source: "package.json" }],
    analysis_warnings: [],
  };
}

function scanner(repositories: unknown[], edges: unknown[] = []): unknown {
  const names = (repositories as { full_name: string }[]).map((item) => item.full_name).sort();
  return {
    schema_version: 1,
    generated_at: "2026-09-29T12:05:00Z",
    scanner_version: VERSION,
    provenance: {
      source: "local_git",
      snapshot: "pinned_head",
      analysis: "full",
      stale_after_days: 90,
    },
    selection: {
      mode: "explicit",
      explicit_repositories: names,
      selected_repositories: names,
      discovery: [],
    },
    repositories,
    edges,
    content: "DO NOT PUBLISH",
  };
}

describe("public discovery exact selection and ranking", () => {
  it("uses recent merged PR timestamps and deterministic names, fills oversized ranks, and never uses pushedAt", () => {
    const config = defaultConfig();
    config.collection.publicDiscoveryMaxRepos = 2;
    const data = metrics([
      repo("z", [DATE], { pushedAt: "2000-01-01T00:00:00Z" }),
      repo("huge", [DATE, DATE, DATE], { sizeKb: 6_448_427 }),
      repo("b", ["2026-06-01T00:00:00Z"], { pushedAt: DATE }),
      repo("a", [DATE]),
      repo("not-accessible", [DATE, DATE], { isPrivate: true }),
    ]);
    expect(selectPublicDiscovery(data, config).map((item) => item.fullName)).toEqual([
      "acme/a",
      "acme/z",
    ]);
    const view = loadPublicDiscoveryView("data/no-such-history", data, config);
    expect(view.rows.find((row) => row.fullName === "acme/huge")).toEqual({
      fullName: "acme/huge",
      status: "unknown",
      reason: "oversized",
    });
    expect(view.rows.find((row) => row.fullName === "acme/b")?.reason).toBe("not_selected");
    config.collection.publicDiscoveryMaxRepos = 0;
    expect(selectPublicDiscovery(data, config).map((item) => item.fullName)).toEqual([
      "acme/a",
      "acme/z",
      "acme/b",
    ]);
    config.collection.publicDiscoveryMaxSizeKb = 0;
    expect(selectPublicDiscovery(data, config).map((item) => item.fullName)[0]).toBe("acme/huge");
  });

  it("leaves repos without 90-day ranking or size unknown when capped or safety bound", () => {
    const config = defaultConfig();
    config.collection.publicDiscoveryMaxRepos = 20;
    const data = metrics([
      repo("no-timeline", [], { mergedPRTimeline: undefined }),
      repo("no-size", [DATE], { sizeKb: undefined }),
      repo("cross-owner", [DATE], { fullName: "other/cross-owner" }),
      repo("empty", [DATE], { sizeKb: 0 }),
    ]);
    expect(selectPublicDiscovery(data, config)).toEqual([]);
    expect(
      loadPublicDiscoveryView("data/no-such-history", data, config).rows.map((r) => r.reason)
    ).toEqual(["ranking_unknown", "size_unknown", "cross_owner", "empty"]);
    config.collection.publicDiscoveryMaxSizeKb = 0;
    expect(selectPublicDiscovery(data, config)).toEqual([]);
    expect(loadPublicDiscoveryView("data/no-such-history", data, config).rows[1].reason).toBe(
      "size_unknown"
    );
    const unsafe = metrics([repo("..", [DATE])]);
    expect(selectPublicDiscovery(unsafe, config)).toEqual([]);
  });
});

describe("independent public discovery contract and history", () => {
  const config = defaultConfig();
  const selected = metrics([repo("a"), repo("b")]);
  const heads = { "acme/a": A, "acme/b": B };
  const edge = {
    source: "acme/a",
    target: "acme/b",
    kind: "artifact dependency",
    confidence: "medium",
    evidence: [
      {
        consumer_file: "package.json",
        consumed: "another",
        producer_file: "package.json",
        produced: "package",
        secret: "do not publish",
      },
    ],
  };
  let root: string;
  beforeEach(() => {
    fs.mkdirSync("data", { recursive: true });
    root = fs.mkdtempSync(path.resolve("data", "discovery-test-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("extracts only allowlisted bounded facts and matched public file evidence", () => {
    const raw = scanner([fullRepo("acme/a", A), fullRepo("acme/b", B)], [edge]);
    const scan = validatePublicDiscoveryOutput(raw, selected, config, heads);
    expect(scan.connections).toEqual([
      {
        source: "acme/a",
        target: "acme/b",
        evidence: [{ consumer_file: "package.json", producer_file: "package.json" }],
      },
    ]);
    savePublicDiscoveryScan(root, selected, scan);
    const contents = fs.readFileSync(discoveryLatestPath(root, "acme"), "utf8");
    expect(contents).not.toMatch(
      /README|SECRET|AGENTS\.md|author|hotspot|consumed|produced|estimated_code_lines/
    );
    expect(Object.keys(JSON.parse(contents).repositories[0])).toEqual([
      "full_name",
      "head_sha",
      "files",
      "bytes",
      "source_loc",
      "languages",
      "commits_30d",
      "commits_90d",
      "commits_90d_trend",
      "contributor_count",
      "adr_count",
      "manifest_count",
      "produces_count",
      "consumes_count",
    ]);
  });

  it("validates every scanner language and retains the top five by LOC, not file count", () => {
    const first = fullRepo("acme/a", A);
    first.languages = [
      { name: "A", files: 100, loc: 10 },
      { name: "B", files: 90, loc: 20 },
      { name: "C", files: 80, loc: 30 },
      { name: "D", files: 70, loc: 40 },
      { name: "G", files: 60, loc: 50 },
      { name: "E", files: 1, loc: 50 },
      { name: "F", files: 1, loc: 100 },
    ];
    first.metrics = { ...first.metrics, files: 402, source_loc: 300 };
    const scan = validatePublicDiscoveryOutput(
      scanner([first, fullRepo("acme/b", B)]),
      selected,
      config,
      heads
    );
    expect(scan.repositories[0].languages.map(({ name }) => name)).toEqual([
      "F",
      "E",
      "G",
      "D",
      "C",
    ]);
    savePublicDiscoveryScan(root, selected, scan);
    expect(
      JSON.parse(fs.readFileSync(discoveryLatestPath(root, "acme"), "utf8")).repositories[0]
        .languages.map(({ name }: { name: string }) => name)
    ).toEqual(["F", "E", "G", "D", "C"]);
  });

  it("keeps CI-derived artifact evidence without calling it a manifest", () => {
    const consumer = fullRepo("acme/a", A);
    const producer = fullRepo("acme/b", B);
    consumer.consumes = [{ name: "build", source: ".github/workflows/use.yml" }];
    producer.produces = [{ name: "build", source: ".github/workflows/upload.yml" }];
    const ciEdge = {
      ...edge,
      evidence: [
        {
          consumer_file: ".github/workflows/use.yml",
          consumed: "build",
          producer_file: ".github/workflows/upload.yml",
          produced: "build",
        },
      ],
    };
    const scan = validatePublicDiscoveryOutput(
      scanner([consumer, producer], [ciEdge]),
      selected,
      config,
      heads
    );
    expect(scan.repositories[0]).toMatchObject({ manifest_count: 1, consumes_count: 1 });
    expect(scan.repositories[1]).toMatchObject({ manifest_count: 1, produces_count: 1 });
    expect(scan.connections[0].evidence).toEqual([
      {
        consumer_file: ".github/workflows/use.yml",
        producer_file: ".github/workflows/upload.yml",
      },
    ]);
    expect(JSON.stringify(scan)).not.toContain('"build"');
  });

  it("accepts the CLI's second-resolution timestamp after a millisecond-resolution DevEx collection", () => {
    const recent = { ...selected, collectedAt: "2026-09-29T12:05:00.500Z" };
    expect(
      validatePublicDiscoveryOutput(
        scanner([fullRepo("acme/a", A), fullRepo("acme/b", B)]),
        recent,
        config,
        heads
      ).repositories
    ).toHaveLength(2);
  });

  it.each([
    [
      (raw: Record<string, unknown>) => {
        (raw.provenance as Record<string, unknown>).source = "github_api";
      },
      /local_git/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.provenance as Record<string, unknown>).analysis = "ai_only";
      },
      /local_git/,
    ],
    [
      (raw: Record<string, unknown>) => {
        raw.scanner_version = "0.0.0";
      },
      /version/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.repositories as Record<string, unknown>[])[0].head_sha = B;
      },
      /unpinned/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.repositories as Record<string, unknown>[])[0].metrics = {};
      },
      /files/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.repositories as Record<string, unknown>[])[0].git = {};
      },
      /trend/,
    ],
    [
      (raw: Record<string, unknown>) => {
        const first = (raw.repositories as Record<string, unknown>[])[0];
        (first.languages as unknown[]).push({ name: "unranked", files: 0, loc: -1 });
      },
      /language loc/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.repositories as Record<string, unknown>[])[0].analysis_warnings = [
          { reason: "partial" },
        ];
      },
      /partial/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.repositories as unknown[]).pop();
      },
      /cover/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.selection as Record<string, unknown>).selected_repositories = ["acme/a"];
      },
      /selection/,
    ],
    [
      (raw: Record<string, unknown>) => {
        (raw.edges as unknown[]).push({ ...edge, target: "acme/private" });
      },
      /selected/,
    ],
    [
      (raw: Record<string, unknown>) => {
        const first = (raw.repositories as Record<string, unknown>[])[0];
        first.consumes = [{ name: "another", source: "../private/file" }];
        (raw.edges as Record<string, unknown>[])[0].evidence = [
          {
            consumer_file: "../private/file",
            consumed: "another",
            producer_file: "package.json",
            produced: "package",
          },
        ];
      },
      /safe relative path/,
    ],
  ])("fails closed on malformed CLI provenance, coverage, facts or evidence", (change, message) => {
    const raw = scanner([fullRepo("acme/a", A), fullRepo("acme/b", B)], [edge]) as Record<
      string,
      unknown
    >;
    change(raw);
    expect(() => validatePublicDiscoveryOutput(raw, selected, config, heads)).toThrow(message);
    expect(fs.existsSync(discoveryLatestPath(root, "acme"))).toBe(false);
  });

  it("scrubs latest and retained snapshots, including connections, and compares the last successful observation", () => {
    const first = validatePublicDiscoveryOutput(
      scanner([fullRepo("acme/a", A), fullRepo("acme/b", B)], [edge]),
      selected,
      config,
      heads
    );
    savePublicDiscoveryScan(root, selected, first);
    const second = parsePublicDiscoveryScan({
      ...first,
      generated_at: "2026-09-30T12:00:00Z",
      repositories: first.repositories.map((item) => ({ ...item, files: item.files + 2 })),
    });
    savePublicDiscoveryScan(root, selected, second);
    savePublicDiscoveryStatus(root, "acme", false);
    expect(loadPublicDiscoveryStatus(root, "acme")).toMatchObject({
      ok: false,
      last_success_at: second.generated_at,
    });
    expect(loadPublicDiscoveryView(root, selected, config).rows[0].delta).toMatchObject({
      files: 2,
      compared_at: first.generated_at,
    });
    expect(scrubPublicDiscovery(root, "acme", ["acme/a"])).toBe(3);
    const folder = path.join(path.dirname(discoveryLatestPath(root, "acme")), "snapshots");
    for (const file of [
      discoveryLatestPath(root, "acme"),
      ...fs.readdirSync(folder).map((entry) => path.join(folder, entry)),
    ]) {
      const contents = fs.readFileSync(file, "utf8");
      expect(contents).not.toContain("acme/b");
      expect(JSON.parse(contents).connections).toEqual([]);
    }
  });

  it("scrubs changed visibility before ingestion through a failed positive API check", async () => {
    const data = metrics([repo("a"), repo("b")]);
    savePublicDiscoveryScan(
      root,
      data,
      validatePublicDiscoveryOutput(
        scanner([fullRepo("acme/a", A), fullRepo("acme/b", B)], [edge]),
        data,
        config,
        heads
      )
    );
    const api = {
      rest: {
        repos: {
          get: vi.fn(async ({ repo }: { repo: string }) => ({
            data: { private: repo === "b", full_name: `acme/${repo}` },
          })),
        },
      },
    } as unknown as Pick<Octokit, "rest">;
    expect(await recheckPublicDiscovery(root, data, config, api)).toEqual(["acme/b"]);
    expect(fs.readFileSync(discoveryLatestPath(root, "acme"), "utf8")).not.toContain("acme/b");
  });
});
