import { Octokit } from "@octokit/rest";

let _octokit: Octokit | undefined;

/**
 * Return a lazily-initialised Octokit instance.
 * Reads the token from the GITHUB_TOKEN environment variable.
 */
export function getOctokit(): Octokit {
  if (!_octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "GITHUB_TOKEN environment variable is required. " +
          "Set it to a GitHub personal access token or OAuth app token."
      );
    }
    _octokit = new Octokit({ auth: token });
  }
  return _octokit;
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
