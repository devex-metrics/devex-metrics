import { describe, it, expect } from "vitest";
import { getJS } from "./scripts.js";

describe("getJS", () => {
  it("returns a non-empty client-side script", () => {
    const js = getJS();
    expect(typeof js).toBe("string");
    expect(js.length).toBeGreaterThan(1000);
  });

  it("wires up the DOMContentLoaded bootstrap sequence", () => {
    const js = getJS();
    expect(js).toContain('document.addEventListener("DOMContentLoaded"');
    expect(js).toContain("setupFilter()");
    expect(js).toContain("applyFilter(readStateFromUrl())");
  });

  it("defines the shareable-URL state helpers", () => {
    const js = getJS();
    expect(js).toContain("function readStateFromUrl()");
    expect(js).toContain("function writeStateToUrl(");
    expect(js).toContain("function setupShare()");
  });

  it("defines the chart rendering entry points", () => {
    const js = getJS();
    expect(js).toContain("function renderCharts()");
    expect(js).toContain("function renderDeliveryCharts()");
  });
});
