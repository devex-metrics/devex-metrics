import { describe, it, expect } from "vitest";
import { getCSS } from "./styles.js";

describe("getCSS", () => {
  it("returns a non-empty stylesheet", () => {
    const css = getCSS();
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(100);
  });

  it("defines the light and dark colour variable sets", () => {
    const css = getCSS();
    expect(css).toContain(":root");
    expect(css).toContain("prefers-color-scheme:dark");
  });

  it("styles the core layout elements used by the dashboard", () => {
    const css = getCSS();
    expect(css).toContain("body{");
    expect(css).toContain(".hero{");
  });
});
