/**
 * Utilities for safely serializing dynamic values into Markdown table cells.
 *
 * GitHub-flavoured Markdown tables use `|` as the column separator and each
 * physical source line as one row. Any dynamic text written verbatim into a
 * cell — a PR title, an author name, a branch name, etc. — can therefore
 * corrupt the table structure if it contains a `|` or a line break.
 *
 * These helpers are the single serialization boundary for that concern:
 * escape a raw value exactly once, at the point it is written into a table
 * cell (directly via {@link escapeMarkdownTableCell}, or implicitly via
 * {@link renderMarkdownTableRow}). Do not escape values earlier — e.g. when
 * collecting them from GitHub or persisting them to history — and do not
 * pass an already-serialized cell back through these functions, which would
 * double-escape it.
 */

/**
 * Serialize one raw value for use as a single Markdown table cell.
 *
 * Normalization policy, applied in this exact order:
 *
 * 1. `null` and `undefined` become the empty string — this project's
 *    established convention for an absent table value (e.g. a PR with no
 *    merge date already renders as an empty cell).
 * 2. The value is converted to text with `String(value)`.
 * 3. CRLF, LF, CR, and tab characters are each replaced with a single
 *    space, so one logical cell can never introduce another physical
 *    Markdown row or a stray tab.
 * 4. Runs of whitespace created by step 3 (or already present) are
 *    collapsed to a single space, and the result is trimmed. This keeps
 *    "First line\n\nSecond line" as "First line Second line" — one row —
 *    without otherwise reformatting ordinary text.
 * 5. Backslashes are escaped first (`\` → `\\`), then literal pipe
 *    characters are escaped (`|` → `\|`). Doing backslashes first means an
 *    already-escaped pipe in raw text (`value\|other`) still ends up with
 *    its pipe unambiguously escaped, rather than accidentally left bare.
 *
 * Ordinary Unicode text outside of the characters above is left untouched.
 *
 * This function operates on one cell value only. Never call it on an
 * already-assembled `| a | b |` row — that would escape the intentional
 * column-separator pipes. Use {@link renderMarkdownTableRow} to build a
 * full row from raw cell values instead.
 */
export function escapeMarkdownTableCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : JSON.stringify(value);
  const normalized = text
    .replace(/\r\n|\r|\n|\t/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return normalized.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Render a complete Markdown table row from raw cell values.
 *
 * Each cell is serialized independently with {@link escapeMarkdownTableCell}
 * before the cells are joined with the table's `|` separators, so callers
 * can never forget to escape a field. Pass raw, unescaped values — do not
 * pre-escape a cell before handing it to this function.
 */
export function renderMarkdownTableRow(cells: readonly unknown[]): string {
  return `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`;
}
