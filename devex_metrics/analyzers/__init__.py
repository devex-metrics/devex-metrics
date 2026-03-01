"""
Main analysis orchestrator.

Coordinates data collection, metrics calculation, and scoring.
"""

from datetime import datetime, timezone
from typing import Optional

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, MofNCompleteColumn

from devex_metrics.auth import get_github_token
from devex_metrics.collectors.repositories import RepositoriesCollector
from devex_metrics.collectors.workflows import WorkflowsCollector
from devex_metrics.collectors.branch_protection import BranchProtectionCollector
from devex_metrics.collectors.security import SecurityCollector
from devex_metrics.models import (
    AnalysisResult,
    RepositoryMetrics,
    OrganizationMetrics,
    DORAMetrics,
    DORAMetric,
    BranchProtectionMetrics,
    SecurityPostureMetrics,
    DeveloperExperienceMetrics,
    TimeMetric,
    ReusableWorkflowMetrics,
)
from devex_metrics.scorers.maturity_scorer import MaturityScorer
from devex_metrics.version import __version__


console = Console()


class Analyzer:
    """Main analysis orchestrator for GitHub organizations."""

    def __init__(self, organization: str, token: Optional[str] = None):
        """
        Initialize analyzer.

        Args:
            organization: GitHub organization or username.
            token: GitHub access token (if None, will use gh CLI).
        """
        self.organization = organization
        self.token = token or get_github_token()

        # Initialize collectors
        self.repos_collector = RepositoriesCollector(self.token, organization)
        self.workflows_collector = WorkflowsCollector(self.token, organization)
        self.branch_protection_collector = BranchProtectionCollector(self.token, organization)
        self.security_collector = SecurityCollector(self.token, organization)

        # Initialize scorer
        self.scorer = MaturityScorer()

    def analyze(self) -> AnalysisResult:
        """
        Run complete analysis of the organization.

        Returns:
            AnalysisResult with all metrics and scores.
        """
        console.print(f"\n[bold cyan]Analyzing organization:[/bold cyan] {self.organization}\n")

        # Step 1: Collect repositories
        console.print("[bold]Step 1/4:[/bold] Fetching repositories...")
        repositories = self._collect_repositories()
        console.print(f"  ✓ Found {len(repositories)} repositories\n")

        # Step 2: Collect detailed metrics for each repository
        console.print("[bold]Step 2/4:[/bold] Collecting detailed metrics...")
        repositories = self._enrich_repositories(repositories)
        console.print("  ✓ Metrics collected\n")

        # Step 3: Calculate organization-wide metrics
        console.print("[bold]Step 3/4:[/bold] Calculating organization metrics...")
        org_metrics = self._calculate_org_metrics(repositories)
        console.print("  ✓ Metrics calculated\n")

        # Step 4: Score maturity tier
        console.print("[bold]Step 4/4:[/bold] Scoring maturity tier...")
        dimension_scores = self.scorer.calculate_dimension_scores(org_metrics)
        maturity_tier = self.scorer.calculate_tier(dimension_scores)
        gaps = self.scorer.calculate_gaps(org_metrics, dimension_scores)
        console.print(f"  ✓ Maturity tier: [bold]{maturity_tier}[/bold] ({dimension_scores.total()}/14 points)\n")

        # Count inactive repos
        inactive_count = sum(1 for r in repositories if r.is_inactive)

        # Create analysis result
        result = AnalysisResult(
            organization=self.organization,
            analyzed_at=datetime.now(timezone.utc),
            tool_version=__version__,
            maturity_tier=maturity_tier,
            total_score=dimension_scores.total(),
            repository_count=len(repositories),
            inactive_repository_count=inactive_count,
            dimension_scores=dimension_scores,
            metrics=org_metrics,
            repositories=repositories,
            gaps=gaps,
        )

        return result

    def _collect_repositories(self) -> list[RepositoryMetrics]:
        """Collect repository list."""
        return self.repos_collector.collect()

    def _enrich_repositories(self, repositories: list[RepositoryMetrics]) -> list[RepositoryMetrics]:
        """
        Enrich repositories with detailed metrics.

        Args:
            repositories: List of basic repository metadata.

        Returns:
            Enriched repository list with workflow, security, and protection data.
        """
        enriched = []

        with Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
        ) as progress:
            task = progress.add_task("Analyzing repositories...", total=len(repositories))

            for repo in repositories:
                # Skip archived repos
                if repo.is_archived:
                    progress.update(task, advance=1)
                    continue

                # Collect workflow info
                has_deploy, workflow_name = self.workflows_collector.detect_deploy_workflow(repo.name)
                repo.has_deploy_workflow = has_deploy
                repo.deploy_workflow_name = workflow_name

                # Collect branch protection
                protection = self.branch_protection_collector.get_branch_protection(
                    repo.name, repo.default_branch
                )
                protection_analysis = self.branch_protection_collector.analyze_protection_level(
                    protection
                )
                repo.branch_protection_score = protection_analysis["score"]
                repo.has_required_reviews = protection_analysis["has_required_reviews"]
                repo.has_required_status_checks = protection_analysis["has_required_status_checks"]
                repo.has_codeowners = protection_analysis["has_codeowners"]

                # Collect security info
                security_summary = self.security_collector.get_security_summary(repo.name)
                repo.code_scanning_enabled = security_summary["code_scanning_enabled"]
                repo.code_scanning_alerts_count = security_summary["code_scanning_alerts_count"]
                repo.dependabot_enabled = security_summary["dependabot_enabled"]
                repo.dependabot_alerts_count = security_summary["dependabot_alerts_count"]
                repo.secret_scanning_enabled = security_summary["secret_scanning_enabled"]

                enriched.append(repo)
                progress.update(task, advance=1)

        return enriched

    def _calculate_org_metrics(self, repositories: list[RepositoryMetrics]) -> OrganizationMetrics:
        """
        Calculate organization-wide aggregated metrics.

        Args:
            repositories: List of repository metrics.

        Returns:
            OrganizationMetrics with aggregated data.
        """
        total_repos = len(repositories)
        active_repos = [r for r in repositories if not r.is_inactive]

        # Deployment automation
        repos_with_deploy = sum(1 for r in repositories if r.has_deploy_workflow)
        deployment_rate = repos_with_deploy / total_repos if total_repos > 0 else 0.0

        # Branch protection
        repos_with_reviews = sum(1 for r in repositories if r.has_required_reviews)
        repos_with_checks = sum(1 for r in repositories if r.has_required_status_checks)
        repos_with_codeowners = sum(1 for r in repositories if r.has_codeowners)
        repos_full_protection = sum(1 for r in repositories if r.branch_protection_score >= 2)
        repos_partial_protection = sum(1 for r in repositories if r.branch_protection_score >= 1)

        full_coverage = repos_full_protection / total_repos if total_repos > 0 else 0.0
        partial_coverage = repos_partial_protection / total_repos if total_repos > 0 else 0.0

        # Security
        code_scanning_count = sum(1 for r in repositories if r.code_scanning_enabled)
        dependabot_count = sum(1 for r in repositories if r.dependabot_enabled)
        
        code_scanning_rate = code_scanning_count / total_repos if total_repos > 0 else 0.0
        dependabot_rate = dependabot_count / total_repos if total_repos > 0 else 0.0

        total_code_alerts = sum(r.code_scanning_alerts_count for r in repositories)
        total_dependabot_alerts = sum(r.dependabot_alerts_count for r in repositories)

        # Create metrics (simplified for MVP - using placeholder values for PR metrics)
        org_metrics = OrganizationMetrics(
            deployment_automation_rate=deployment_rate,
            repos_with_deploy_workflow=repos_with_deploy,
            total_repos=total_repos,
            dora=DORAMetrics(
                deployment_frequency=DORAMetric(value=0.0, unit="per_day", tier="Low"),
                lead_time_hours=DORAMetric(value=0.0, unit="hours", tier="Low"),
                change_failure_rate=0.0,
                mttr_hours=DORAMetric(value=0.0, unit="hours", tier="Low"),
                total_deployments=0,
                failed_deployments=0,
            ),
            branch_protection=BranchProtectionMetrics(
                full_coverage=full_coverage,
                partial_coverage=partial_coverage,
                repos_with_required_reviews=repos_with_reviews,
                repos_with_required_status_checks=repos_with_checks,
                repos_with_codeowners=repos_with_codeowners,
                repos_with_admin_enforcement=0,
            ),
            security=SecurityPostureMetrics(
                code_scanning_enabled=code_scanning_rate,
                dependabot_enabled=dependabot_rate,
                secret_scanning_enabled=0.0,
                total_code_scanning_alerts=total_code_alerts,
                total_dependabot_alerts=total_dependabot_alerts,
                total_secret_scanning_alerts=0,
            ),
            developer_experience=DeveloperExperienceMetrics(
                pr_cycle_time=TimeMetric(median=48.0, p90=96.0, unit="hours"),
                time_to_first_review=TimeMetric(median=24.0, p90=48.0, unit="hours"),
                review_turnaround=TimeMetric(median=12.0, p90=24.0, unit="hours"),
                ci_pass_rate=0.75,
                total_prs_analyzed=0,
                median_pr_size_lines=100,
            ),
            reusable_workflows=ReusableWorkflowMetrics(
                adoption_rate=0.0,
                repos_using_shared_workflows=0,
                total_shared_workflows=0,
            ),
        )

        return org_metrics
