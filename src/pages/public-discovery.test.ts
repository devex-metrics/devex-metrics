import { JSDOM } from "jsdom";
import { buildPublicDiscoverySection, getPublicDiscoveryControlsJS } from "./public-discovery.js";
import type { PublicDiscoveryRepoView } from "../types.js";

function observed(): PublicDiscoveryRepoView {
  return {
    fullName: "acme/consumer",
    status: "observed",
    observation: {
      full_name: "acme/consumer",
      head_sha: "a".repeat(40),
      files: 4,
      bytes: 128,
      source_loc: 20,
      languages: [{ name: "TS<script>", files: 2, loc: 20 }],
      commits_30d: 1,
      commits_90d: 2,
      commits_90d_trend: [...Array(88).fill(0), 1, 1],
      contributor_count: 1,
      adr_count: 0,
      manifest_count: 1,
      produces_count: 1,
      consumes_count: 1,
    },
  };
}

describe("public discovery bottom panel", () => {
  it("renders bounded facts and heuristic public evidence with escaped names", () => {
    const rows: PublicDiscoveryRepoView[] = [
      observed(),
      { fullName: "acme/huge", status: "unknown", reason: "oversized" },
      { fullName: "acme/unselected", status: "unknown", reason: "not_selected" },
    ];
    const html = buildPublicDiscoverySection(
      rows,
      [
        {
          source: "acme/consumer",
          target: "acme/producer",
          evidence: [
            { consumer_file: 'pkg/<script>alert("x")</script>', producer_file: "package.json" },
          ],
        },
      ],
      {
        attempted_at: "2026-09-30T12:00:00.000Z",
        ok: false,
        last_success_at: "2026-09-29T12:00:00.000Z",
      }
    );
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector(".landscape-stale")?.textContent).toContain("Stale discovery");
    expect(doc.querySelector(".discovery-unknown")?.textContent).toContain("Over size limit");
    expect(doc.querySelector("#discoveryRows")?.textContent).toContain(
      "Outside the ranked scan cap"
    );
    expect(doc.querySelector(".discovery-connections")?.textContent).toContain(
      'pkg/<script>alert("x")</script>'
    );
    expect(doc.querySelector(".discovery-detail")?.textContent).toContain("TS<script>");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("not a verified runtime dependency");
    expect(doc.querySelector(".discovery-trend")?.getAttribute("aria-label")).toContain("13 weeks");
    expect(doc.querySelector(".discovery-table")?.textContent).toContain(
      "1 lifetime commit authors"
    );
    expect(doc.querySelector("#discoveryRows")?.textContent).not.toContain("0 files");
  });

  it("has independent paginated rows and a valid empty state", () => {
    const rows = Array.from({ length: 41 }, (_, index): PublicDiscoveryRepoView => ({
      fullName: `acme/repo-${index}`,
      status: "unknown",
      reason: "not_selected",
    }));
    const dom = new JSDOM(buildPublicDiscoverySection(rows, []), { runScripts: "outside-only" });
    dom.window.eval(getPublicDiscoveryControlsJS());
    const doc = dom.window.document;
    const visible = () =>
      [...doc.querySelectorAll<HTMLTableRowElement>("#discoveryRows > tr")].filter(
        (row) => !row.hidden
      ).length;
    expect(visible()).toBe(20);
    doc.getElementById("discoveryNext")!.click();
    expect(visible()).toBe(20);
    doc.getElementById("discoveryNext")!.click();
    expect(visible()).toBe(1);
    expect(doc.getElementById("discoveryRange")?.textContent).toBe(
      "Showing 41–41 of 41 repositories"
    );
    expect(
      new JSDOM(buildPublicDiscoverySection([], [])).window.document.querySelector(
        ".landscape-empty"
      )
    ).not.toBeNull();
  });
});
