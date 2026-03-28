import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

let _octokit: Octokit | undefined;

/**
 * Return a lazily-initialised Octokit instance.
 *
 * Authentication is resolved in the following order:
 *
 * 1. **GitHub App** – if both `APP_ID` (repo variable) and `APP_PRIVATE_KEY`
 *    (repo secret) are set, an installation token is minted on the fly.
 *    When `APP_INSTALLATION_ID` is also provided it is used directly;
 *    otherwise the first accessible installation is looked up automatically.
 *
 * 2. **Personal / OAuth token** – falls back to the `GITHUB_TOKEN`
 *    environment variable.
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
  _octokit = new Octokit({ auth: token });
  return _octokit;
}

/**
 * Create an Octokit instance authenticated as a GitHub App installation.
 */
async function createAppOctokit(
  appId: string,
  privateKey: string
): Promise<Octokit> {
  const installationId = process.env.APP_INSTALLATION_ID;

  if (installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId: Number(installationId),
      },
    });
  }

  // Look up the first installation automatically.
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });

  const { data: installations } =
    await appOctokit.rest.apps.listInstallations({ per_page: 1 });

  if (installations.length === 0) {
    throw new Error(
      "No installations found for the GitHub App. " +
        "Install the app on a repository or organisation first, " +
        "or set APP_INSTALLATION_ID explicitly."
    );
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: installations[0].id,
    },
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
