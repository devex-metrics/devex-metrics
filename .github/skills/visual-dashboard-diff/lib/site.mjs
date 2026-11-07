import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Builds the dashboard the way CI does — `tsc`, then `dist/build-pages.js` —
 * but from a committed fixture, so two runs of the same code produce the same
 * HTML. Nothing about the page is re-implemented here, which is what makes the
 * screenshots honest: if the site build changes, the screenshot changes.
 */

/**
 * The build runs code from the tree under review (the compiled `src/`), so it
 * is started with a minimal environment: only what Node and the OS need, never
 * a token from the operator's shell. Names match exactly, case-insensitively
 * on Windows. This is not isolation — the build runs as the operator's user —
 * it only keeps credentials from being handed over by accident.
 */
const ENV_ALLOWLIST = [
  "PATH",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "LANG",
  "LC_ALL",
  "CI",
];

export function childEnv(extra = {}) {
  const env = {};
  const allowed = new Set(ENV_ALLOWLIST);
  for (const [name, value] of Object.entries(process.env)) {
    const key = process.platform === "win32" ? name.toUpperCase() : name;
    if (allowed.has(key)) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Joins `relativePath` onto `root` and refuses a result outside `root`. */
export function resolveInside(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "" || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative path, got ${JSON.stringify(relativePath)}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, relativePath);
  const rel = path.relative(base, resolved);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`${label} ${JSON.stringify(relativePath)} resolves outside ${base}`);
  }
  if (fs.existsSync(resolved)) {
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(resolved);
    const realRel = path.relative(realBase, real);
    if (realRel === ".." || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) {
      throw new Error(`${label} ${JSON.stringify(relativePath)} links outside ${base}`);
    }
  }
  return resolved;
}

/** Compiles `src/` to `dist/` in `tree` with the tree's own TypeScript. */
export function compileTree(tree) {
  const tsc = path.join(tree, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) {
    throw new Error(`${tree} has no node_modules/typescript — run npm ci there first`);
  }
  execFileSync(process.execPath, [tsc, "-p", tree], {
    cwd: tree,
    env: childEnv(),
    stdio: ["ignore", "inherit", "inherit"],
  });
}

/**
 * The schema version the tree expects, read from the constant in `src/cache.ts`.
 *
 * The fixture is stamped with it before the build so a schema bump in a branch
 * does not break the visual diff: each side builds from the fixture at *its
 * own* version. Fields a newer schema introduced are simply absent, which the
 * dashboard handles the way it handles any older snapshot.
 */
export function readSchemaVersion(tree) {
  const source = fs.readFileSync(path.join(tree, "src", "cache.ts"), "utf8");
  const match = /export const CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/.exec(source);
  if (!match) throw new Error(`Could not find CURRENT_SCHEMA_VERSION in ${tree}/src/cache.ts`);
  return Number(match[1]);
}

/**
 * Builds the site for one view and returns the path of a copy of its
 * `index.html`.
 *
 * `build-pages.js` resolves data from the history store first, so the fixture
 * is placed as `<historyDir>/<owner>/latest.json` in a temporary directory —
 * no file is written into the tree's `data/` and `DEVEX_USE_FIXTURE` stays
 * off. The config file is the skill's own, named explicitly so a developer's
 * local `devex.config.json` cannot leak branding or scope into a screenshot.
 *
 * The build writes `_site/` inside `tree` (that path is fixed in
 * build-pages.ts); `_site/` is gitignored and `npm run serve:local` rebuilds
 * it, so the clobber is harmless but worth knowing about.
 */
export function buildSite({ tree, viewId, fixturePath, configPath, workDir }) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const owner = fixture.owner;
  if (typeof owner !== "string" || !/^[A-Za-z0-9_-]+$/.test(owner)) {
    throw new Error(`fixture ${fixturePath} must carry a plain "owner" (letters, digits, _ and -)`);
  }
  fixture.schemaVersion = readSchemaVersion(tree);

  const historyDir = path.join(workDir, "history");
  fs.mkdirSync(path.join(historyDir, owner), { recursive: true });
  fs.writeFileSync(path.join(historyDir, owner, "latest.json"), JSON.stringify(fixture));

  const buildScript = path.join(tree, "dist", "build-pages.js");
  if (!fs.existsSync(buildScript)) {
    throw new Error(`${buildScript} is missing — compile the tree first (tsc)`);
  }
  execFileSync(process.execPath, [buildScript, owner], {
    cwd: tree,
    env: childEnv({
      DEVEX_HISTORY_DIR: historyDir,
      DEVEX_CONFIG_FILE: configPath,
      DEVEX_OWNER: owner,
    }),
    stdio: ["ignore", "inherit", "inherit"],
  });

  const html = path.join(tree, "_site", "index.html");
  if (!fs.existsSync(html)) throw new Error(`build-pages produced no ${html}`);
  const copy = path.join(workDir, `${viewId}.html`);
  fs.copyFileSync(html, copy);
  return copy;
}
