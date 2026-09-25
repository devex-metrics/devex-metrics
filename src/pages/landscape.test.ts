import { JSDOM } from "jsdom";
import { buildLandscapeSection } from "./landscape.js";
import type { LandscapeRepoView } from "../types.js";

const SHA = "a".repeat(40);

function observed(): LandscapeRepoView {
  return {
    fullName: "acme/public",
    status: "observed",
    collectedAt: "2026-09-25T10:30:00.000Z",
    scannerVersion: "0.1.0",
    headSha: SHA,
    files: [
      {
        path: 'docs/<script>alert("x")</script>.md',
        kind: "instructions",
        sha256: "b".repeat(64),
        last_changed: null,
        age_days: null,
        lag_days: null,
        stale: null,
        status: "partial_unknown",
      },
    ],
    summary: {
      count: 1,
      stale_count: 0,
      max_lag_days: null,
      unknown_count: 1,
      status: "unknown",
    },
    drift: {
      compared_at: "2026-09-24T10:30:00.000Z",
      compared_head_sha: "c".repeat(40),
      added: ['docs/<script>alert("x")</script>.md'],
      removed: ["AGENTS.md"],
      content_changed: [],
    },
  };
}

describe("landscape dashboard view", () => {
  it("renders observed file-level drift, provenance and unknowns without HTML injection", () => {
    const html = buildLandscapeSection([
      observed(),
      { fullName: "acme/private", status: "unknown", reason: "private" },
      { fullName: "acme/denied", status: "unknown", reason: "denied" },
      { fullName: "acme/missing", status: "unknown", reason: "not_scanned" },
    ]);
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector(".landscape-path")?.textContent).toContain(
      '<script>alert("x")</script>'
    );
    expect(doc.querySelector("details summary")?.getAttribute("aria-label")).toBe(
      "View AI instruction files for acme/public"
    );
    expect(doc.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(doc.querySelector("table")?.getAttribute("aria-label")).toBe(
      "AI instruction file observations by repository"
    );
    expect(doc.querySelector(".landscape-coverage")?.textContent).toContain("1 / 4 observed");
    expect(doc.querySelectorAll(".landscape-unknown")).toHaveLength(3);
    expect(html).toContain("Compared with");
    expect(html).toContain("2026-09-24T10:30:00.000Z");
    expect(html).toContain("Removed since comparison");
    expect(html).toContain("Unknown");
    expect(html).not.toContain("0 AI files");
  });

  it("distinguishes an empty selected scope from unknown observations", () => {
    const doc = new JSDOM(buildLandscapeSection([])).window.document;
    expect(doc.querySelector(".landscape-empty")?.textContent).toContain(
      "No repositories are selected"
    );
    expect(doc.querySelector(".landscape-table")).toBeNull();
  });

  it("surfaces an observed zero and first baseline without claiming drift", () => {
    const row = observed();
    row.files = [];
    row.summary = {
      count: 0,
      stale_count: 0,
      unknown_count: 0,
      max_lag_days: null,
      status: "known",
    };
    row.drift = undefined;
    const html = buildLandscapeSection([row]);
    expect(html).toContain("0 observed");
    expect(html).toContain("First observation; no comparison yet");
    expect(html).toContain("No AI instruction files observed at this commit.");
  });
});
