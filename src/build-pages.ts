import * as fs from "node:fs";
import * as path from "node:path";
import { generateReport } from "./report.js";
import type { CacheEnvelope } from "./types.js";

/**
 * Build a static GitHub Pages site from cached metrics data.
 *
 * Usage:
 *   node dist/build-pages.js <owner>
 *
 * Reads data/<owner>.json and writes an HTML page to _site/index.html.
 */
function main(): void {
  const owner = process.argv[2];
  if (!owner) {
    console.error("Usage: build-pages <owner>");
    process.exit(1);
  }

  const dataDir = path.resolve(process.cwd(), "data");
  const cacheFile = path.join(dataDir, `${owner}.json`);
  const siteDir = path.resolve(process.cwd(), "_site");

  if (!fs.existsSync(cacheFile)) {
    console.error(`No cached data found at ${cacheFile}`);
    process.exit(1);
  }

  const envelope: CacheEnvelope = JSON.parse(
    fs.readFileSync(cacheFile, "utf-8")
  );
  const markdown = generateReport(envelope.data);

  fs.mkdirSync(siteDir, { recursive: true });

  // Write the Markdown report alongside the HTML
  fs.writeFileSync(path.join(siteDir, "report.md"), markdown);

  // Write a JSON API file so consumers can fetch raw data
  fs.writeFileSync(
    path.join(siteDir, "data.json"),
    JSON.stringify(envelope.data, null, 2)
  );

  // Build a self-contained HTML page
  const html = buildHtml(envelope.data.owner, markdown, envelope.date);
  fs.writeFileSync(path.join(siteDir, "index.html"), html);

  console.log(`GitHub Pages site built in ${siteDir}/`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert a subset of Markdown to HTML (headings, tables, blockquotes,
 * paragraphs). This is intentionally minimal — no external deps needed.
 */
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inTable = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // table separator row — skip
    if (/^\|[\s:\-|]+\|$/.test(line)) {
      continue;
    }

    // table row
    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inTable) {
        out.push("<table>");
        inTable = true;
      }
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      const tag = inTable && out[out.length - 1] === "<table>" ? "th" : "td";
      out.push(
        "  <tr>" +
          cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join("") +
          "</tr>"
      );
      continue;
    }

    if (inTable) {
      out.push("</table>");
      inTable = false;
    }

    if (line.startsWith("### ")) {
      out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("> ")) {
      out.push(`<blockquote>${escapeHtml(line.slice(2))}</blockquote>`);
    } else if (line.trim() === "") {
      // skip blank
    } else {
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inTable) out.push("</table>");
  return out.join("\n");
}

function buildHtml(owner: string, markdown: string, date: string): string {
  const body = markdownToHtml(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DevEx Metrics – ${escapeHtml(owner)}</title>
  <style>
    :root { --bg: #fff; --fg: #24292f; --muted: #57606a; --border: #d0d7de; --accent: #0969da; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d; --accent: #58a6ff; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--fg); background: var(--bg); max-width: 960px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; }
    h1 { margin-bottom: .25rem; }
    h2 { margin-top: 2rem; margin-bottom: .5rem; border-bottom: 1px solid var(--border); padding-bottom: .3rem; }
    h3 { margin-top: 1.5rem; margin-bottom: .4rem; }
    p, blockquote { margin-bottom: .5rem; }
    blockquote { color: var(--muted); border-left: 3px solid var(--border); padding-left: .75rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    th, td { text-align: left; padding: .4rem .6rem; border: 1px solid var(--border); }
    th { background: var(--border); }
    a { color: var(--accent); }
    footer { margin-top: 3rem; color: var(--muted); font-size: .85rem; }
  </style>
</head>
<body>
${body}
<footer>Data cached on ${escapeHtml(date)}. Served via GitHub Pages. <a href="data.json">Raw JSON</a> · <a href="report.md">Markdown</a></footer>
</body>
</html>`;
}

main();
