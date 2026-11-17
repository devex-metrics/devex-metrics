import * as fs from "node:fs";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";

const PRIVATE_STORE_MARKER = ".private-landscape";

/** A restricted store/output remains private even after the deployment policy changes. */
export function hasPrivateLandscapeData(directory: string): boolean {
  return fs.existsSync(path.join(directory, PRIVATE_STORE_MARKER));
}

/** Accept known visibility only; private sources require an explicit opt-in. */
export function landscapeVisibilityAllowed(isPrivate: unknown, includePrivate = false): boolean {
  return isPrivate === false || (includePrivate && isPrivate === true);
}

/** Sticky across config changes and scrubbing: earlier git history may still contain private facts. */
export function markPrivateLandscapeStore(historyDir: string): void {
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, PRIVATE_STORE_MARKER),
    "Private landscape data: publish only to a private repository and private Pages site.\n");
}

/** Verify the actual destination, not caller-supplied visibility claims, before publishing private facts. */
export async function assertLandscapePublication(
  historyDir: string,
  includePrivate: boolean,
  env: NodeJS.ProcessEnv = process.env,
  client?: Pick<Octokit, "rest">
): Promise<void> {
  if (!includePrivate && !hasPrivateLandscapeData(historyDir)) return;
  const destination = env.GITHUB_REPOSITORY;
  const token = env.DEVEX_PUBLICATION_TOKEN;
  if (!destination || !/^[^/\s]+\/[^/\s]+$/.test(destination) || !token) {
    throw new Error("Private landscape requires GITHUB_REPOSITORY and DEVEX_PUBLICATION_TOKEN to verify the publication destination");
  }
  const [owner, repo] = destination.split("/");
  const octokit = client ?? new Octokit({
    auth: token, baseUrl: env.GITHUB_API_URL || "https://api.github.com",
    request: { timeout: 20_000 },
  });
  const repository = await octokit.rest.repos.get({ owner, repo });
  if (repository.data.private !== true ||
      repository.data.full_name.toLowerCase() !== destination.toLowerCase()) {
    throw new Error("Private landscape publication requires a verified private destination repository");
  }
  const pages = await octokit.rest.repos.getPages({ owner, repo });
  if (pages.data.public !== false) {
    throw new Error("Private landscape publication requires access-controlled GitHub Pages (public=false)");
  }
}
