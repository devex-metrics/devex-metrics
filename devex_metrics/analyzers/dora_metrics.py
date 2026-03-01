"""
DORA metrics analyzer.

Calculates the four key DORA metrics per FR-008:
1. Deployment Frequency
2. Lead Time for Changes
3. Change Failure Rate
4. Mean Time to Restore (MTTR)
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from devex_metrics.models import DORAMetric, DORAMetrics, RepositoryMetrics


def calculate_dora_metrics(
    repositories: list[RepositoryMetrics],
    time_period_days: int = 90,
) -> DORAMetrics:
    """
    Calculate DORA 4 key metrics for an organization.

    Per FR-008: Analyzes workflow runs, PR merged dates, and deployment outcomes.

    NOTE: This is a simplified implementation for MVP. Full implementation requires:
    - Workflow run data (timestamps, statuses, environments)
    - PR merge timestamps
    - Deployment failure detection
    - Incident/recovery tracking

    Args:
        repositories: List of repository metrics.
        time_period_days: Analysis window (default: 90 days).

    Returns:
        DORAMetrics with the four key metrics.

    TODO (Future Enhancement):
        - Fetch workflow run data from collectors
        - Parse PR merge timestamps from pull request collector
        - Detect deployment failures from workflow run status
        - Track MTTR from issue/incident data
    """
    # Placeholder implementation for MVP
    # Real implementation will use workflow run collector and PR collector data

    # Count deployment workflows as proxy for deployment frequency
    total_deployments = sum(1 for repo in repositories if repo.has_deploy_workflow)

    # Calculate deployment frequency (deploys per day)
    deployment_frequency_value = total_deployments / time_period_days if time_period_days > 0 else 0

    deployment_frequency = DORAMetric(
        value=deployment_frequency_value,
        unit="per_day",
        tier=_classify_deployment_frequency_tier(deployment_frequency_value),
    )

    # Lead time: Placeholder (requires PR merge to deploy tracking)
    lead_time = DORAMetric(
        value=0.0,  # Hours - will be calculated from PR merge to deploy
        unit="hours",
        tier="Low",  # Default until implemented
    )

    # Change failure rate: Placeholder (requires workflow run success/failure data)
    change_failure_rate = 0.0  # Percentage

    # MTTR: Placeholder (requires incident/recovery tracking)
    mttr = DORAMetric(
        value=0.0,  # Hours - will be calculated from failure to recovery
        unit="hours",
        tier="Low",  # Default until implemented
    )

    return DORAMetrics(
        deployment_frequency=deployment_frequency,
        lead_time_hours=lead_time,
        change_failure_rate=change_failure_rate,
        mttr_hours=mttr,
        total_deployments=total_deployments,
        failed_deployments=0,  # Placeholder
        time_period_days=time_period_days,
    )


def _classify_deployment_frequency_tier(deploys_per_day: float) -> str:
    """
    Classify deployment frequency into DORA tier.

    Tiers based on State of DevOps research:
    - Elite: Multiple deploys per day (>1.0)
    - High: Once per day to once per week (0.14-1.0)
    - Medium: Once per week to once per month (0.03-0.14)
    - Low: Less than once per month (<0.03)

    Args:
        deploys_per_day: Average deploys per day.

    Returns:
        Tier: Elite, High, Medium, or Low.
    """
    if deploys_per_day >= 1.0:
        return "Elite"
    elif deploys_per_day >= 0.14:  # ~1 per week
        return "High"
    elif deploys_per_day >= 0.03:  # ~1 per month
        return "Medium"
    else:
        return "Low"


def _classify_lead_time_tier(hours: float) -> str:
    """
    Classify lead time into DORA tier.

    Tiers based on State of DevOps research:
    - Elite: Less than 1 hour
    - High: 1 day to 1 week (24-168 hours)
    - Medium: 1 week to 1 month (168-720 hours)
    - Low: More than 1 month (>720 hours)

    Args:
        hours: Median lead time in hours.

    Returns:
        Tier: Elite, High, Medium, or Low.
    """
    if hours < 1.0:
        return "Elite"
    elif hours < 24.0:
        return "High"
    elif hours < 168.0:  # 1 week
        return "Medium"
    else:
        return "Low"


def _classify_change_failure_rate_tier(rate: float) -> str:
    """
    Classify change failure rate into DORA tier.

    Tiers based on State of DevOps research:
    - Elite: 0-15%
    - High: 16-30%
    - Medium: 31-45%
    - Low: >45%

    Args:
        rate: Change failure rate (0.0-1.0).

    Returns:
        Tier: Elite, High, Medium, or Low.
    """
    if rate <= 0.15:
        return "Elite"
    elif rate <= 0.30:
        return "High"
    elif rate <= 0.45:
        return "Medium"
    else:
        return "Low"


def _classify_mttr_tier(hours: float) -> str:
    """
    Classify MTTR into DORA tier.

    Tiers based on State of DevOps research:
    - Elite: Less than 1 hour
    - High: Less than 1 day (24 hours)
    - Medium: 1 day to 1 week (24-168 hours)
    - Low: More than 1 week (>168 hours)

    Args:
        hours: Median MTTR in hours.

    Returns:
        Tier: Elite, High, Medium, or Low.
    """
    if hours < 1.0:
        return "Elite"
    elif hours < 24.0:
        return "High"
    elif hours < 168.0:  # 1 week
        return "Medium"
    else:
        return "Low"


def get_dora_score(metrics: DORAMetrics) -> int:
    """
    Calculate dimension score for DORA metrics (0-2 points).

    Scoring based on deployment frequency tier:
    - 2 points (High): Elite or High tier
    - 1 point (Mid): Medium tier
    - 0 points (Low): Low tier

    Args:
        metrics: DORA metrics.

    Returns:
        Score: 0, 1, or 2 points.
    """
    tier = metrics.deployment_frequency.tier

    if tier in ("Elite", "High"):
        return 2  # High maturity
    elif tier == "Medium":
        return 1  # Mid maturity
    else:
        return 0  # Low maturity
