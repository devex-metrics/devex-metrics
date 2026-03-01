"""
GitHub CLI authentication integration.

Uses the GitHub CLI (`gh`) to obtain authentication tokens without requiring
users to manage personal access tokens.
"""

import subprocess
from typing import Optional


class AuthenticationError(Exception):
    """Raised when GitHub authentication fails."""

    pass


def get_github_token() -> str:
    """
    Get GitHub access token from GitHub CLI.

    Returns:
        GitHub personal access token.

    Raises:
        AuthenticationError: If GitHub CLI is not installed or not authenticated.
    """
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            raise AuthenticationError(
                "GitHub CLI not authenticated. Please run: gh auth login --scopes repo,read:org,security_events"
            )

        token = result.stdout.strip()
        if not token:
            raise AuthenticationError("GitHub CLI returned an empty token.")

        return token

    except FileNotFoundError:
        raise AuthenticationError(
            "GitHub CLI (gh) not found. Please install it from https://cli.github.com/"
        )


def check_authentication() -> dict[str, any]:
    """
    Check GitHub CLI authentication status and return detailed information.

    Returns:
        Dictionary with authentication details:
        - authenticated: bool
        - token: Optional[str]
        - scopes: list[str]
        - user: Optional[str]

    Raises:
        AuthenticationError: If unable to check authentication status.
    """
    try:
        # Get authentication status
        status_result = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True,
            text=True,
            check=False,
        )

        authenticated = status_result.returncode == 0

        if not authenticated:
            return {
                "authenticated": False,
                "token": None,
                "scopes": [],
                "user": None,
            }

        # Get token
        token = get_github_token()

        # Parse status output for user and scopes
        status_output = status_result.stderr  # gh auth status writes to stderr
        user = None
        scopes = []

        for line in status_output.split("\n"):
            if "Logged in to github.com as" in line:
                user = line.split("as")[1].strip().split(" ")[0]
            elif "Token scopes:" in line:
                scopes_str = line.split("Token scopes:")[1].strip()
                scopes = [s.strip() for s in scopes_str.split(",")]

        return {
            "authenticated": True,
            "token": token,
            "scopes": scopes,
            "user": user,
        }

    except FileNotFoundError:
        raise AuthenticationError(
            "GitHub CLI (gh) not found. Please install it from https://cli.github.com/"
        )


def verify_required_scopes(required_scopes: Optional[list[str]] = None) -> tuple[bool, list[str]]:
    """
    Verify that the current token has required scopes.

    Args:
        required_scopes: List of required scopes. Defaults to ['repo', 'read:org', 'security_events'].

    Returns:
        Tuple of (has_required_scopes, missing_scopes).

    Raises:
        AuthenticationError: If unable to check authentication status.
    """
    if required_scopes is None:
        required_scopes = ["repo", "read:org", "security_events"]

    auth_info = check_authentication()

    if not auth_info["authenticated"]:
        return False, required_scopes

    current_scopes = set(auth_info["scopes"])
    required = set(required_scopes)

    missing = required - current_scopes

    return len(missing) == 0, list(missing)
