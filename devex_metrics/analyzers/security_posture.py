"""
Security posture analyzer.

Aggregates security scanning adoption (code scanning, Dependabot, secret scanning) per FR-011.
"""

from devex_metrics.models import RepositoryMetrics, SecurityPostureMetrics


def calculate_security_posture_metrics(
    repositories: list[RepositoryMetrics],
) -> SecurityPostureMetrics:
    """
    Calculate security posture metrics for an organization.

    Per FR-011: Tracks adoption of code scanning, Dependabot, and secret scanning.

    Args:
        repositories: List of repository metrics.

    Returns:
        SecurityPostureMetrics with adoption rates and alert counts.
    """
    # Filter out archived repositories
    active_repos = [repo for repo in repositories if not repo.is_archived]

    if not active_repos:
        return SecurityPostureMetrics(
            code_scanning_enabled=0.0,
            dependabot_enabled=0.0,
            secret_scanning_enabled=0.0,
            total_code_scanning_alerts=0,
            total_dependabot_alerts=0,
            total_secret_scanning_alerts=0,
        )

    total_repos = len(active_repos)

    # Count repos with each security feature
    repos_with_code_scanning = sum(1 for repo in active_repos if repo.code_scanning_enabled)
    repos_with_dependabot = sum(1 for repo in active_repos if repo.dependabot_enabled)
    repos_with_secret_scanning = sum(1 for repo in active_repos if repo.secret_scanning_enabled)

    # Sum total alerts
    total_code_scanning_alerts = sum(repo.code_scanning_alerts_count for repo in active_repos)
    total_dependabot_alerts = sum(repo.dependabot_alerts_count for repo in active_repos)
    # Note: Secret scanning alerts not tracked per repo in current model, defaults to 0

    return SecurityPostureMetrics(
        code_scanning_enabled=repos_with_code_scanning / total_repos,
        dependabot_enabled=repos_with_dependabot / total_repos,
        secret_scanning_enabled=repos_with_secret_scanning / total_repos,
        total_code_scanning_alerts=total_code_scanning_alerts,
        total_dependabot_alerts=total_dependabot_alerts,
        total_secret_scanning_alerts=0,  # Will be populated when collector adds this
    )


def get_code_scanning_score(code_scanning_rate: float) -> int:
    """
    Calculate dimension score for code scanning adoption (0-2 points).

    Scoring based on State of DevOps 2026 benchmarks:
    - 2 points (High): >= 80% adoption (FR-014)
    - 1 point (Mid): >= 50% adoption (FR-015)
    - 0 points (Low): < 50% adoption

    Args:
        code_scanning_rate: Code scanning adoption rate (0.0-1.0).

    Returns:
        Score: 0, 1, or 2 points.
    """
    if code_scanning_rate >= 0.80:
        return 2  # High maturity
    elif code_scanning_rate >= 0.50:
        return 1  # Mid maturity
    else:
        return 0  # Low maturity


def identify_repos_needing_security_features(
    repositories: list[RepositoryMetrics],
) -> dict[str, list[RepositoryMetrics]]:
    """
    Identify repositories missing security features.

    Args:
        repositories: List of repository metrics.

    Returns:
        Dictionary with keys:
        - 'needs_code_scanning': Repos without code scanning
        - 'needs_dependabot': Repos without Dependabot
        - 'needs_secret_scanning': Repos without secret scanning
    """
    active_repos = [repo for repo in repositories if not repo.is_archived]

    return {
        "needs_code_scanning": [
            repo for repo in active_repos if not repo.code_scanning_enabled
        ],
        "needs_dependabot": [repo for repo in active_repos if not repo.dependabot_enabled],
        "needs_secret_scanning": [
            repo for repo in active_repos if not repo.secret_scanning_enabled
        ],
    }


def calculate_security_posture_score(metrics: SecurityPostureMetrics) -> int:
    """
    Calculate overall security posture score (0-2 points).

    Combines code scanning, Dependabot, and secret scanning adoption rates.
    Uses code scanning as primary indicator per FR-014/FR-015.

    Args:
        metrics: Security posture metrics.

    Returns:
        Score: 0, 1, or 2 points.
    """
    # Primary scoring based on code scanning (most important security metric)
    return get_code_scanning_score(metrics.code_scanning_enabled)
