import { describe, it, expect } from "vitest";
import { getCountFromLinkHeader } from "./link-header.js";

describe("getCountFromLinkHeader", () => {
  it("should return 0 when data is empty and there is no link header", () => {
    const response = { headers: {}, data: [] };
    expect(getCountFromLinkHeader(response)).toBe(0);
  });

  it("should return 1 when data has one item and there is no link header", () => {
    const response = { headers: {}, data: [{ id: 1 }] };
    expect(getCountFromLinkHeader(response)).toBe(1);
  });

  it("should parse the last page number from a Link header", () => {
    const link =
      '<https://api.github.com/repos/owner/repo/issues?state=open&per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repos/owner/repo/issues?state=open&per_page=1&page=42>; rel="last"';
    const response = { headers: { link }, data: [{ id: 1 }] };
    expect(getCountFromLinkHeader(response)).toBe(42);
  });

  it("should handle link header with only a next link (no last)", () => {
    const link =
      '<https://api.github.com/repos/owner/repo/issues?state=open&per_page=1&page=2>; rel="next"';
    const response = { headers: { link }, data: [{ id: 1 }] };
    // No rel="last" → fall back to data length
    expect(getCountFromLinkHeader(response)).toBe(1);
  });

  it("should handle large page numbers", () => {
    const link =
      '<https://api.github.com/repos/owner/repo/issues?state=closed&per_page=1&page=99999>; rel="last"';
    const response = { headers: { link }, data: [{ id: 1 }] };
    expect(getCountFromLinkHeader(response)).toBe(99999);
  });
});
