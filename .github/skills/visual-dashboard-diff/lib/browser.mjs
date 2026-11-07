import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves Playwright's `chromium` without adding it to package.json.
 *
 * devex-metrics does not depend on Playwright and should not have to: this
 * harness is developer/CI tooling, not shipped code. So we look for an
 * existing install — the repo's own node_modules, the pinned install CI uses
 * under `.github/workflows/dependencies/playwright`, or a global one.
 */
function globalNpmRoot() {
  const nodeDir = path.dirname(process.execPath);
  const cliCandidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = cliCandidates.find((p) => fs.existsSync(p));
  if (cli) {
    try {
      return execFileSync(process.execPath, [cli, "root", "-g"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Fall through to the platform default below.
    }
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "npm", "node_modules");
  }
  return null;
}

export const INSTALL_HINT = [
  "Playwright is required to render the dashboard but was not found.",
  "",
  "Install it globally (it is intentionally not a dependency of devex-metrics):",
  "  npm install -g playwright && npx playwright install chromium",
  "",
  "Or use the pinned install CI uses:",
  "  (cd .github/workflows/dependencies/playwright && npm ci && npx playwright install chromium)",
  "",
  "If a browser is already present elsewhere, point PLAYWRIGHT_BROWSERS_PATH at it.",
].join("\n");

function pinnedWorkflowInstallRoot() {
  return path.join(here, "..", "..", "..", "workflows", "dependencies", "playwright", "node_modules");
}

function candidatePaths() {
  const paths = ["playwright", "@playwright/test", "playwright-core"];
  const pinnedRoot = pinnedWorkflowInstallRoot();
  paths.push(`${pinnedRoot}/playwright`, `${pinnedRoot}/@playwright/test`, `${pinnedRoot}/playwright-core`);
  const globalRoot = globalNpmRoot();
  if (globalRoot) {
    paths.push(`${globalRoot}/playwright`, `${globalRoot}/@playwright/test`, `${globalRoot}/playwright-core`);
  }
  return paths;
}

export function loadChromium() {
  for (const candidate of candidatePaths()) {
    try {
      const mod = require(candidate);
      if (mod && mod.chromium) return mod.chromium;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(INSTALL_HINT);
}

/**
 * Keeps the page off the network except for an explicit allowlist. The
 * dashboard loads Chart.js and its annotation plugin from jsDelivr at pinned
 * versions; nothing else it renders needs more than the local `file://` page,
 * so every other http(s) request and every WebSocket is refused. A blocked
 * request surfaces as a console error, which marks the render `warn` instead
 * of passing silently.
 */
export async function restrictNetwork(context, allowedPrefixes) {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (/^(file|data|blob):/i.test(url) || allowedPrefixes.some((p) => url.startsWith(p))) {
      return route.continue();
    }
    return route.abort("blockedbyclient");
  });
  if (typeof context.routeWebSocket !== "function") {
    throw new Error(
      "This Playwright cannot block WebSockets (routeWebSocket needs Playwright 1.48+); upgrade it to render the dashboard."
    );
  }
  await context.routeWebSocket(/.*/, (ws) => ws.close());
}
