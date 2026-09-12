import { describe, it, expect } from "vitest";
import { slugifyDatasetKey } from "./dataset-key.js";

describe("slugifyDatasetKey", () => {
  it("lowercases and keeps simple alphanumeric names as-is", () => {
    expect(slugifyDatasetKey("acme")).toBe("acme");
  });

  it("lowercases mixed-case names", () => {
    expect(slugifyDatasetKey("Acme")).toBe("acme");
  });

  it("replaces spaces and punctuation with dashes", () => {
    expect(slugifyDatasetKey("My Cool Group!")).toBe("my-cool-group");
  });

  it("collapses consecutive separators and trims leading/trailing dashes", () => {
    expect(slugifyDatasetKey("  --Foo__Bar--  ")).toBe("foo-bar");
  });

  it("falls back to 'group' for an empty/unusable name", () => {
    expect(slugifyDatasetKey("   ")).toBe("group");
  });
});
