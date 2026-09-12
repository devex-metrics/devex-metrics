import * as fs from "node:fs";
import * as path from "node:path";

/** A repository discovered on disk and resolved to its GitHub owner/name. */
export interface DiscoveredRepo {
  /** GitHub owner (org or user) login. */
  owner: string;
  /** GitHub repository name. */
  name: string;
  /** Absolute local path of the discovered repo. */
  localPath: string;
}

/**
 * Parse an "owner/repo" pair out of a GitHub git remote URL.
 * Supports the `git@github.com:owner/repo.git` SSH shorthand as well as
 * `https://`/`ssh://` URLs. Returns null when the URL isn't a recognizable
 * GitHub remote.
 */
export function parseGitHubRemote(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();

  let match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (!match) {
    match = /^(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      trimmed
    );
  }
  if (!match) return null;

  const [, owner, name] = match;
  if (!owner || !name) return null;
  return { owner, name };
}

/**
 * Read the "origin" remote URL from a repo's `.git/config` file.
 * Returns null when the file is missing or has no `[remote "origin"]` section.
 */
function readOriginUrl(gitDir: string): string | null {
  const configPath = path.join(gitDir, "config");
  if (!fs.existsSync(configPath)) return null;

  const content = fs.readFileSync(configPath, "utf-8");
  const sectionMatch = /\[remote "origin"\]([^[]*)/i.exec(content);
  if (!sectionMatch) return null;

  const urlMatch = /^\s*url\s*=\s*(.+)$/m.exec(sectionMatch[1]);
  return urlMatch ? urlMatch[1].trim() : null;
}

/**
 * Scan the immediate subdirectories of `folderPath` for local git
 * repositories and resolve each one to its GitHub owner/repo via the
 * "origin" remote. Directories without a `.git` folder, without an "origin"
 * remote, or whose origin isn't a recognizable GitHub URL are skipped.
 */
export function discoverLocalRepos(folderPath: string): DiscoveredRepo[] {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const results: DiscoveredRepo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(folderPath, entry.name);
    const gitDir = path.join(repoPath, ".git");
    if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) continue;

    const originUrl = readOriginUrl(gitDir);
    if (!originUrl) continue;

    const parsed = parseGitHubRemote(originUrl);
    if (!parsed) continue;

    results.push({ ...parsed, localPath: repoPath });
  }

  return results;
}
