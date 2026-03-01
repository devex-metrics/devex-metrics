"""
Pytest configuration and shared fixtures for devex-metrics tests.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
import responses as responses_lib
from responses import matchers


@pytest.fixture
def mock_github_token(monkeypatch: pytest.MonkeyPatch) -> str:
    """Mock GitHub CLI token."""
    token = "ghp_test_token_123456789"
    monkeypatch.setenv("GITHUB_TOKEN", token)
    return token


@pytest.fixture
def mock_github_api() -> responses_lib.RequestsMock:
    """Activate responses library for mocking GitHub API calls."""
    with responses_lib.RequestsMock() as rsps:
        # Add default rate limit headers to all responses
        rsps.add_passthru("https://")  # Allow real HTTPS if needed
        yield rsps


@pytest.fixture
def sample_repository_response() -> dict[str, Any]:
    """Sample GitHub API repository response."""
    return {
        "id": 123456789,
        "name": "test-repo",
        "full_name": "test-org/test-repo",
        "owner": {"login": "test-org", "type": "Organization"},
        "html_url": "https://github.com/test-org/test-repo",
        "description": "Test repository",
        "fork": False,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2026-03-01T00:00:00Z",
        "pushed_at": "2026-03-01T00:00:00Z",
        "size": 1234,
        "stargazers_count": 10,
        "watchers_count": 10,
        "language": "Python",
        "archived": False,
        "disabled": False,
        "default_branch": "main",
        "permissions": {"admin": True, "push": True, "pull": True},
    }


@pytest.fixture
def sample_workflow_response() -> dict[str, Any]:
    """Sample GitHub Actions workflow response."""
    return {
        "id": 1234567,
        "node_id": "W_test123",
        "name": "CI/CD Pipeline",
        "path": ".github/workflows/ci-cd.yml",
        "state": "active",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2026-03-01T00:00:00Z",
        "url": "https://api.github.com/repos/test-org/test-repo/actions/workflows/1234567",
        "html_url": "https://github.com/test-org/test-repo/actions/workflows/ci-cd.yml",
        "badge_url": "https://github.com/test-org/test-repo/workflows/CI%2FCD%20Pipeline/badge.svg",
    }


@pytest.fixture
def sample_workflow_file_with_environment() -> str:
    """Sample workflow YAML file with environment keyword."""
    return """
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://prod.example.com
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: echo "Deploying..."
"""


@pytest.fixture
def sample_workflow_file_without_environment() -> str:
    """Sample workflow YAML file without environment keyword."""
    return """
name: CI Tests

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: pytest
"""


@pytest.fixture
def sample_workflow_run_response() -> dict[str, Any]:
    """Sample workflow run response."""
    return {
        "id": 98765432,
        "name": "Deploy to Production",
        "node_id": "WFR_test123",
        "head_branch": "main",
        "head_sha": "abc123def456",
        "run_number": 42,
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "workflow_id": 1234567,
        "created_at": "2026-03-01T14:00:00Z",
        "updated_at": "2026-03-01T14:05:00Z",
        "repository": {
            "id": 123456789,
            "name": "test-repo",
            "full_name": "test-org/test-repo",
        },
    }


@pytest.fixture
def sample_pull_request_response() -> dict[str, Any]:
    """Sample pull request response."""
    return {
        "id": 555555555,
        "number": 123,
        "state": "closed",
        "title": "Add new feature",
        "user": {"login": "contributor"},
        "body": "This PR adds a new feature",
        "created_at": "2026-02-28T10:00:00Z",
        "updated_at": "2026-02-28T18:00:00Z",
        "closed_at": "2026-02-28T18:00:00Z",
        "merged_at": "2026-02-28T18:00:00Z",
        "merge_commit_sha": "merge123abc",
        "assignee": None,
        "assignees": [],
        "requested_reviewers": [],
        "labels": [],
        "milestone": None,
        "draft": False,
        "head": {
            "label": "test-org:feature-branch",
            "ref": "feature-branch",
            "sha": "feature123",
        },
        "base": {"label": "test-org:main", "ref": "main", "sha": "main123"},
        "additions": 150,
        "deletions": 50,
        "changed_files": 5,
    }


@pytest.fixture
def sample_branch_protection_response() -> dict[str, Any]:
    """Sample branch protection rules response."""
    return {
        "url": "https://api.github.com/repos/test-org/test-repo/branches/main/protection",
        "required_status_checks": {
            "enforcement_level": "non_admins",
            "contexts": ["ci/test", "ci/lint"],
            "checks": [
                {"context": "ci/test", "app_id": None},
                {"context": "ci/lint", "app_id": None},
            ],
        },
        "required_pull_request_reviews": {
            "dismiss_stale_reviews": True,
            "require_code_owner_reviews": True,
            "required_approving_review_count": 1,
        },
        "enforce_admins": {"url": "...", "enabled": True},
        "required_linear_history": {"enabled": True},
        "allow_force_pushes": {"enabled": False},
        "allow_deletions": {"enabled": False},
    }


@pytest.fixture
def sample_code_scanning_alerts_response() -> list[dict[str, Any]]:
    """Sample code scanning alerts response."""
    return [
        {
            "number": 1,
            "created_at": "2026-02-15T10:00:00Z",
            "url": "https://api.github.com/repos/test-org/test-repo/code-scanning/alerts/1",
            "html_url": "https://github.com/test-org/test-repo/security/code-scanning/1",
            "state": "open",
            "dismissed_by": None,
            "dismissed_at": None,
            "dismissed_reason": None,
            "rule": {
                "id": "js/sql-injection",
                "severity": "error",
                "description": "SQL injection vulnerability",
            },
            "tool": {"name": "CodeQL", "version": "2.15.0"},
        }
    ]


@pytest.fixture
def temp_storage_dir(tmp_path: Path) -> Path:
    """Create a temporary directory for local storage tests."""
    storage_dir = tmp_path / ".devex-metrics" / "analyses"
    storage_dir.mkdir(parents=True)
    return storage_dir


def pytest_configure(config: pytest.Config) -> None:
    """Configure pytest with custom markers."""
    config.addinivalue_line("markers", "unit: Unit tests for individual modules")
    config.addinivalue_line("markers", "integration: Integration tests with API mocking")
    config.addinivalue_line("markers", "contract: Contract tests for CLI interface")
