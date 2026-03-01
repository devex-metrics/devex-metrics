"""
YAML parser utilities for GitHub Actions workflow files.
"""

from typing import Any, Optional

import yaml


class YAMLParseError(Exception):
    """Raised when YAML parsing fails."""

    pass


def parse_workflow_yaml(content: str) -> dict[str, Any]:
    """
    Parse GitHub Actions workflow YAML content.

    Args:
        content: Workflow YAML file content as string.

    Returns:
        Parsed workflow as dictionary.

    Raises:
        YAMLParseError: If YAML is invalid.
    """
    try:
        workflow = yaml.safe_load(content)
        if not isinstance(workflow, dict):
            raise YAMLParseError("Workflow YAML must be a dictionary")
        return workflow
    except yaml.YAMLError as e:
        raise YAMLParseError(f"Invalid YAML: {str(e)}")


def has_environment_keyword(workflow_content: str) -> bool:
    """
    Check if workflow uses the 'environment:' keyword (deploy workflow detection).

    Args:
        workflow_content: Workflow YAML file content as string.

    Returns:
        True if any job uses 'environment' keyword, False otherwise.
    """
    try:
        workflow = parse_workflow_yaml(workflow_content)
        jobs = workflow.get("jobs", {})

        for job in jobs.values():
            if not isinstance(job, dict):
                continue
            if "environment" in job:
                return True

        return False

    except YAMLParseError:
        # If we can't parse the YAML, assume it's not a deploy workflow
        return False


def extract_reusable_workflows(workflow_content: str) -> list[str]:
    """
    Extract reusable workflow references from a workflow file.

    Looks for 'uses:' in jobs that reference org-level workflows
    (e.g., 'myorg/.github/.github/workflows/shared.yml@main').

    Args:
        workflow_content: Workflow YAML file content as string.

    Returns:
        List of reusable workflow references (e.g., ['org/.github/.github/workflows/shared.yml']).
    """
    try:
        workflow = parse_workflow_yaml(workflow_content)
        jobs = workflow.get("jobs", {})
        reusable_workflows = []

        for job in jobs.values():
            if not isinstance(job, dict):
                continue

            uses = job.get("uses")
            if uses and isinstance(uses, str):
                # Check if it's a reusable workflow reference (contains '.github/workflows/')
                if "/.github/workflows/" in uses:
                    # Extract workflow path (before @ if version specified)
                    workflow_ref = uses.split("@")[0]
                    reusable_workflows.append(workflow_ref)

        return reusable_workflows

    except YAMLParseError:
        return []


def get_workflow_name(workflow_content: str) -> Optional[str]:
    """
    Extract workflow name from YAML content.

    Args:
        workflow_content: Workflow YAML file content as string.

    Returns:
        Workflow name or None if not found.
    """
    try:
        workflow = parse_workflow_yaml(workflow_content)
        return workflow.get("name")
    except YAMLParseError:
        return None
