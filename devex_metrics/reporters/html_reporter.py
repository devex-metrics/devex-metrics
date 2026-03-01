"""
HTML report generator using Jinja2 templates.

Generates self-contained HTML reports with embedded CSS and charts.
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape

from devex_metrics.models import AnalysisResult


class HTMLReporter:
    """Generate HTML reports for analysis results."""

    def __init__(self):
        """Initialize HTML reporter with Jinja2 environment."""
        # Get templates directory
        templates_dir = Path(__file__).parent / "templates"

        # Create Jinja2 environment
        self.env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(["html", "xml"]),
        )

        # Add custom filters
        self.env.filters["percentage"] = self._percentage_filter
        self.env.filters["format_date"] = self._format_date_filter

    def generate_report(
        self, result: AnalysisResult, output_path: Optional[str] = None
    ) -> str:
        """
        Generate HTML report from analysis result.

        Args:
            result: Analysis result to report.
            output_path: Optional output file path. If None, returns HTML string.

        Returns:
            HTML content as string.
        """
        # Load template
        template = self.env.get_template("report.html")

        # Prepare data for template
        context = self._prepare_context(result)

        # Render template
        html_content = template.render(**context)

        # Save to file if path provided
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(html_content)

        return html_content

    def _prepare_context(self, result: AnalysisResult) -> dict:
        """
        Prepare template context from analysis result.

        Args:
            result: Analysis result.

        Returns:
            Dictionary of template variables.
        """
        # Calculate statistics
        active_repos = [r for r in result.repositories if not r.is_archived]
        inactive_repos = [r for r in result.repositories if r.is_inactive]

        # Get tier color
        tier_colors = {
            "High": "#10b981",  # Green
            "Mid": "#f59e0b",  # Amber
            "Low": "#ef4444",  # Red
        }
        tier_color = tier_colors.get(result.maturity_tier, "#6b7280")

        # Determine if org or user (heuristic: check for forward slash in org name)
        owner_type = "User" if "/" not in result.organization and not result.organization.endswith("-org") else "Organization"

        # Prepare dimension scores with colors
        dimensions = [
            {
                "name": "Deployment Automation",
                "score": result.dimension_scores.deployment_automation,
                "max": 2,
            },
            {
                "name": "Branch Protection",
                "score": result.dimension_scores.branch_protection,
                "max": 2,
            },
            {
                "name": "Reusable Workflows",
                "score": result.dimension_scores.reusable_workflows,
                "max": 2,
            },
            {"name": "Code Scanning", "score": result.dimension_scores.code_scanning, "max": 2},
            {"name": "Audit Trail", "score": result.dimension_scores.audit_trail, "max": 2},
            {"name": "PR Cycle Time", "score": result.dimension_scores.pr_cycle_time, "max": 2},
            {"name": "CI Pass Rate", "score": result.dimension_scores.ci_pass_rate, "max": 2},
        ]

        # Prepare gaps with color coding
        gaps_with_status = []
        for gap in result.gaps[:5]:  # Top 5 gaps
            status = "above" if gap.gap <= 0 else "below"
            gaps_with_status.append({"gap": gap, "status": status})

        context = {
            # Meta
            "title": f"DevOps Metrics Report: {result.organization}",
            "generated_at": result.analyzed_at,
            "tool_version": result.tool_version,
            # Summary
            "organization": result.organization,
            "owner_type": owner_type,
            "maturity_tier": result.maturity_tier,
            "total_score": result.total_score,
            "tier_color": tier_color,
            # Repository counts
            "repository_count": result.repository_count,
            "active_repos_count": len(active_repos),
            "inactive_repos_count": len(inactive_repos),
            # Dimensions
            "dimensions": dimensions,
            # Key metrics
            "deployment_automation_rate": result.metrics.deployment_automation_rate,
            "repos_with_deploy_workflow": result.metrics.repos_with_deploy_workflow,
            "branch_protection_full_coverage": result.metrics.branch_protection.full_coverage,
            "branch_protection_partial_coverage": result.metrics.branch_protection.partial_coverage,
            "code_scanning_rate": result.metrics.security.code_scanning_enabled,
            "dependabot_rate": result.metrics.security.dependabot_enabled,
            # Gaps and recommendations
            "gaps": gaps_with_status,
            # Details
            "repositories": result.repositories,
            "metrics": result.metrics,
        }

        return context

    @staticmethod
    def _percentage_filter(value: float) -> str:
        """Format float as percentage."""
        return f"{value * 100:.1f}%"

    @staticmethod
    def _format_date_filter(value: datetime) -> str:
        """Format datetime."""
        if isinstance(value, datetime):
            return value.strftime("%B %d, %Y at %H:%M UTC")
        return str(value)


def generate_html_report(result: AnalysisResult, output_path: str) -> None:
    """
    Convenience function to generate HTML report.

    Args:
        result: Analysis result.
        output_path: Output file path.
    """
    reporter = HTMLReporter()
    reporter.generate_report(result, output_path)
