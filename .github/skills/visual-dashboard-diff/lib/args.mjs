import fs from "node:fs";
import path from "node:path";

/** Parses `--key value` and `--flag` arguments into a plain object. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/**
 * A numeric option, checked rather than passed through `Number()`: a typo
 * there yields NaN, and every comparison against NaN is false — which in a
 * diff tolerance means "nothing changed".
 */
export function parseNumberOption(value, name, { fallback, min, max }) {
  if (value === undefined) return fallback;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`--${name} must be a number from ${min} to ${max}, got ${JSON.stringify(value)}.`);
  }
  return n;
}

/**
 * The colour schemes the dashboard renders. Its stylesheet keys everything on
 * `prefers-color-scheme`, so a theme is just what the page is told it prefers.
 * Both names end up in screenshot file names, so only these exact values pass.
 */
export const THEMES = ["light", "dark"];

/** `--theme light|dark|both` (default light) → the themes to render. */
export function parseThemes(value) {
  if (value === undefined) return ["light"];
  if (value === "both" || value === "all") return [...THEMES];
  if (THEMES.includes(value)) return [value];
  throw new Error(`--theme must be one of ${THEMES.join(", ")} or both, got ${JSON.stringify(value)}.`);
}

/**
 * A view or state id becomes part of a file name (`<view>--<state>.<theme>.png`)
 * and of a temp path, so it is held to a strict allowlist: no separators, no
 * dots, no `--` (the view/state delimiter), and unique within its scope.
 */
export const ID_PATTERN = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$/;

export function validateRegistry(config) {
  const seenViews = new Set();
  for (const view of config.views || []) {
    if (typeof view.id !== "string" || !ID_PATTERN.test(view.id)) {
      throw new Error(
        `views.config.json: view id ${JSON.stringify(view.id)} must match ${ID_PATTERN} (letters, digits, _ and single dashes)`
      );
    }
    if (seenViews.has(view.id)) throw new Error(`views.config.json: duplicate view id "${view.id}"`);
    seenViews.add(view.id);
    if (typeof view.expect !== "string" || view.expect.trim() === "") {
      throw new Error(`views.config.json: view "${view.id}" must declare a non-empty "expect" selector`);
    }
    const seenStates = new Set();
    for (const state of view.states || []) {
      if (typeof state.id !== "string" || !ID_PATTERN.test(state.id)) {
        throw new Error(
          `views.config.json: state id ${JSON.stringify(state.id)} on view "${view.id}" must match ${ID_PATTERN}`
        );
      }
      if (seenStates.has(state.id)) {
        throw new Error(`views.config.json: duplicate state id "${state.id}" on view "${view.id}"`);
      }
      seenStates.add(state.id);
      // Without `expect`, a state whose steps silently fail would screenshot
      // the initial render and pass as "unchanged" forever — the exact blind
      // spot states exist to remove.
      if (typeof state.expect !== "string" || state.expect.trim() === "") {
        throw new Error(
          `views.config.json: state "${state.id}" on view "${view.id}" must declare a non-empty "expect" selector`
        );
      }
    }
  }
  return config;
}

/**
 * Reads a view registry. `configPath` overrides the skill's own
 * `views.config.json`, which is how the visual diff renders a baseline from a
 * registry assembled for the base commit (see `baselineRegistry`).
 */
export function readConfig(skillDir, configPath) {
  const file = configPath || path.join(skillDir, "views.config.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  // `fixtureDir` says where a view's fixture and config file are read from.
  // Only a registry `baselineRegistry` generates may set it; a committed
  // views.config.json that names one could point the harness anywhere on disk.
  const views =
    configPath || !Array.isArray(config.views)
      ? config.views
      : config.views.map(({ fixtureDir, ...view }) => view);
  return validateRegistry({ defaults: config.defaults || {}, views: views || [] });
}

/**
 * The registry to render a *baseline* from: the base commit's own registry
 * (its states, steps, fixtures) so the old site is driven the way the old
 * registry drove it, plus every view and state only the current registry
 * declares, flagged `currentOnly` so `--allow-missing` can skip them when
 * they cannot render on the base tree. Views and states only the base
 * declares stay in, so something the branch removed is reported as removed
 * rather than vanishing from both sides as "no change".
 */
export function baselineRegistry(current, base, { baseFixtureDir, currentFixtureDir }) {
  const clone = (v) => ({ ...v, states: (v.states || []).map((s) => ({ ...s })) });
  if (!base) {
    return validateRegistry({
      defaults: current.defaults,
      views: current.views.map((v) => ({ ...clone(v), currentOnly: true, fixtureDir: currentFixtureDir })),
    });
  }
  const views = (base.views || [])
    .filter((v) => ID_PATTERN.test(String(v.id)))
    .map((v) => ({
      ...clone(v),
      states: (v.states || []).filter((s) => ID_PATTERN.test(String(s.id))).map((s) => ({ ...s })),
      fixtureDir: baseFixtureDir,
    }));
  const byId = new Map(views.map((v) => [v.id, v]));
  for (const currentView of current.views) {
    const baseView = byId.get(currentView.id);
    if (!baseView) {
      views.push({ ...clone(currentView), currentOnly: true, fixtureDir: currentFixtureDir });
      continue;
    }
    const baseStates = new Set(baseView.states.map((s) => s.id));
    for (const state of currentView.states || []) {
      if (!baseStates.has(state.id)) baseView.states.push({ ...state, currentOnly: true });
    }
  }
  return validateRegistry({ defaults: base.defaults || current.defaults, views });
}

/** Picks the views to render: all of them, or the comma-separated `--view` list. */
export function selectViews(config, filter) {
  if (typeof filter === "string" && filter.length > 0) {
    const wanted = new Set(filter.split(",").map((s) => s.trim()).filter(Boolean));
    return config.views.filter((v) => wanted.has(v.id));
  }
  return config.views;
}
