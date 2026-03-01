"""
Maturity scorer for calculating DevOps maturity tiers.

Applies State of DevOps 2026 benchmarks to organization metrics.
"""

from devex_metrics.models import DimensionScores, BenchmarkGap, OrganizationMetrics
from devex_metrics.scorers.benchmarks import BENCHMARKS


class MaturityScorer:
    """Calculate maturity tier based on dimension scores."""

    def score_deployment_automation(self, rate: float) -> int:
        """
        Score deployment automation dimension (0-2 points).

        Args:
            rate: % of repos with deploy workflows (0.0-1.0).

        Returns:
            Score: 2 = High (≥61%), 1 = Mid (31-60%), 0 = Low (<31%).
        """
        if rate >= BENCHMARKS.deployment_automation_high:
            return 2
        elif rate >= BENCHMARKS.deployment_automation_mid:
            return 1
        else:
            return 0

    def score_branch_protection(self, full_coverage: float, partial_coverage: float) -> int:
        """
        Score branch protection dimension (0-2 points).

        Args:
            full_coverage: % of repos with full protection (reviews + checks + CODEOWNERS).
            partial_coverage: % of repos with at least one protection rule.

        Returns:
            Score: 2 = High (≥90% full), 1 = Mid (≥50% partial), 0 = Low.
        """
        if full_coverage >= BENCHMARKS.branch_protection_full:
            return 2
        elif partial_coverage >= BENCHMARKS.branch_protection_partial:
            return 1
        else:
            return 0

    def score_reusable_workflows(self, adoption_rate: float) -> int:
        """
        Score reusable workflows dimension (0-2 points).

        Args:
            adoption_rate: % of repos using shared workflows (0.0-1.0).

        Returns:
            Score: 2 = High (≥79%), 1 = Mid (21-78%), 0 = Low (<21%).
        """
        if adoption_rate >= BENCHMARKS.reusable_workflows_high:
            return 2
        elif adoption_rate >= BENCHMARKS.reusable_workflows_mid:
            return 1
        else:
            return 0

    def score_code_scanning(self, enabled_rate: float) -> int:
        """
        Score code scanning dimension (0-2 points).

        Args:
            enabled_rate: % of repos with code scanning enabled (0.0-1.0).

        Returns:
            Score: 2 = High (≥90%), 1 = Mid (50-89%), 0 = Low (<50%).
        """
        if enabled_rate >= BENCHMARKS.code_scanning_high:
            return 2
        elif enabled_rate >= BENCHMARKS.code_scanning_mid:
            return 1
        else:
            return 0

    def score_audit_trail(self, full_coverage: float, partial_coverage: float) -> int:
        """
        Score audit trail dimension (0-2 points).

        Args:
            full_coverage: % of repos with full audit trail (reviews + CODEOWNERS + linear history).
            partial_coverage: % of repos with partial audit trail.

        Returns:
            Score: 2 = High (≥90% full), 1 = Mid (≥50% partial), 0 = Low.
        """
        # For MVP, use branch protection as proxy for audit trail
        if full_coverage >= BENCHMARKS.audit_trail_high:
            return 2
        elif partial_coverage >= BENCHMARKS.audit_trail_mid:
            return 1
        else:
            return 0

    def score_pr_cycle_time(self, median_hours: float) -> int:
        """
        Score PR cycle time dimension (0-2 points).

        Args:
            median_hours: Median PR cycle time in hours.

        Returns:
            Score: 2 = High (<24h), 1 = Mid (24-168h), 0 = Low (>168h).
        """
        if median_hours < BENCHMARKS.pr_cycle_time_high:
            return 2
        elif median_hours < BENCHMARKS.pr_cycle_time_mid:
            return 1
        else:
            return 0

    def score_ci_pass_rate(self, pass_rate: float) -> int:
        """
        Score CI pass rate dimension (0-2 points).

        Args:
            pass_rate: % of PRs passing CI on first run (0.0-1.0).

        Returns:
            Score: 2 = High (≥90%), 1 = Mid (60-89%), 0 = Low (<60%).
        """
        if pass_rate >= BENCHMARKS.ci_pass_rate_high:
            return 2
        elif pass_rate >= BENCHMARKS.ci_pass_rate_mid:
            return 1
        else:
            return 0

    def calculate_dimension_scores(self, metrics: OrganizationMetrics) -> DimensionScores:
        """
        Calculate scores for all dimensions.

        Args:
            metrics: Organization-wide metrics.

        Returns:
            DimensionScores with all dimension scores (0-2 each).
        """
        return DimensionScores(
            deployment_automation=self.score_deployment_automation(
                metrics.deployment_automation_rate
            ),
            branch_protection=self.score_branch_protection(
                metrics.branch_protection.full_coverage,
                metrics.branch_protection.partial_coverage,
            ),
            reusable_workflows=self.score_reusable_workflows(
                metrics.reusable_workflows.adoption_rate
            ),
            code_scanning=self.score_code_scanning(metrics.security.code_scanning_enabled),
            audit_trail=self.score_audit_trail(
                metrics.branch_protection.full_coverage,
                metrics.branch_protection.partial_coverage,
            ),
            pr_cycle_time=self.score_pr_cycle_time(metrics.developer_experience.pr_cycle_time.median),
            ci_pass_rate=self.score_ci_pass_rate(metrics.developer_experience.ci_pass_rate),
        )

    def calculate_tier(self, scores: DimensionScores) -> str:
        """
        Calculate maturity tier from dimension scores.

        Args:
            scores: Dimension scores.

        Returns:
            Maturity tier: 'High', 'Mid', or 'Low'.
        """
        total = scores.total()

        if total >= 10:
            return "High"
        elif total >= 5:
            return "Mid"
        else:
            return "Low"

    def calculate_gaps(self, metrics: OrganizationMetrics, scores: DimensionScores) -> list[BenchmarkGap]:
        """
        Calculate gaps between current metrics and High-tier thresholds.

        Args:
            metrics: Organization-wide metrics.
            scores: Dimension scores.

        Returns:
            List of BenchmarkGap instances with recommendations.
        """
        gaps = []

        # Deployment automation gap
        if scores.deployment_automation < 2:
            current = metrics.deployment_automation_rate
            target = BENCHMARKS.deployment_automation_high
            gap = target - current
            repos_needed = int(gap * metrics.total_repos)

            gaps.append(
                BenchmarkGap(
                    dimension="Deployment Automation",
                    current_value=current,
                    target_value=target,
                    gap=gap,
                    gap_percentage=gap * 100,
                    recommendation=f"Automate {repos_needed} more repositories to reach High tier (add workflows with 'environment:' keyword)",
                )
            )

        # Branch protection gap
        if scores.branch_protection < 2:
            current = metrics.branch_protection.full_coverage
            target = BENCHMARKS.branch_protection_full
            gap = target - current
            repos_needed = int(gap * metrics.total_repos)

            gaps.append(
                BenchmarkGap(
                    dimension="Branch Protection",
                    current_value=current,
                    target_value=target,
                    gap=gap,
                    gap_percentage=gap * 100,
                    recommendation=f"Enable full branch protection on {repos_needed} more repositories (required reviews + status checks + CODEOWNERS)",
                )
            )

        # Code scanning gap
        if scores.code_scanning < 2:
            current = metrics.security.code_scanning_enabled
            target = BENCHMARKS.code_scanning_high
            gap = target - current
            repos_needed = int(gap * metrics.total_repos)

            gaps.append(
                BenchmarkGap(
                    dimension="Code Scanning",
                    current_value=current,
                    target_value=target,
                    gap=gap,
                    gap_percentage=gap * 100,
                    recommendation=f"Enable code scanning on {repos_needed} more repositories",
                )
            )

        return gaps
