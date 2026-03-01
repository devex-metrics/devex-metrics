"""
Workflow collector for GitHub Actions workflows and runs.

Fetches workflow files, detects deploy workflows using environment keyword.
"""

import base64
from typing import Optional

from devex_metrics.collectors.base import BaseCollector
from devex_metrics.utils.yaml_parser import has_environment_keyword, get_workflow_name


class WorkflowsCollector(BaseCollector):
    """Collect GitHub Actions workflows and workflow runs."""

    def __init__(self, token: str, owner: str, base_url: str = "https://api.github.com"):
        """
        Initialize workflow collector.

        Args:
            token: GitHub personal access token.
            owner: GitHub organization or username.
            base_url: GitHub API base URL.
        """
        super().__init__(token, base_url)
        self.owner = owner

    def get_workflows(self, repo_name: str) -> list[dict]:
        """
        Get all workflows for a repository.

        Args:
            repo_name: Repository name.

        Returns:
            List of workflow metadata dictionaries.
        """
        try:
            data = self.get(f"/repos/{self.owner}/{repo_name}/actions/workflows")
            return data.get("workflows", [])
        except Exception:
            # Some repos may not have Actions enabled
            return []

    def get_workflow_content(self, repo_name: str, workflow_path: str) -> Optional[str]:
        """
        Get workflow file content.

        Args:
            repo_name: Repository name.
            workflow_path: Workflow file path (e.g., '.github/workflows/deploy.yml').

        Returns:
            Workflow file content as string, or None if not found.
        """
        try:
            data = self.get(f"/repos/{self.owner}/{repo_name}/contents/{workflow_path}")

            # Content is base64 encoded
            if "content" in data:
                content_b64 = data["content"].replace("\n", "")
                content = base64.b64decode(content_b64).decode("utf-8")
                return content

            return None
        except Exception:
            return None

    def detect_deploy_workflow(self, repo_name: str) -> tuple[bool, Optional[str]]:
        """
        Detect if repository has a deploy workflow (using environment: keyword).

        Args:
            repo_name: Repository name.

        Returns:
            Tuple of (has_deploy_workflow, workflow_name).
        """
        workflows = self.get_workflows(repo_name)

        for workflow in workflows:
            workflow_path = workflow.get("path", "")
            workflow_name = workflow.get("name", "")

            # Get workflow content
            content = self.get_workflow_content(repo_name, workflow_path)

            if content and has_environment_keyword(content):
                return True, workflow_name

        return False, None

    def get_workflow_runs(
        self, repo_name: str, workflow_id: Optional[int] = None, per_page: int = 100
    ) -> list[dict]:
        """
        Get workflow runs for a repository.

        Args:
            repo_name: Repository name.
            workflow_id: Optional workflow ID to filter by.
            per_page: Number of runs per page (max 100).

        Returns:
            List of workflow run dictionaries.
        """
        try:
            endpoint = f"/repos/{self.owner}/{repo_name}/actions/runs"
            params = {"per_page": per_page}

            if workflow_id:
                params["workflow_id"] = workflow_id

            data = self.get(endpoint, params=params)
            return data.get("workflow_runs", [])
        except Exception:
            return []

    def get_recent_runs(
        self, repo_name: str, days: int = 90, max_runs: int = 1000
    ) -> list[dict]:
        """
        Get recent workflow runs for DORA metrics calculation.

        Args:
            repo_name: Repository name.
            days: Number of days to look back (default: 90).
            max_runs: Maximum number of runs to fetch.

        Returns:
            List of workflow run dictionaries.
        """
        from datetime import datetime, timedelta, timezone

        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

        # Get paginated runs
        runs = self.get_paginated(
            f"/repos/{self.owner}/{repo_name}/actions/runs",
            params={"per_page": 100},
            max_pages=max_runs // 100 + 1,
        )

        # Filter by date
        recent_runs = []
        for run in runs:
            created_at = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
            if created_at >= cutoff_date:
                recent_runs.append(run)

            if len(recent_runs) >= max_runs:
                break

        return recent_runs
