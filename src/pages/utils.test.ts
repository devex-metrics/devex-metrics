import { describe, it, expect } from "vitest";
import {
  GITHUB_MARK_SVG,
  escapeHtml,
  formatDurationHtml,
  computeMedian,
  weekToDate,
} from "./utils.js";

describe("GITHUB_MARK_SVG", () => {
  it("is a non-empty inline SVG", () => {
    expect(GITHUB_MARK_SVG).toContain("<svg");
    expect(GITHUB_MARK_SVG).toContain("</svg>");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes ampersands before other entities so they are not double-escaped", () => {
    expect(escapeHtml("<a href=\"x&y\">")).toBe("&lt;a href=&quot;x&amp;y&quot;&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });

  it("handles an empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("formatDurationHtml", () => {
  it("renders sub-hour durations in minutes", () => {
    expect(formatDurationHtml(0.5)).toBe("30min");
  });

  it("rounds minutes to the nearest whole number", () => {
    expect(formatDurationHtml(0.016)).toBe("1min");
  });

  it("renders durations under a day in hours with one decimal", () => {
    expect(formatDurationHtml(2.5)).toBe("2.5hr");
  });

  it("treats exactly 1 hour as the hours branch, not minutes", () => {
    expect(formatDurationHtml(1)).toBe("1.0hr");
  });

  it("renders durations of a day or more in days", () => {
    expect(formatDurationHtml(48)).toBe("2.0days");
  });

  it("treats exactly 24 hours as the days branch, not hours", () => {
    expect(formatDurationHtml(24)).toBe("1.0days");
  });
});

describe("computeMedian", () => {
  it("returns 0 for an empty array", () => {
    expect(computeMedian([])).toBe(0);
  });

  it("returns the single value for a one-element array", () => {
    expect(computeMedian([7])).toBe(7);
  });

  it("returns the middle value for an odd-length array", () => {
    expect(computeMedian([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for an even-length array", () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate the input array", () => {
    const values = [3, 1, 2];
    computeMedian(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("weekToDate", () => {
  it("returns the Monday of the given ISO week", () => {
    // 2026-W01 starts on Monday 2025-12-29 per the ISO week-date system.
    const date = weekToDate("2026-W01");
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(11);
    expect(date.getUTCDate()).toBe(29);
    expect(date.getUTCDay()).toBe(1);
  });

  it("computes a mid-year week correctly", () => {
    const date = weekToDate("2026-W10");
    expect(date.toISOString().slice(0, 10)).toBe("2026-03-02");
  });
});
