"""
Data models for devex-metrics.

Pydantic models for type-safe data flow through the analysis pipeline.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class DimensionScores(BaseModel):
    """Maturity scores for each measured dimension."""

    deployment_automation: int = Field(..., ge=0, le=2, description="0-2 points")
    branch_protection: int = Field(..., ge=0, le=2, description="0-2 points")
    reusable_workflows: int = Field(..., ge=0, le=2, description="0-2 points")
    code_scanning: int = Field(..., ge=0, le=2, description="0-2 points")
    audit_trail: int = Field(..., ge=0, le=2, description="0-2 points")
    pr_cycle_time: int = Field(..., ge=0, le=2, description="0-2 points")
    ci_pass_rate: int = Field(..., ge=0, le=2, description="0-2 points")

    def total(self) -> int:
        """Calculate total score (0-14)."""
        return sum(
            [
                self.deployment_automation,
                self.branch_protection,
                self.reusable_workflows,
                self.code_scanning,
                self.audit_trail,
                self.pr_cycle_time,
                self.ci_pass_rate,
            ]
        )


class DORAMetric(BaseModel):
    """Single DORA metric with value and tier."""

    value: float = Field(..., description="Numeric value (e.g., deploys per day)")
    unit: str = Field(..., description="Unit of measurement (e.g., 'per_day', 'hours')")
    tier: str = Field(..., description="Elite, High, Medium, or Low")


class DORAMetrics(BaseModel):
    """DORA 4 key metrics."""

    deployment_frequency: DORAMetric = Field(..., description="Deploys per time period")
    lead_time_hours: DORAMetric = Field(
        ..., description="Median hours from PR merge to deploy"
    )
    change_failure_rate: float = Field(..., ge=0.0, le=1.0, description="% of deploys that fail")
    mttr_hours: DORAMetric = Field(..., description="Median hours to restore after failure")

    # Supporting data
    total_deployments: int = Field(..., ge=0)
    failed_deployments: int = Field(..., ge=0)
    time_period_days: int = Field(default=90, description="Analysis window (default 90 days)")


class TimeMetric(BaseModel):
    """Time-based metric with percentiles."""

    median: float = Field(..., description="Median value")
    p90: float = Field(..., description="90th percentile")
    unit: str = Field(default="hours", description="Time unit")


class BranchProtectionMetrics(BaseModel):
    """Branch protection coverage and enforcement."""

    full_coverage: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="% repos with required reviews + status checks + CODEOWNERS",
    )
    partial_coverage: float = Field(
        ..., ge=0.0, le=1.0, description="% repos with at least one protection rule"
    )

    repos_with_required_reviews: int = Field(..., ge=0)
    repos_with_required_status_checks: int = Field(..., ge=0)
    repos_with_codeowners: int = Field(..., ge=0)
    repos_with_admin_enforcement: int = Field(..., ge=0)


class SecurityPostureMetrics(BaseModel):
    """Security scanning adoption across organization."""

    code_scanning_enabled: float = Field(
        ..., ge=0.0, le=1.0, description="% repos with code scanning"
    )
    dependabot_enabled: float = Field(..., ge=0.0, le=1.0, description="% repos with Dependabot")
    secret_scanning_enabled: float = Field(
        ..., ge=0.0, le=1.0, description="% repos with secret scanning"
    )

    total_code_scanning_alerts: int = Field(..., ge=0)
    total_dependabot_alerts: int = Field(..., ge=0)
    total_secret_scanning_alerts: int = Field(..., ge=0)


class DeveloperExperienceMetrics(BaseModel):
    """Developer experience and productivity metrics."""

    pr_cycle_time: TimeMetric = Field(..., description="Time from PR open to merge")
    time_to_first_review: TimeMetric = Field(
        ..., description="Time from PR open to first review"
    )
    review_turnaround: TimeMetric = Field(
        ..., description="Time from review request to approval"
    )

    ci_pass_rate: float = Field(
        ..., ge=0.0, le=1.0, description="% of PRs passing CI on first run"
    )

    total_prs_analyzed: int = Field(..., ge=0)
    median_pr_size_lines: int = Field(..., ge=0, description="Median lines changed per PR")


class ReusableWorkflowMetrics(BaseModel):
    """Reusable workflow adoption as IDP maturity proxy."""

    adoption_rate: float = Field(
        ..., ge=0.0, le=1.0, description="% repos using org-level workflows"
    )
    repos_using_shared_workflows: int = Field(..., ge=0)
    total_shared_workflows: int = Field(
        ..., ge=0, description="Unique org-level workflows referenced"
    )


class OrganizationMetrics(BaseModel):
    """Organization-wide aggregated metrics."""

    # Deployment automation
    deployment_automation_rate: float = Field(
        ..., ge=0.0, le=1.0, description="% repos with deploy workflows"
    )
    repos_with_deploy_workflow: int = Field(..., ge=0)
    total_repos: int = Field(..., ge=0)

    # DORA metrics
    dora: DORAMetrics

    # Branch protection
    branch_protection: BranchProtectionMetrics

    # Security posture
    security: SecurityPostureMetrics

    # Developer experience
    developer_experience: DeveloperExperienceMetrics

    # Reusable workflows
    reusable_workflows: ReusableWorkflowMetrics


class BenchmarkGap(BaseModel):
    """Gap analysis for a single dimension."""

    dimension: str = Field(..., description="Dimension name (e.g., 'Deployment Automation')")
    current_value: float = Field(..., description="Current metric value (e.g., 0.45)")
    target_value: float = Field(..., description="High-maturity threshold (e.g., 0.61)")
    gap: float = Field(..., description="Difference (target - current)")
    gap_percentage: float = Field(..., description="Gap as percentage (gap * 100)")
    recommendation: str = Field(..., description="Actionable next step")


class RepositoryMetrics(BaseModel):
    """Metrics collected for a single repository."""

    # Identity
    name: str = Field(..., description="Repository name")
    full_name: str = Field(..., description="Owner/repo format")
    url: str = Field(..., description="GitHub web URL")
    default_branch: str = Field(default="main", description="Default branch name")

    # Status
    is_archived: bool = Field(default=False)
    is_inactive: bool = Field(default=False, description="No commits in 90 days")
    last_pushed_at: Optional[datetime] = Field(None, description="Last push timestamp")

    # Deployment automation
    has_deploy_workflow: bool = Field(default=False)
    deploy_workflow_name: Optional[str] = Field(None)
    deploy_workflow_uses_environment: bool = Field(
        default=False, description="Uses environment: keyword"
    )

    # Branch protection
    branch_protection_score: int = Field(
        default=0, ge=0, le=3, description="0=none, 1=partial, 2=full, 3=admin enforced"
    )
    has_required_reviews: bool = Field(default=False)
    has_required_status_checks: bool = Field(default=False)
    has_codeowners: bool = Field(default=False)

    # Security
    code_scanning_enabled: bool = Field(default=False)
    code_scanning_alerts_count: int = Field(default=0, ge=0)
    dependabot_enabled: bool = Field(default=False)
    dependabot_alerts_count: int = Field(default=0, ge=0)
    secret_scanning_enabled: bool = Field(default=False)

    # Developer experience (only for active repos)
    pr_cycle_time_hours: Optional[float] = Field(
        None, description="Median PR cycle time (active repos only)"
    )
    ci_pass_rate: Optional[float] = Field(
        None, ge=0.0, le=1.0, description="CI pass rate (active repos only)"
    )

    # Workflow metadata
    total_workflows: int = Field(default=0, ge=0)
    uses_reusable_workflows: bool = Field(default=False)
    reusable_workflows_used: list[str] = Field(
        default_factory=list, description="List of shared workflow names"
    )


class AnalysisResult(BaseModel):
    """Complete analysis result for a GitHub organization or user."""

    # Metadata
    schema_version: str = Field(default="1.0", description="JSON schema version")
    organization: str = Field(..., description="GitHub organization or username")
    analyzed_at: datetime = Field(..., description="Timestamp of analysis")
    tool_version: str = Field(..., description="devex-metrics version")
    analyzer_email: Optional[str] = Field(None, description="Email of user who ran analysis")

    # Summary
    maturity_tier: str = Field(..., description="High, Mid, or Low")
    total_score: int = Field(..., ge=0, le=14, description="Sum of dimension scores (0-14)")
    repository_count: int = Field(..., ge=0, description="Total repositories analyzed")
    inactive_repository_count: int = Field(
        ..., ge=0, description="Repos with no commits in 90 days"
    )

    # Detailed results
    dimension_scores: DimensionScores
    metrics: OrganizationMetrics
    repositories: list[RepositoryMetrics]
    gaps: list[BenchmarkGap]
