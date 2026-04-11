import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { throttling } from "@octokit/plugin-throttling";

const ThrottledOctokit = Octokit.plugin(throttling);

/** Default number of retries for rate-limit and abuse responses. */
const DEFAULT_RETRIES = 3;

/** Convert a duration in seconds to a human-readable string (e.g. "45 minutes 57 seconds"). */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hour${h !== 1 ? "s" : ""}`);
  if (m > 0) parts.push(`${m} minute${m !== 1 ? "s" : ""}`);
  if (s > 0 || parts.length === 0) parts.push(`${s} second${s !== 1 ? "s" : ""}`);
  return parts.join(" ");
}

/** Return the UTC timestamp at which a retry will resume (now + retryAfter seconds). */
export function formatResumeTime(retryAfter: number): string {
  const resumeAt = new Date(Date.now() + retryAfter * 1000);
  return resumeAt.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/**
 * Build the `throttle` options shared by every Octokit instance.
 *
 * When the primary rate limit is hit (403 with `x-ratelimit-remaining: 0`),
 * or a secondary / abuse limit is triggered (429 / "Retry-After"), the
 * plugin automatically waits for the reset window and retries the request
 * up to `retries` times.
 */
function throttleOptions(retries = DEFAULT_RETRIES) {
  return {
    onRateLimit: (
      retryAfter: number,
      options: Record<string, unknown>,
      _octokit: unknown,
      retryCount: number,
    ) => {
      const method = (options.method ?? "UNKNOWN") as string;
      const url = (options.url ?? "UNKNOWN") as string;
      console.warn(
        `Rate limit hit for ${method} ${url}. ` +
          `Retrying after ${formatDuration(retryAfter)} (attempt ${retryCount + 1}/${retries})…\n` +
          `Will continue at ${formatResumeTime(retryAfter)} (UTC)`,
      );
      return retryCount < retries;
    },
    onSecondaryRateLimit: (
      retryAfter: number,
      options: Record<string, unknown>,
      _octokit: unknown,
      retryCount: number,
    ) => {
      const method = (options.method ?? "UNKNOWN") as string;
      const url = (options.url ?? "UNKNOWN") as string;
      console.warn(
        `Secondary rate limit hit for ${method} ${url}. ` +
          `Retrying after ${formatDuration(retryAfter)} (attempt ${retryCount + 1}/${retries})…\n` +
          `Will continue at ${formatResumeTime(retryAfter)} (UTC)`,
      );
      return retryCount < retries;
    },
  };
}

let _octokit: Octokit | undefined;

/**
 * Return a lazily-initialised Octokit instance.
 *
 * Authentication is resolved in the following order:
 *
 * 1. **GitHub App** – if both `APP_ID` (repo variable) and `APP_PRIVATE_KEY`
 *    (repo secret) are set, the first accessible installation is looked up
 *    and an installation token is minted on the fly.
 *
 * 2. **Personal / OAuth token** – falls back to the `GITHUB_TOKEN`
 *    environment variable.
 *
 * Rate limiting is handled automatically via `@octokit/plugin-throttling`.
 * When GitHub returns a 403 (primary rate limit) or 429 (secondary / abuse
 * limit), the client waits for the reset window and retries up to 3 times.
 */
export async function getOctokit(): Promise<Octokit> {
  if (_octokit) {
    return _octokit;
  }

  const appId = process.env.APP_ID;
  const privateKey = process.env.APP_PRIVATE_KEY;

  if (appId && privateKey) {
    _octokit = await createAppOctokit(appId, privateKey);
    return _octokit;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Authentication required. Either set APP_ID and APP_PRIVATE_KEY " +
        "environment variables for GitHub App auth, or set GITHUB_TOKEN " +
        "to a personal access token."
    );
  }
  _octokit = new ThrottledOctokit({
    auth: token,
    throttle: throttleOptions(),
  });
  return _octokit;
}

/**
 * Create an Octokit instance authenticated as a GitHub App installation.
 * The installation ID is retrieved automatically at runtime.
 */
async function createAppOctokit(
  appId: string,
  privateKey: string
): Promise<Octokit> {
  const appOctokit = new ThrottledOctokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
    throttle: throttleOptions(),
  });

  const { data: installations } =
    await appOctokit.rest.apps.listInstallations({ per_page: 1 });

  if (installations.length === 0) {
    throw new Error(
      "No installations found for the GitHub App. " +
        "Install the app on a repository or organisation first."
    );
  }

  return new ThrottledOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: installations[0].id,
    },
    throttle: throttleOptions(),
  });
}

/**
 * Allow tests to inject a mock Octokit instance.
 */
export function setOctokit(octokit: Octokit): void {
  _octokit = octokit;
}

/**
 * Reset the singleton (useful in tests).
 */
export function resetOctokit(): void {
  _octokit = undefined;
}
