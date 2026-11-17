import { createHash } from "node:crypto";
import type { DevexConfig } from "./config.js";

/** Match aggregate counts to a roster without persisting its GitHub logins. */
export function landscapeRosterKey(handles: readonly string[]): string | undefined {
  const normalized = [...new Set(handles.map((handle) => handle.toLowerCase()))].sort();
  return normalized.length > 0
    ? createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    : undefined;
}

/** Explicit landscape team handles take precedence over the shared focus-group roster. */
export function resolveLandscapeTeam(config: Pick<DevexConfig, "team" | "focus">): {
  handles: readonly string[];
  name: string;
  key: string | undefined;
} {
  const explicit = config.team?.handles ?? [];
  const handles = explicit.length > 0 ? explicit : config.focus?.users ?? [];
  const name = explicit.length > 0 || handles.length === 0
    ? "Team" : config.focus?.name || "Focus group";
  return { handles, name, key: landscapeRosterKey(handles) };
}
