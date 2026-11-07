import { describe, it, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildDashboardHtml } from "./dashboard.js";
import type { OrgMetrics } from "../types.js";

class FakeChart {
  static instances: FakeChart[] = [];
  static defaults = { plugins: { legend: { labels: {} } } };
  static register(): void {}
  data: { labels?: unknown[]; datasets: unknown[] };
  config: { type: string };
  canvas: { id: string } | null;
  hiddenDatasets = new Set<number>();
  hiddenSegments = new Set<number>();
  destroyed = false;
  options: Record<string, unknown> = {};
  constructor(el: { id: string } | null, cfg: { type: string; data?: FakeChart["data"] }) {
    this.canvas = el;
    this.config = cfg;
    this.data = cfg.data ?? { datasets: [] };
    FakeChart.instances.push(this);
  }
  isDatasetVisible(i: number): boolean {
    return !this.hiddenDatasets.has(i);
  }
  setDatasetVisibility(i: number, visible: boolean): void {
    if (visible) this.hiddenDatasets.delete(i);
    else this.hiddenDatasets.add(i);
  }
  getDataVisibility(i: number): boolean {
    return !this.hiddenSegments.has(i);
  }
  toggleDataVisibility(i: number): void {
    if (!this.hiddenSegments.delete(i)) this.hiddenSegments.add(i);
  }
  update(): void {}
  destroy(): void {
    this.destroyed = true;
  }
}

async function load(options: { storageThrows?: boolean } = {}) {
  FakeChart.instances = [];
  const data: OrgMetrics = {
    owner: "example",
    ownerType: "org",
    collectedAt: new Date().toISOString(),
    repoCount: 0,
    repos: [],
  };
  const html = buildDashboardHtml(data, data.collectedAt.slice(0, 10));
  const errors: string[] = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://example.com/",
    virtualConsole: new VirtualConsole().on("jsdomError", (error: Error) =>
      errors.push(error.message)
    ),
    beforeParse(window) {
      (window as unknown as { Chart: unknown }).Chart = FakeChart;
      Object.defineProperty(window, "matchMedia", {
        value: () => ({ matches: false, addEventListener() {} }),
      });
      if (options.storageThrows) {
        Object.defineProperty(window, "localStorage", {
          value: {
            getItem: () => null,
            setItem: () => {
              throw new Error("denied");
            },
          },
        });
      }
    },
  });
  await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  expect(errors).toEqual([]);
  return dom.window.document;
}

function toggle(doc: Document): HTMLButtonElement {
  const btn = doc.getElementById("themeToggle") as HTMLButtonElement | null;
  if (!btn) throw new Error("theme toggle missing");
  return btn;
}

describe("theme toggle behaviour", () => {
  it("switches theme, rebuilds charts and keeps legend and segment visibility", async () => {
    const doc = await load();
    expect(toggle(doc).getAttribute("aria-label")).toBe("Switch to dark mode");
    const before = FakeChart.instances.length;
    expect(before).toBeGreaterThan(0);
    const issues = FakeChart.instances.find((c) => c.canvas?.id === "chartIssues");
    const prs = FakeChart.instances.find((c) => c.canvas?.id === "chartPRs");
    issues?.setDatasetVisibility(0, false);
    prs?.toggleDataVisibility(1);

    toggle(doc).click();

    expect(doc.documentElement.dataset.theme).toBe("dark");
    expect(toggle(doc).getAttribute("aria-label")).toBe("Switch to light mode");
    expect(issues?.destroyed).toBe(true);
    expect(FakeChart.instances.length).toBeGreaterThan(before);
    const rebuiltIssues = FakeChart.instances.filter((c) => c.canvas?.id === "chartIssues").pop();
    const rebuiltPRs = FakeChart.instances.filter((c) => c.canvas?.id === "chartPRs").pop();
    expect(rebuiltIssues).not.toBe(issues);
    expect(rebuiltIssues?.isDatasetVisible(0)).toBe(false);
    expect(rebuiltPRs?.getDataVisibility(1)).toBe(false);
    expect(rebuiltPRs?.getDataVisibility(0)).toBe(true);
  });

  it("still switches theme when localStorage.setItem throws", async () => {
    const doc = await load({ storageThrows: true });
    toggle(doc).click();
    expect(doc.documentElement.dataset.theme).toBe("dark");
    toggle(doc).click();
    expect(doc.documentElement.dataset.theme).toBe("light");
  });
});
