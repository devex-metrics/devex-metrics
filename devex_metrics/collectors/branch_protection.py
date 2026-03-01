"""
Branch protection collector for GitHub repositories.

Fetches branch protection rules for default branches.
"""

from typing import Optional

from devex_metrics.collectors.base import BaseCollector


class BranchProtectionCollector(BaseCollector):
    """Collect branch protection rules from GitHub repositories."""

    def __init__(self, token: str, owner: str, base_url: str = "https://api.github.com"):
        """
        Initialize branch protection collector.

        Args:
            token: GitHub personal access token.
            owner: GitHub organization or username.
            base_url: GitHub API base URL.
        """
        super().__init__(token, base_url)
        self.owner = owner

    def get_branch_protection(self, repo_name: str, branch: str = "main") -> Optional[dict]:
        """
        Get branch protection rules for a specific branch.

        Args:
            repo_name: Repository name.
            branch: Branch name (default: main).

        Returns:
            Branch protection data dictionary, or None if not protected.
        """
        try:
            return self.get(f"/repos/{self.owner}/{repo_name}/branches/{branch}/protection")
        except Exception:
            # Branch might not be protected or might not exist
            # Try common default branches
            if branch == "main":
                try:
                    return self.get(
                        f"/repos/{self.owner}/{repo_name}/branches/master/protection"
                    )
                except Exception:
                    pass
            return None

    def analyze_protection_level(self, protection_data: Optional[dict]) -> dict[str, any]:
        """
        Analyze branch protection rules and return a summary.

        Args:
            protection_data: Branch protection data from GitHub API.

        Returns:
            Dictionary with protection analysis:
            - score: 0-3 (0=none, 1=partial, 2=full, 3=admin enforced)
            - has_required_reviews: bool
            - has_required_status_checks: bool
            - has_codeowners: bool
            - admin_enforcement: bool
        """
        if not protection_data:
            return {
                "score": 0,
                "has_required_reviews": False,
                "has_required_status_checks": False,
                "has_codeowners": False,
                "admin_enforcement": False,
            }

        # Check for required reviews
        reviews = protection_data.get("required_pull_request_reviews", {})
        has_required_reviews = reviews != {}
        has_codeowners = reviews.get("require_code_owner_reviews", False)

        # Check for required status checks
        status_checks = protection_data.get("required_status_checks", {})
        has_required_status_checks = status_checks != {}

        # Check for admin enforcement
        enforce_admins = protection_data.get("enforce_admins", {})
        admin_enforcement = enforce_admins.get("enabled", False)

        # Calculate score
        score = 0
        if has_required_reviews or has_required_status_checks:
            score = 1  # Partial protection

        if has_required_reviews and has_required_status_checks and has_codeowners:
            score = 2  # Full protection

        if score == 2 and admin_enforcement:
            score = 3  # Admin enforced

        return {
            "score": score,
            "has_required_reviews": has_required_reviews,
            "has_required_status_checks": has_required_status_checks,
            "has_codeowners": has_codeowners,
            "admin_enforcement": admin_enforcement,
        }

    def check_codeowners_file(self, repo_name: str) -> bool:
        """
        Check if repository has a CODEOWNERS file.

        Args:
            repo_name: Repository name.

        Returns:
            True if CODEOWNERS file exists, False otherwise.
        """
        # CODEOWNERS can be in multiple locations
        locations = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]

        for location in locations:
            try:
                self.get(f"/repos/{self.owner}/{repo_name}/contents/{location}")
                return True
            except Exception:
                continue

        return False
