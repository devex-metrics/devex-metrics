"""
Repository collector for GitHub organizations and users.

Fetches repository metadata, detects inactive repos.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from devex_metrics.collectors.base import BaseCollector
from devex_metrics.models import RepositoryMetrics


class RepositoriesCollector(BaseCollector):
    """Collect repository metadata from GitHub organizations or users."""

    def __init__(self, token: str, owner: str, base_url: str = "https://api.github.com"):
        """
        Initialize repository collector.

        Args:
            token: GitHub personal access token.
            owner: GitHub organization or username.
            base_url: GitHub API base URL.
        """
        super().__init__(token, base_url)
        self.owner = owner
        self.owner_type: Optional[str] = None  # 'Organization' or 'User'

    def detect_owner_type(self) -> str:
        """
        Detect if owner is an organization or user.

        Returns:
            'Organization' or 'User'.

        Raises:
            CollectorError: If owner does not exist.
        """
        # Try organization endpoint first
        try:
            self.get(f"/orgs/{self.owner}")
            self.owner_type = "Organization"
            return "Organization"
        except Exception:
            pass

        # Try user endpoint
        try:
            user_data = self.get(f"/users/{self.owner}")
            self.owner_type = user_data.get("type", "User")
            return self.owner_type
        except Exception as e:
            from devex_metrics.collectors.base import CollectorError

            raise CollectorError(
                f"Owner '{self.owner}' not found. "
                f"Ensure the organization/user exists and you have read access. "
                f"Error: {str(e)}"
            )

    def collect(self) -> list[RepositoryMetrics]:
        """
        Collect all repositories for the owner.

        Returns:
            List of RepositoryMetrics instances.
        """
        # Detect owner type if not already known
        if not self.owner_type:
            self.detect_owner_type()

        # Get repositories based on owner type
        if self.owner_type == "Organization":
            endpoint = f"/orgs/{self.owner}/repos"
        else:
            endpoint = f"/users/{self.owner}/repos"

        # Fetch all repos with pagination
        repos_data = self.get_paginated(endpoint, params={"type": "all", "per_page": 100})

        # Convert to RepositoryMetrics
        repositories = []
        for repo in repos_data:
            # Skip archived repos (will be filtered, but track status)
            is_archived = repo.get("archived", False)

            # Check if inactive (no pushes in 90 days)
            pushed_at_str = repo.get("pushed_at")
            last_pushed_at = None
            is_inactive = False

            if pushed_at_str:
                last_pushed_at = datetime.fromisoformat(pushed_at_str.replace("Z", "+00:00"))
                days_since_push = (datetime.now(timezone.utc) - last_pushed_at).days
                is_inactive = days_since_push > 90

            repo_metrics = RepositoryMetrics(
                name=repo["name"],
                full_name=repo["full_name"],
                url=repo["html_url"],
                default_branch=repo.get("default_branch", "main"),
                is_archived=is_archived,
                is_inactive=is_inactive,
                last_pushed_at=last_pushed_at,
            )

            repositories.append(repo_metrics)

        return repositories

    def get_repository(self, repo_name: str) -> dict:
        """
        Get detailed information for a specific repository.

        Args:
            repo_name: Repository name (not full_name).

        Returns:
            Repository data dictionary.
        """
        return self.get(f"/repos/{self.owner}/{repo_name}")
