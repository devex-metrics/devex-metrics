import { describe, it, expect } from "vitest";
import { escapeMarkdownTableCell, renderMarkdownTableRow } from "./markdown.js";

describe("escapeMarkdownTableCell", () => {
  it("escapes a pipe in a PR title", () => {
    const input = "UI Composer | Implementation | Side-by-side layout";
    expect(escapeMarkdownTableCell(input)).toBe(
      "UI Composer \\| Implementation \\| Side-by-side layout",
    );
  });

  it("escapes all pipes in a sanitized multi-pipe regression fixture", () => {
    const input = "BU Event Impl | BU Part | Share - Sharing to Room";
    const escaped = escapeMarkdownTableCell(input);
    expect(escaped).not.toMatch(/(?<!\\)\|/);
    expect(escaped).toBe("BU Event Impl \\| BU Part \\| Share - Sharing to Room");
  });

  it("collapses LF line breaks into a single space", () => {
    expect(escapeMarkdownTableCell("First line\nSecond line")).toBe(
      "First line Second line",
    );
  });

  it("collapses CRLF line breaks into a single space", () => {
    expect(escapeMarkdownTableCell("First line\r\nSecond line")).toBe(
      "First line Second line",
    );
  });

  it("collapses CR-only line breaks into a single space", () => {
    expect(escapeMarkdownTableCell("First line\rSecond line")).toBe(
      "First line Second line",
    );
  });

  it("collapses multiple consecutive line breaks into a single space", () => {
    expect(escapeMarkdownTableCell("First line\n\n\nSecond line")).toBe(
      "First line Second line",
    );
  });

  it("does not leave a raw newline in the output", () => {
    const result = escapeMarkdownTableCell("a\nb\r\nc\rd");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\r");
  });

  it("normalizes tabs so they cannot create ambiguous formatting", () => {
    expect(escapeMarkdownTableCell("a\tb")).toBe("a b");
  });

  it("deterministically escapes a backslash immediately followed by a pipe", () => {
    const result = escapeMarkdownTableCell("value\\|other");
    // The literal pipe must never appear unescaped (i.e. not preceded by a backslash).
    expect(result).not.toMatch(/(?<!\\)\|/);
    // Deterministic, single-pass output — not accidentally re-processed.
    expect(result).toBe("value\\\\\\|other");
  });

  it("is idempotent-safe: escaping the already-escaped output again would double-process, so callers must escape only once", () => {
    const once = escapeMarkdownTableCell("a|b");
    expect(once).toBe("a\\|b");
    // Demonstrates why the helper must be applied exactly once: escaping an
    // already-escaped cell again would corrupt it further.
    const twice = escapeMarkdownTableCell(once);
    expect(twice).not.toBe(once);
  });

  it("represents null as the empty-cell convention", () => {
    expect(escapeMarkdownTableCell(null)).toBe("");
  });

  it("represents undefined as the empty-cell convention", () => {
    expect(escapeMarkdownTableCell(undefined)).toBe("");
  });

  it("preserves ordinary Unicode characters", () => {
    expect(escapeMarkdownTableCell("Café · 日本語 · résumé — done ✅")).toBe(
      "Café · 日本語 · résumé — done ✅",
    );
  });

  it("leaves an ordinary title with no special characters unchanged", () => {
    expect(escapeMarkdownTableCell("Add feature X")).toBe("Add feature X");
  });

  it("converts numbers to their string representation", () => {
    expect(escapeMarkdownTableCell(42)).toBe("42");
    expect(escapeMarkdownTableCell(0)).toBe("0");
  });
});

describe("renderMarkdownTableRow", () => {
  it("serializes each cell and joins them with the table separator", () => {
    expect(renderMarkdownTableRow(["a", "b", "c"])).toBe("| a | b | c |");
  });

  it("escapes a pipe inside one cell without corrupting the row's column count", () => {
    const row = renderMarkdownTableRow([
      "#3816 ui-composer-apk 0.22.0: UI Composer | Implementation | Side-by-side layout production hardening",
      "2026-09-09",
      "+2/-2",
      3,
      1,
      -0.02,
    ]);
    expect(countStructuralColumns(row)).toBe(6);
  });

  it("renders a complete PR row with a pipe- and newline-bearing title under the correct columns", () => {
    const row = renderMarkdownTableRow([
      `#3808 wired-source-provider-apk 0.3.0: WSP | Share/unshare video\non DP-in plug/unplug`,
      "2026-09-01",
      "+10/-4",
      2,
      5,
      12.5,
    ]);
    const cells = splitStructuralCells(row);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toBe(
      "#3808 wired-source-provider-apk 0.3.0: WSP \\| Share/unshare video on DP-in plug/unplug",
    );
    expect(cells[1]).toBe("2026-09-01");
    expect(cells[2]).toBe("+10/-4");
    expect(cells[3]).toBe("2");
    expect(cells[4]).toBe("5");
    expect(cells[5]).toBe("12.5");
  });

  it("renders null/undefined cells as empty", () => {
    expect(renderMarkdownTableRow(["a", null, undefined, "d"])).toBe(
      "| a |  |  | d |",
    );
  });
});

// ── Structural table-validation helpers (shared with report.test.ts) ────────

/**
 * Count the number of structural (unescaped) `|` separators in a Markdown
 * table row, treating an escaped `\|` as ordinary cell content rather than a
 * column boundary. Returns the number of columns (separators - 1).
 */
export function countStructuralColumns(row: string): number {
  return splitStructuralCells(row).length;
}

/**
 * Split a single Markdown table row into its cell contents, honoring `\|`
 * as escaped (non-structural) pipe content. Strips the leading/trailing
 * `|` and surrounding whitespace from each cell.
 */
export function splitStructuralCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "\\|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}
