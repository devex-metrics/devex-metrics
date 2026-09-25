import * as fs from "node:fs";
import * as path from "node:path";
import {
  compareLandscape,
  landscapeLatestPath,
  loadLandscapeView,
  parseLandscapeScan,
  saveLandscapeScan,
  validateLandscapeScannerOutput,
  verifyLandscapeVisibility,
} from "./landscape.js";
import type { OrgMetrics, RepoMetrics } from "./types.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function file(filePath: string, hash = HASH_A) {
  return {
    path: filePath,
    kind: "instructions",
    sha256: hash,
    last_changed: "2026-09-01T00:00:00Z",
    age_days: 20,
    lag_days: 10,
    stale: false,
  };
}

function repository(fullName = "acme/public", files = [file("AGENTS.md")], head = SHA_A) {
  return {
    full_name: fullName,
    head_sha: head,
    ai_files: files,
    ai_summary: {
      count: files.length,
      stale_count: files.filter((f) => f.stale).length,
      max_lag_days: files.length ? 10 : null,
    },
  };
}

function scan(repos: unknown[], at = "2026-09-21T12:00:00Z"): unknown {
  return {
    schema_version: 1,
    generated_at: at,
    scanner_version: "0.1.0",
    repositories: repos,
  };
}

function metrics(repos: { name: string; isPrivate?: boolean }[]): OrgMetrics {
  return {
    owner: "acme",
    ownerType: "org",
    collectedAt: "2026-09-19T11:00:00Z",
    repoCount: repos.length,
    repos: repos.map(({ name, isPrivate }): RepoMetrics => ({
      name,
      fullName: `acme/${name}`,
      isPrivate,
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, closed: 0, merged: 0 },
      pullRequestDetails: [],
      committerCount: 0,
      reviewerCount: 0,
      contributorCount: 0,
      dependentCount: 0,
    })),
  };
}

describe("portable landscape v1 validation and sanitation", () => {
  it("keeps only approved metadata, sorts repos/files, and counts unknown file history", () => {
    const unknownFile = {
      ...file("nested/AGENTS.md", HASH_B),
      last_changed: null,
      age_days: null,
      lag_days: null,
      stale: null,
      status: "unknown",
      content: "MUST NEVER PUBLISH",
    };
    const source = scan([
      { ...repository("acme/z", []), evidence: { content: "SECRET" } },
      {
        ...repository("acme/a", [unknownFile, file("AGENTS.md")]),
        ai_summary: {
          count: 2,
          stale_count: 0,
          max_lag_days: 10,
          unknown_count: 1,
          status: "partial_unknown",
        },
      },
    ]);
    const result = parseLandscapeScan(source);
    expect(result.repositories.map((r) => r.full_name)).toEqual(["acme/a", "acme/z"]);
    const observed = result.repositories[0];
    expect("head_sha" in observed && observed.ai_files.map((f) => f.path)).toEqual([
      "AGENTS.md",
      "nested/AGENTS.md",
    ]);
    expect("head_sha" in observed && observed.ai_summary).toMatchObject({
      count: 2,
      stale_count: 0,
      unknown_count: 1,
      status: "partial_unknown",
    });
    expect(JSON.stringify(result)).not.toContain("MUST NEVER PUBLISH");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it.each([
    [scan([], "not-a-date"), /generated_at/],
    [{ ...(scan([]) as object), schema_version: 2 }, /schema_version/],
    [scan([repository("acme/a"), repository("ACME/A")]), /duplicate repositories/],
    [scan([repository("acme/a", [file("../secret")])]), /relative Git path/],
    [
      scan([{ ...repository(), ai_summary: { count: 0, stale_count: 0, max_lag_days: 10 } }]),
      /disagrees/,
    ],
    [
      scan([repository("acme/a", [{ ...file("AGENTS.md"), stale: null, status: "known" }])]),
      /unavailable history/,
    ],
  ])("rejects malformed observations rather than silently recording absence", (source, error) => {
    expect(() => parseLandscapeScan(source)).toThrow(error);
  });

  it("keeps explicit denial as an unknown observation without file metadata", () => {
    expect(
      parseLandscapeScan(
        scan([
          { full_name: "acme/public", status: "denied", ai_files: [file("private/AGENTS.md")] },
        ])
      ).repositories
    ).toEqual([{ full_name: "acme/public", status: "denied" }]);
  });
});

describe("landscape history and DevEx join", () => {
  let root: string;
  beforeEach(() => {
    fs.mkdirSync("data", { recursive: true });
    root = fs.mkdtempSync(path.resolve("data", "landscape-test-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("never persists CLI evidence or repository paths with unverified privacy", () => {
    const data = metrics([
      { name: "public", isPrivate: false },
      { name: "private", isPrivate: true },
    ]);
    expect(() =>
      saveLandscapeScan(root, data, scan([repository("acme/private", [file("secret/AGENTS.md")])]))
    ).toThrow(/verified public/);
    expect(fs.existsSync(landscapeLatestPath(root, "acme"))).toBe(false);

    const raw = scan([{ ...repository(), evidence: "DO NOT PUBLISH", content: "SECRET" }]);
    saveLandscapeScan(root, data, raw);
    expect(fs.readFileSync(landscapeLatestPath(root, "acme"), "utf8")).not.toMatch(
      /DO NOT PUBLISH|SECRET/
    );
    const view = loadLandscapeView(root, data);
    expect(view[1]).toEqual({ fullName: "acme/private", status: "unknown", reason: "private" });
  });

  it("compares each repo with its last successful observation across denied scans", () => {
    const data = metrics([
      { name: "public", isPrivate: false },
      { name: "missing", isPrivate: false },
      { name: "unverified" },
    ]);
    saveLandscapeScan(
      root,
      data,
      scan(
        [
          repository(
            "acme/public",
            [file("AGENTS.md", HASH_A), file(".github/copilot-instructions.md", HASH_A)],
            SHA_A
          ),
          { full_name: "acme/missing", status: "denied" },
        ],
        "2026-09-20T12:00:00Z"
      )
    );
    saveLandscapeScan(
      root,
      data,
      scan(
        [
          { full_name: "acme/public", status: "denied" },
          { full_name: "acme/missing", status: "denied" },
        ],
        "2026-09-21T12:00:00Z"
      )
    );
    expect(loadLandscapeView(root, data)[0]).toMatchObject({
      status: "unknown",
      reason: "denied",
    });

    saveLandscapeScan(
      root,
      data,
      scan(
        [
          repository(
            "ACME/PUBLIC",
            [file("AGENTS.md", HASH_B), file("docs/CLAUDE.md", HASH_A)],
            SHA_B
          ),
          { full_name: "acme/missing", status: "denied" },
        ],
        "2026-09-22T12:00:00Z"
      )
    );
    const view = loadLandscapeView(root, data);
    expect(view[0]).toMatchObject({
      fullName: "acme/public",
      status: "observed",
      collectedAt: "2026-09-22T12:00:00.000Z",
      headSha: SHA_B,
      scannerVersion: "0.1.0",
      drift: {
        compared_at: "2026-09-20T12:00:00.000Z",
        compared_head_sha: SHA_A,
        added: ["docs/CLAUDE.md"],
        removed: [".github/copilot-instructions.md"],
        content_changed: ["AGENTS.md"],
      },
    });
    expect(view[1]).toMatchObject({
      fullName: "acme/missing",
      status: "unknown",
      reason: "denied",
    });
    expect(view[2]).toEqual({
      fullName: "acme/unverified",
      status: "unknown",
      reason: "visibility_unknown",
    });
  });

  it("distinguishes a successful empty observation from a missing scan and first baseline", () => {
    const data = metrics([{ name: "public", isPrivate: false }]);
    expect(loadLandscapeView(root, data)[0]).toMatchObject({
      status: "unknown",
      reason: "not_scanned",
    });
    saveLandscapeScan(root, data, scan([repository("acme/public", [])]));
    expect(loadLandscapeView(root, data)[0]).toMatchObject({
      status: "observed",
      summary: { count: 0 },
      files: [],
    });
    expect(loadLandscapeView(root, data)[0].drift).toBeUndefined();
  });

  it("treats a missing repository in an older stored scan as unknown, not zero files", () => {
    const data = metrics([
      { name: "public", isPrivate: false },
      { name: "missing", isPrivate: false },
    ]);
    const latest = landscapeLatestPath(root, "acme");
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.writeFileSync(latest, JSON.stringify(scan([repository()])));
    expect(loadLandscapeView(root, data)[1]).toEqual({
      fullName: "acme/missing",
      status: "unknown",
      reason: "not_scanned",
    });
  });

  it("rejects rollback to an older scan without overwriting the latest observation", () => {
    const data = metrics([{ name: "public", isPrivate: false }]);
    saveLandscapeScan(root, data, scan([repository()], "2026-09-22T12:00:00Z"));
    expect(() =>
      saveLandscapeScan(
        root,
        data,
        scan([repository("acme/public", [], SHA_B)], "2026-09-21T12:00:00Z")
      )
    ).toThrow(/older/);
    expect(loadLandscapeView(root, data)[0].headSha).toBe(SHA_A);
  });

  it("accepts a scan rounded to the same second as DevEx collection", () => {
    const data = metrics([{ name: "public", isPrivate: false }]);
    data.collectedAt = "2026-09-21T12:00:00.789Z";
    expect(() =>
      saveLandscapeScan(root, data, scan([repository()], "2026-09-21T12:00:00Z"))
    ).not.toThrow();
    expect(() =>
      saveLandscapeScan(root, data, scan([repository()], "2026-09-21T11:59:59Z"))
    ).toThrow(/predates/);
  });

  it("rejects a partial scanner response instead of publishing a success-shaped snapshot", () => {
    const data = metrics([
      { name: "public", isPrivate: false },
      { name: "missing", isPrivate: false },
    ]);
    expect(() => saveLandscapeScan(root, data, scan([repository()]))).toThrow(
      /cover every selected public/
    );
    expect(fs.existsSync(landscapeLatestPath(root, "acme"))).toBe(false);
  });
});

it("hash drift is independent of file age and stale flags", () => {
  const old = parseLandscapeScan(scan([repository()])).repositories[0];
  const recent = parseLandscapeScan(
    scan([
      {
        ...repository("acme/public", [{ ...file("AGENTS.md"), age_days: 1, lag_days: 0 }], SHA_B),
        ai_summary: { count: 1, stale_count: 0, max_lag_days: 0 },
      },
    ])
  ).repositories[0];
  if (!("head_sha" in old) || !("head_sha" in recent)) throw new Error("Expected observed repos");
  expect(compareLandscape(recent, old, "2026-09-21T12:00:00Z")).toEqual({
    compared_at: "2026-09-21T12:00:00Z",
    compared_head_sha: SHA_A,
    added: [],
    removed: [],
    content_changed: [],
  });
});

describe("visibility re-check before ingestion", () => {
  const publicScan = parseLandscapeScan(scan([repository("acme/public")]));
  it("accepts a still-public repository and rejects a privacy change", async () => {
    const get = vi.fn().mockResolvedValue({
      data: { full_name: "acme/public", private: false },
    });

    const octokit = { rest: { repos: { get } } } as Parameters<typeof verifyLandscapeVisibility>[1];
    await expect(verifyLandscapeVisibility(publicScan, octokit)).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledWith({ owner: "acme", repo: "public" });
    get.mockResolvedValue({ data: { full_name: "acme/public", private: true } });
    await expect(verifyLandscapeVisibility(publicScan, octokit)).rejects.toThrow(
      /no longer verified public/
    );
  });

  describe("v1 engine output compatibility", () => {
    const data = metrics([{ name: "public", isPrivate: false }]);
    const engineOutput = {
      ...scan([
        {
          ...repository("acme/public", [
            {
              ...file("AGENTS.md"),
              status: "unknown",
              last_changed: null,
              age_days: null,
              lag_days: null,
              stale: null,
              unknown_reason: "history_unavailable",
              evidence: { source: "github_api", blob_sha: SHA_A, head_sha: SHA_A },
            },
          ]),
          head_committed_at: "2026-09-21T11:00:00Z",
          ai_summary: {
            count: 1,
            stale_count: 0,
            max_lag_days: null,
            unknown_count: 1,
            status: "partial_unknown",
          },
        },
      ]),
      provenance: {
        source: "github_api",
        snapshot: "pinned_head",
        analysis: "ai_only",
        stale_after_days: 90,
      },
      selection: {
        mode: "explicit",
        explicit_repositories: ["acme/public"],
        discovery: [],
        selected_repositories: ["acme/public"],
      },
      edges: [],
    };

    it("accepts the released portable payload and drops provenance/evidence from public files", () => {
      const parsed = validateLandscapeScannerOutput(engineOutput, data, 90, "0.1.0");
      expect(parsed.repositories[0]).toMatchObject({
        full_name: "acme/public",
        ai_summary: { count: 1, unknown_count: 1, status: "partial_unknown" },
      });
      expect(JSON.stringify(parsed)).not.toContain("evidence");
      expect(JSON.stringify(parsed)).not.toContain("unknown_reason");
      expect(JSON.stringify(parsed)).not.toContain("head_committed_at");
    });

    it.each([
      [
        { ...engineOutput, provenance: { ...engineOutput.provenance, source: "local_git" } },
        /provenance/,
      ],
      [
        {
          ...engineOutput,
          selection: { ...engineOutput.selection, selected_repositories: ["acme/private"] },
        },
        /selection/,
      ],
      [{ ...engineOutput, scanner_version: "9.9.9" }, /version/],
      [{ ...engineOutput, edges: [{ source: "acme/public", target: "acme/private" }] }, /edges/],
    ])("rejects an unexpected scanner mode, selection, version or edges", (raw, error) => {
      expect(() => validateLandscapeScannerOutput(raw, data, 90, "0.1.0")).toThrow(error);
    });
  });

  it("fails closed on a denied or missing GitHub API response", async () => {
    const get = vi.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const octokit = { rest: { repos: { get } } } as Parameters<typeof verifyLandscapeVisibility>[1];
    await expect(verifyLandscapeVisibility(publicScan, octokit)).rejects.toThrow(/Forbidden/);
  });
});
