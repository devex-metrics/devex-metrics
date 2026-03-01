"""
State of DevOps 2026 benchmark thresholds.

Hardcoded thresholds from docs/state-of-devops-2026/metrics-reference.md.
"""

from dataclasses import dataclass


@dataclass
class MaturityThresholds:
    """Maturity tier thresholds for each dimension."""

    # Deployment Automation (% repos with deploy workflows)
    deployment_automation_high: float = 0.61  # ≥61% repos automated
    deployment_automation_mid: float = 0.31  # ≥31% repos automated

    # Reusable Workflows (IDP proxy - % repos using shared workflows)
    reusable_workflows_high: float = 0.79  # ≥79% repos use shared workflows
    reusable_workflows_mid: float = 0.21  # ≥21% repos use shared workflows

    # Branch Protection (% repos with full protection)
    branch_protection_full: float = 0.90  # ≥90% repos fully protected
    branch_protection_partial: float = 0.50  # ≥50% repos partially protected

    # Code Scanning (% repos with code scanning enabled)
    code_scanning_high: float = 0.90  # ≥90% repos have code scanning
    code_scanning_mid: float = 0.50  # ≥50% repos have code scanning

    # Audit Trail (% repos with required reviews + CODEOWNERS + linear history)
    audit_trail_high: float = 0.90  # ≥90% repos have full audit trail
    audit_trail_mid: float = 0.50  # ≥50% repos have partial audit trail

    # PR Cycle Time (median hours)
    pr_cycle_time_high: float = 24.0  # <1 day (24 hours)
    pr_cycle_time_mid: float = 168.0  # <1 week (168 hours)

    # CI Pass Rate (% PRs passing on first run)
    ci_pass_rate_high: float = 0.90  # ≥90% pass rate
    ci_pass_rate_mid: float = 0.60  # ≥60% pass rate

    # DORA Metrics (for reference, not scored directly)
    # Deployment Frequency
    deploy_freq_elite_per_day: float = 1.0  # >1 per day
    deploy_freq_high_per_week: float = 1.0  # 1 per week to 1 per day
    deploy_freq_mid_per_month: float = 1.0  # 1 per month to 1 per week

    # Lead Time (hours)
    lead_time_elite_hours: float = 24.0  # <1 day
    lead_time_high_hours: float = 168.0  # 1 day to 1 week
    lead_time_mid_hours: float = 720.0  # 1 week to 1 month

    # Change Failure Rate (%)
    change_failure_rate_elite: float = 0.05  # <5%
    change_failure_rate_high: float = 0.10  # 5-10%
    change_failure_rate_mid: float = 0.15  # 10-15%

    # MTTR (hours)
    mttr_elite_hours: float = 1.0  # <1 hour
    mttr_high_hours: float = 24.0  # 1 hour to 1 day
    mttr_mid_hours: float = 168.0  # 1 day to 1 week


# Global instance
BENCHMARKS = MaturityThresholds()
