import { JSDOM } from "jsdom";
import { buildLandscapeSection } from "./landscape.js";
import { getLandscapeControlsJS } from "./landscape-controls.js";
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
        status: "unknown",
      },
    ],
    summary: {
      count: 1,
      stale_count: 0,
      max_lag_days: null,
      unknown_count: 1,
      status: "partial_unknown",
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

function mount(rows: LandscapeRepoView[]): JSDOM {
  const dom = new JSDOM(buildLandscapeSection(rows), { runScripts: "outside-only" });
  dom.window.eval(getLandscapeControlsJS());
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom;
}

function visibleNames(dom: JSDOM): string[] {
  return Array.from(dom.window.document.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr"))
    .filter((row) => !row.hidden)
    .map((row) => row.cells[0].textContent ?? "");
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
    expect(doc.querySelectorAll("#landscapeRows > tr .landscape-unknown")).toHaveLength(12);
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

  it("marks the data as stale with the failed run when the latest attempt failed", () => {
    const html = buildLandscapeSection([observed()], {
      attempted_at: "2026-09-27T06:00:00.000Z",
      ok: false,
      run_url: "https://github.com/acme/devex/actions/runs/42",
      last_success_at: "2026-09-26T06:00:00.000Z",
    });
    const doc = new JSDOM(html).window.document;
    const notice = doc.querySelector(".landscape-stale");
    expect(notice?.textContent).toContain("Stale data");
    expect(notice?.textContent).toContain("2026-09-27 06:00 UTC");
    expect(notice?.textContent).toContain("last successful scan at 2026-09-26 06:00 UTC");
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/devex/actions/runs/42"
    );
  });

  it("shows no stale notice after a successful attempt", () => {
    const html = buildLandscapeSection([observed()], {
      attempted_at: "2026-09-27T06:00:00.000Z",
      ok: true,
      last_success_at: "2026-09-27T06:00:00.000Z",
    });
    expect(html).not.toContain("landscape-stale");
  });

  it("paginates 143 visibility-unverified rows without inventing observations or exposing names in controls", () => {
    const rows: LandscapeRepoView[] = Array.from({ length: 143 }, (_, i) => ({
      fullName: `acme/repo-${String(i).padStart(3, "0")}`,
      status: "unknown",
      reason: "visibility_unknown",
    }));
    const dom = mount(rows);
    const doc = dom.window.document;
    const next = doc.querySelector<HTMLButtonElement>("#landscapeNext")!;
    const prev = doc.querySelector<HTMLButtonElement>("#landscapePrev")!;
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 1–20 of 143 repositories");
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 8");
    expect(prev.disabled).toBe(true);
    expect(doc.querySelector(".landscape-coverage")?.textContent).toBe("0 / 143 observed");
    expect(doc.querySelectorAll("#landscapeRows tr:not([hidden]) .landscape-unknown")).toHaveLength(80);
    expect(doc.querySelector(".landscape-pagination")?.outerHTML).not.toContain("acme/");
    expect(doc.querySelectorAll(".landscape-sort")).toHaveLength(5);
    for (let i = 0; i < 7; i++) next.click();
    expect(visibleNames(dom)).toHaveLength(3);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 141–143 of 143 repositories");
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 8 of 8");
    expect(next.disabled).toBe(true);
    prev.click();
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 121–140 of 143 repositories");
  });

  it("sorts all columns stably, puts unknown values last, resets page on sort, and clears sort", () => {
    const first = observed();
    first.fullName = "acme/z-10";
    const second = observed();
    second.fullName = "acme/a-2";
    second.summary = { count: 3, stale_count: 0, max_lag_days: null, unknown_count: 0, status: "known" };
    second.drift = {
      compared_at: first.collectedAt!,
      compared_head_sha: SHA,
      added: ["AGENTS.md"], removed: ["CLAUDE.md"], content_changed: ["README.md"],
    };
    second.collectedAt = "2026-09-27T10:30:00.000Z";
    const unknown: LandscapeRepoView = { fullName: "acme/b-1", status: "unknown", reason: "visibility_unknown" };
    const rows = [
      first, unknown, second,
      ...Array.from({ length: 19 }, (_, i): LandscapeRepoView => ({
        fullName: `acme/extra-${i}`, status: "unknown", reason: "not_scanned",
      })),
    ];
    const dom = mount(rows);
    const doc = dom.window.document;
    doc.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 2 of 2");
    const sort = (key: string) =>
      doc.querySelector<HTMLButtonElement>(`.landscape-sort[data-landscape-sort="${key}"]`)!;
    sort("count").click();
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/a-2", "acme/z-10", "acme/b-1"]);
    expect(sort("count").closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(doc.querySelector("#landscapeSortStatus")?.textContent).toContain("descending");
    sort("count").click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/z-10", "acme/a-2", "acme/b-1"]);
    expect(sort("count").closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    sort("changes").click();
    expect(visibleNames(dom)[0]).toBe("acme/a-2");
    sort("observed").click();
    expect(visibleNames(dom)[0]).toBe("acme/a-2");
    sort("detail").click();
    expect(visibleNames(dom).slice(0, 2)).toEqual(["acme/z-10", "acme/a-2"]);
    sort("name").click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/a-2", "acme/b-1", "acme/extra-0"]);
    expect(sort("name").getAttribute("aria-label")).toContain("descending");
    doc.querySelector<HTMLButtonElement>("#landscapeSortReset")!.click();
    expect(visibleNames(dom).slice(0, 3)).toEqual(["acme/z-10", "acme/b-1", "acme/a-2"]);
    expect(doc.querySelector("#landscapeSortStatus")?.textContent).toBe("Original order");
    expect(sort("name").closest("th")?.hasAttribute("aria-sort")).toBe(false);
    expect(doc.querySelector<HTMLButtonElement>("#landscapeSortReset")!.disabled).toBe(true);
  });

  it("keeps observed zero files distinct from unknowns and preserves source order for ties", () => {
    const zero = observed();
    zero.fullName = "acme/zero";
    zero.summary = {
      count: 0, stale_count: 0, unknown_count: 0, max_lag_days: null, status: "known",
    };
    zero.files = [];
    const tied = observed();
    tied.fullName = "acme/tied";
    const unknown: LandscapeRepoView = {
      fullName: "acme/unverified", status: "unknown", reason: "visibility_unknown",
    };
    const dom = mount([unknown, tied, zero, observed()]);
    const button = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-landscape-sort="count"]'
    )!;
    button.click();
    expect(visibleNames(dom)).toEqual(["acme/tied", "acme/public", "acme/zero", "acme/unverified"]);
    button.click();
    expect(visibleNames(dom)).toEqual(["acme/zero", "acme/tied", "acme/public", "acme/unverified"]);
    expect(dom.window.document.querySelectorAll("#landscapeRows > tr")).toHaveLength(4);
  });

  it("labels failed scans as attempts without treating them as observations", () => {
    const old = observed();
    old.fullName = "acme/old";
    old.collectedAt = "2026-09-23T10:30:00.000Z";
    const recent = observed();
    recent.fullName = "acme/recent";
    const dom = mount([
      { fullName: "acme/denied", status: "unknown", reason: "denied", collectedAt: "2026-09-29T10:30:00.000Z" },
      old,
      { fullName: "acme/failed", status: "unknown", reason: "scan_error", collectedAt: "2026-09-30T10:30:00.000Z" },
      recent,
      { fullName: "acme/unverified", status: "unknown", reason: "visibility_unknown" },
    ]);
    const doc = dom.window.document;
    const rows = Array.from(doc.querySelectorAll<HTMLTableRowElement>("#landscapeRows > tr"));
    expect(rows.filter((row) => row.dataset.landscapeObserved === "")).toHaveLength(3);
    for (const [name, timestamp] of [
      ["acme/denied", "2026-09-29T10:30:00.000Z"],
      ["acme/failed", "2026-09-30T10:30:00.000Z"],
    ]) {
      const row = rows.find((candidate) => candidate.cells[0].textContent === name)!;
      expect(row.cells[1].textContent).toContain(`scan attempted ${timestamp.slice(0, 10)}`);
      expect(row.cells[1].querySelector("time")?.dateTime).toBe(timestamp);
      expect(row.cells[3].textContent?.trim()).toBe("—");
      expect(row.cells[3].querySelector("time")).toBeNull();
    }
    const button = doc.querySelector<HTMLButtonElement>('[data-landscape-sort="observed"]')!;
    button.click();
    expect(visibleNames(dom)).toEqual([
      "acme/recent", "acme/old", "acme/denied", "acme/failed", "acme/unverified",
    ]);
    button.click();
    expect(visibleNames(dom)).toEqual([
      "acme/old", "acme/recent", "acme/denied", "acme/failed", "acme/unverified",
    ]);
  });

  it("re-sorts inserted rows with missing metadata after known numeric and date values", async () => {
    const old = observed();
    old.fullName = "acme/old";
    old.collectedAt = "2026-09-23T10:30:00.000Z";
    const recent = observed();
    recent.fullName = "acme/recent";
    recent.summary = { count: 3, stale_count: 0, max_lag_days: null, unknown_count: 0, status: "known" };
    const dom = mount([
      old, recent,
      ...Array.from({ length: 18 }, (_, i): LandscapeRepoView => ({
        fullName: `acme/unverified-${i}`, status: "unknown", reason: "visibility_unknown",
      })),
    ]);
    const doc = dom.window.document;
    const tbody = doc.querySelector("#landscapeRows")!;
    const sort = (key: string) => doc.querySelector<HTMLButtonElement>(`[data-landscape-sort="${key}"]`)!;
    const names = () => Array.from((tbody as HTMLTableSectionElement).rows, (row) => row.cells[0].textContent);
    const insert = (name: string, known = false) => {
      const row = doc.createElement("tr");
      row.innerHTML = `<th scope="row">${name}</th><td>—</td><td>—</td><td>—</td><td>—</td>`;
      if (known) {
        row.dataset.landscapeCount = "2";
        row.dataset.landscapeObserved = "2026-09-24T10:30:00.000Z";
      }
      tbody.prepend(row);
    };
    const flush = async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)); };

    sort("count").click();
    insert("acme/missing-count");
    await flush();
    insert("acme/middle", true);
    await flush();
    expect(names().slice(0, 3)).toEqual(["acme/recent", "acme/middle", "acme/old"]);
    expect(names().at(-1)).toBe("acme/missing-count");
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 1–20 of 22 repositories");
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    sort("count").click();
    expect(names().slice(0, 3)).toEqual(["acme/old", "acme/middle", "acme/recent"]);
    expect(names().at(-1)).toBe("acme/missing-count");

    sort("observed").click();
    insert("acme/missing-date");
    await flush();
    expect(names().slice(0, 3)).toEqual(["acme/recent", "acme/middle", "acme/old"]);
    expect(names().slice(-2)).toEqual(["acme/missing-count", "acme/missing-date"]);
    expect(visibleNames(dom)).toHaveLength(20);
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
    doc.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    expect(visibleNames(dom)).toHaveLength(3);
    expect(doc.querySelector("#landscapeRange")?.textContent).toBe("Showing 21–23 of 23 repositories");
    sort("observed").click();
    expect(names().slice(0, 3)).toEqual(["acme/old", "acme/middle", "acme/recent"]);
    expect(names().slice(-2)).toEqual(["acme/missing-count", "acme/missing-date"]);
    expect(doc.querySelector("#landscapePage")?.textContent).toBe("Page 1 of 2");
  });

  it("updates page counts when rows change and keeps the empty selected scope free of controls", async () => {
    const empty = mount([]);
    expect(empty.window.document.querySelector("#landscapeRows")).toBeNull();
    expect(empty.window.document.querySelector("#landscapePrev")).toBeNull();

    const dom = mount(Array.from({ length: 21 }, (_, i) => ({
      fullName: `acme/repo-${i}`, status: "unknown", reason: "visibility_unknown",
    })));
    dom.window.document.querySelector<HTMLButtonElement>("#landscapeNext")!.click();
    dom.window.document.querySelector("#landscapeRows tr:not([hidden])")!.remove();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    expect(visibleNames(dom)).toHaveLength(20);
    expect(dom.window.document.querySelector("#landscapeRange")?.textContent).toBe(
      "Showing 1–20 of 20 repositories"
    );
    expect(dom.window.document.querySelector<HTMLButtonElement>("#landscapeNext")!.disabled).toBe(true);
    const added = dom.window.document.createElement("tr");
    added.innerHTML = '<th scope="row">acme/new</th><td>Not scanned</td><td>—</td><td>—</td><td>—</td>';
    dom.window.document.querySelector("#landscapeRows")!.appendChild(added);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    expect(dom.window.document.querySelector("#landscapeRange")?.textContent).toBe(
      "Showing 1–20 of 21 repositories"
    );
    expect(dom.window.document.querySelector<HTMLButtonElement>("#landscapeNext")!.disabled).toBe(false);
  });
});
