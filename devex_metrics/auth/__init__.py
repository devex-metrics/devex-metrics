"""GitHub CLI authentication module."""

from devex_metrics.auth.gh_cli import (
    AuthenticationError,
    check_authentication,
    get_github_token,
    verify_required_scopes,
)

__all__ = [
    "AuthenticationError",
    "get_github_token",
    "check_authentication",
    "verify_required_scopes",
]
