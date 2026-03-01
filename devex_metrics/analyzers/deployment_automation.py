"""
Deployment automation analyzer.

Calculates deployment automation rate: percentage of repositories with deploy workflows.
"""

from devex_metrics.models import RepositoryMetrics


def calculate_deployment_automation_rate(
    repositories: list[RepositoryMetrics],
) -> tuple[float, int, int]:
    """
    Calculate deployment automation rate for an organization.

    Per FR-007: Deployment automation rate = (repos with deploy workflows) / (total non-archived repos)

    Args:
        repositories: List of repository metrics.

    Returns:
        Tuple of (automation_rate, repos_with_deploy, total_repos).
        - automation_rate: Float between 0.0 and 1.0
        - repos_with_deploy: Count of repos with deploy workflows
        - total_repos: Count of non-archived repos

    Example:
        >>> repos = [
        ...     RepositoryMetrics(name="app1", has_deploy_workflow=True, is_archived=False),
        ...     RepositoryMetrics(name="app2", has_deploy_workflow=False, is_archived=False),
        ...     RepositoryMetrics(name="old", has_deploy_workflow=True, is_archived=True),
        ... ]
        >>> rate, with_deploy, total = calculate_deployment_automation_rate(repos)
        >>> rate
        0.5
        >>> with_deploy
        1
        >>> total
        2
    """
    # Filter out archived repositories
    active_repos = [repo for repo in repositories if not repo.is_archived]

    if not active_repos:
        return 0.0, 0, 0

    repos_with_deploy = sum(1 for repo in active_repos if repo.has_deploy_workflow)
    total_repos = len(active_repos)

    automation_rate = repos_with_deploy / total_repos if total_repos > 0 else 0.0

    return automation_rate, repos_with_deploy, total_repos


def get_deployment_automation_score(automation_rate: float) -> int:
    """
    Calculate dimension score for deployment automation (0-2 points).

    Scoring based on State of DevOps 2026 benchmarks:
    - 2 points (High): >= 61% automation rate (FR-014)
    - 1 point (Mid): >= 31% automation rate (FR-015)
    - 0 points (Low): < 31% automation rate

    Args:
        automation_rate: Automation rate as float between 0.0 and 1.0.

    Returns:
        Score: 0, 1, or 2 points.
    """
    if automation_rate >= 0.61:
        return 2  # High maturity
    elif automation_rate >= 0.31:
        return 1  # Mid maturity
    else:
        return 0  # Low maturity


def identify_repos_needing_workflows(
    repositories: list[RepositoryMetrics],
) -> list[RepositoryMetrics]:
    """
    Identify non-archived repositories without deploy workflows.

    Useful for generating recommendations.

    Args:
        repositories: List of repository metrics.

    Returns:
        List of repositories that need deploy workflows.
    """
    return [
        repo
        for repo in repositories
        if not repo.is_archived and not repo.has_deploy_workflow
    ]


def calculate_improvement_needed(
    current_rate: float, target_rate: float, total_repos: int
) -> int:
    """
    Calculate how many additional repos need deploy workflows to reach target.

    Args:
        current_rate: Current automation rate (0.0-1.0).
        target_rate: Target automation rate (0.0-1.0).
        total_repos: Total number of non-archived repos.

    Returns:
        Number of additional repos needed.

    Example:
        >>> calculate_improvement_needed(0.45, 0.61, 45)
        8
    """
    if current_rate >= target_rate or total_repos == 0:
        return 0

    current_count = int(current_rate * total_repos)
    target_count = int(target_rate * total_repos) + 1  # +1 to ensure threshold met

    return max(0, target_count - current_count)
