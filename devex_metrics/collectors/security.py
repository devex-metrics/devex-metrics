"""
Security collector for code scanning, Dependabot, and secret scanning.

Fetches security scanning status and alerts from GitHub.
"""

from typing import Optional

from devex_metrics.collectors.base import BaseCollector


class SecurityCollector(BaseCollector):
    """Collect security scanning information from GitHub repositories."""

    def __init__(self, token: str, owner: str, base_url: str = "https://api.github.com"):
        """
        Initialize security collector.

        Args:
            token: GitHub personal access token.
            owner: GitHub organization or username.
            base_url: GitHub API base URL.
        """
        super().__init__(token, base_url)
        self.owner = owner

    def get_code_scanning_alerts(self, repo_name: str) -> list[dict]:
        """
        Get code scanning alerts for a repository.

        Args:
            repo_name: Repository name.

        Returns:
            List of code scanning alert dictionaries.
        """
        try:
            return self.get_paginated(f"/repos/{self.owner}/{repo_name}/code-scanning/alerts")
        except Exception:
            # Code scanning might not be enabled
            return []

    def is_code_scanning_enabled(self, repo_name: str) -> bool:
        """
        Check if code scanning is enabled.

        Args:
            repo_name: Repository name.

        Returns:
            True if code scanning is enabled, False otherwise.
        """
        try:
            # If we can fetch alerts, code scanning is enabled
            self.get(f"/repos/{self.owner}/{repo_name}/code-scanning/alerts", params={"per_page": 1})
            return True
        except Exception:
            return False

    def get_dependabot_alerts(self, repo_name: str) -> list[dict]:
        """
        Get Dependabot alerts for a repository.

        Args:
            repo_name: Repository name.

        Returns:
            List of Dependabot alert dictionaries.
        """
        try:
            return self.get_paginated(f"/repos/{self.owner}/{repo_name}/dependabot/alerts")
        except Exception:
            # Dependabot might not be enabled
            return []

    def is_dependabot_enabled(self, repo_name: str) -> bool:
        """
        Check if Dependabot is enabled.

        Args:
            repo_name: Repository name.

        Returns:
            True if Dependabot is enabled, False otherwise.
        """
        try:
            # Check if we can access Dependabot alerts
            self.get(f"/repos/{self.owner}/{repo_name}/dependabot/alerts", params={"per_page": 1})
            return True
        except Exception:
            return False

    def get_secret_scanning_alerts(self, repo_name: str) -> list[dict]:
        """
        Get secret scanning alerts for a repository.

        Args:
            repo_name: Repository name.

        Returns:
            List of secret scanning alert dictionaries.
        """
        try:
            return self.get_paginated(f"/repos/{self.owner}/{repo_name}/secret-scanning/alerts")
        except Exception:
            # Secret scanning might not be enabled
            return []

    def is_secret_scanning_enabled(self, repo_name: str) -> bool:
        """
        Check if secret scanning is enabled.

        Args:
            repo_name: Repository name.

        Returns:
            True if secret scanning is enabled, False otherwise.
        """
        try:
            # Check if we can access secret scanning alerts
            self.get(
                f"/repos/{self.owner}/{repo_name}/secret-scanning/alerts", params={"per_page": 1}
            )
            return True
        except Exception:
            return False

    def get_security_summary(self, repo_name: str) -> dict[str, any]:
        """
        Get comprehensive security summary for a repository.

        Args:
            repo_name: Repository name.

        Returns:
            Dictionary with security status:
            - code_scanning_enabled: bool
            - code_scanning_alerts_count: int
            - dependabot_enabled: bool
            - dependabot_alerts_count: int
            - secret_scanning_enabled: bool
            - secret_scanning_alerts_count: int
        """
        code_scanning_enabled = self.is_code_scanning_enabled(repo_name)
        dependabot_enabled = self.is_dependabot_enabled(repo_name)
        secret_scanning_enabled = self.is_secret_scanning_enabled(repo_name)

        return {
            "code_scanning_enabled": code_scanning_enabled,
            "code_scanning_alerts_count": (
                len(self.get_code_scanning_alerts(repo_name)) if code_scanning_enabled else 0
            ),
            "dependabot_enabled": dependabot_enabled,
            "dependabot_alerts_count": (
                len(self.get_dependabot_alerts(repo_name)) if dependabot_enabled else 0
            ),
            "secret_scanning_enabled": secret_scanning_enabled,
            "secret_scanning_alerts_count": (
                len(self.get_secret_scanning_alerts(repo_name)) if secret_scanning_enabled else 0
            ),
        }
