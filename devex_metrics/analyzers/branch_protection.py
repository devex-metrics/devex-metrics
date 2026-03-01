"""
Branch protection analyzer.

Scores branch protection coverage and enforcement per FR-010.
"""

from devex_metrics.models import BranchProtectionMetrics, RepositoryMetrics


def calculate_branch_protection_metrics(
    repositories: list[RepositoryMetrics],
) -> BranchProtectionMetrics:
    """
    Calculate branch protection metrics for an organization.

    Per FR-010: Tracks adoption of required reviews, status checks, CODEOWNERS, and admin enforcement.

    Args:
        repositories: List of repository metrics.

    Returns:
        BranchProtectionMetrics with coverage percentages and counts.
    """
    # Filter out archived repositories
    active_repos = [repo for repo in repositories if not repo.is_archived]

    if not active_repos:
        return BranchProtectionMetrics(
            full_coverage=0.0,
            partial_coverage=0.0,
            repos_with_required_reviews=0,
            repos_with_required_status_checks=0,
            repos_with_codeowners=0,
            repos_with_admin_enforcement=0,
        )

    total_repos = len(active_repos)

    # Count repos with each protection feature
    repos_with_reviews = sum(1 for repo in active_repos if repo.has_required_reviews)
    repos_with_status_checks = sum(1 for repo in active_repos if repo.has_required_status_checks)
    repos_with_codeowners = sum(1 for repo in active_repos if repo.has_codeowners)
    repos_with_admin_enforcement = sum(
        1 for repo in active_repos if repo.branch_protection_score >= 3
    )

    # Full coverage: has all three main protections (reviews + status checks + CODEOWNERS)
    repos_with_full_coverage = sum(
        1
        for repo in active_repos
        if repo.has_required_reviews
        and repo.has_required_status_checks
        and repo.has_codeowners
    )

    # Partial coverage: has at least one protection
    repos_with_partial_coverage = sum(
        1
        for repo in active_repos
        if repo.has_required_reviews
        or repo.has_required_status_checks
        or repo.has_codeowners
    )

    full_coverage = repos_with_full_coverage / total_repos
    partial_coverage = repos_with_partial_coverage / total_repos

    return BranchProtectionMetrics(
        full_coverage=full_coverage,
        partial_coverage=partial_coverage,
        repos_with_required_reviews=repos_with_reviews,
        repos_with_required_status_checks=repos_with_status_checks,
        repos_with_codeowners=repos_with_codeowners,
        repos_with_admin_enforcement=repos_with_admin_enforcement,
    )


def get_branch_protection_score(metrics: BranchProtectionMetrics) -> int:
    """
    Calculate dimension score for branch protection (0-2 points).

    Scoring based on State of DevOps 2026 benchmarks:
    - 2 points (High): >= 75% full coverage (FR-014)
    - 1 point (Mid): >= 50% partial coverage (FR-015)
    - 0 points (Low): < 50% partial coverage

    Args:
        metrics: Branch protection metrics.

    Returns:
        Score: 0, 1, or 2 points.
    """
    if metrics.full_coverage >= 0.75:
        return 2  # High maturity
    elif metrics.partial_coverage >= 0.50:
        return 1  # Mid maturity
    else:
        return 0  # Low maturity


def identify_repos_needing_protection(
    repositories: list[RepositoryMetrics],
) -> dict[str, list[RepositoryMetrics]]:
    """
    Identify repositories missing specific protection features.

    Args:
        repositories: List of repository metrics.

    Returns:
        Dictionary with keys:
        - 'needs_reviews': Repos without required reviews
        - 'needs_status_checks': Repos without status checks
        - 'needs_codeowners': Repos without CODEOWNERS
        - 'needs_full_protection': Repos missing any of the three
    """
    active_repos = [repo for repo in repositories if not repo.is_archived]

    return {
        "needs_reviews": [repo for repo in active_repos if not repo.has_required_reviews],
        "needs_status_checks": [
            repo for repo in active_repos if not repo.has_required_status_checks
        ],
        "needs_codeowners": [repo for repo in active_repos if not repo.has_codeowners],
        "needs_full_protection": [
            repo
            for repo in active_repos
            if not (
                repo.has_required_reviews
                and repo.has_required_status_checks
                and repo.has_codeowners
            )
        ],
    }
