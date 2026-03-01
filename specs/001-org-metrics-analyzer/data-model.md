# Data Model: GitHub Organization DevOps Metrics Analyzer

**Phase**: 1 (Design)  
**Date**: March 1, 2026  
**Purpose**: Define entities, relationships, and Pydantic schemas for type-safe data flow

---

## Entity Relationship Overview

```
┌──────────────────┐
│  AnalysisResult  │◄──── Top-level container (stored as JSON)
└─────────┬────────┘
          │
          │ 1:N
          ▼
┌──────────────────┐      ┌──────────────────┐
│ RepositoryMetrics│◄────►│  MaturityScore   │
└─────────┬────────┘      └──────────────────┘
          │
          │ 1:N
          ▼
    ┌─────────────┐
    │ WorkflowRun │
    │ PullRequest │
    │ SecurityInfo│
    └─────────────┘
```

**Key Relationships**:
- `AnalysisResult` contains N `RepositoryMetrics` (one per repo)
- `AnalysisResult` contains 1 `MaturityScore` (org-wide)
- `RepositoryMetrics` aggregates data from `WorkflowRun`, `PullRequest`, `SecurityInfo`

---

## 1. Core Entities

### 1.1 AnalysisResult

**Purpose**: Top-level container for a complete analysis run.

**Schema**:
```python
from datetime import datetime
from pydantic import BaseModel, Field

class AnalysisResult(BaseModel):
    """Complete analysis result for a GitHub organization or user."""
    
    # Metadata
    schema_version: str = Field(default="1.0", description="JSON schema version")
    organization: str = Field(..., description="GitHub organization or username")
    analyzed_at: datetime = Field(..., description="Timestamp of analysis")
    tool_version: str = Field(..., description="devex-metrics version")
    analyzer_email: str | None = Field(None, description="Email of user who ran analysis")
    
    # Summary
    maturity_tier: str = Field(..., description="High, Mid, or Low")
    total_score: int = Field(..., ge=0, le=14, description="Sum of dimension scores (0-14)")
    repository_count: int = Field(..., ge=0, description="Total repositories analyzed")
    inactive_repository_count: int = Field(..., ge=0, description="Repos with no commits in 90 days")
    
    # Detailed results
    dimension_scores: DimensionScores
    metrics: OrganizationMetrics
    repositories: list[RepositoryMetrics]
    gaps: list[BenchmarkGap]
```

---

### 1.2 DimensionScores

**Purpose**: Per-dimension maturity scores (0-2 points each).

**Schema**:
```python
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
        return sum([
            self.deployment_automation,
            self.branch_protection,
            self.reusable_workflows,
            self.code_scanning,
            self.audit_trail,
            self.pr_cycle_time,
            self.ci_pass_rate,
        ])
```

---

### 1.3 OrganizationMetrics

**Purpose**: Aggregated metrics across all repositories.

**Schema**:
```python
class OrganizationMetrics(BaseModel):
    """Organization-wide aggregated metrics."""
    
    # Deployment automation
    deployment_automation_rate: float = Field(..., ge=0.0, le=1.0, description="% repos with deploy workflows")
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
```

---

### 1.4 DORAMetrics

**Purpose**: The four key DORA metrics.

**Schema**:
```python
class DORAMetric(BaseModel):
    """Single DORA metric with value and tier."""
    value: float = Field(..., description="Numeric value (e.g., deploys per day)")
    unit: str = Field(..., description="Unit of measurement (e.g., 'per_day', 'hours')")
    tier: str = Field(..., description="Elite, High, Medium, or Low")

class DORAMetrics(BaseModel):
    """DORA 4 key metrics."""
    
    deployment_frequency: DORAMetric = Field(..., description="Deploys per time period")
    lead_time_hours: DORAMetric = Field(..., description="Median hours from PR merge to deploy")
    change_failure_rate: float = Field(..., ge=0.0, le=1.0, description="% of deploys that fail")
    mttr_hours: DORAMetric = Field(..., description="Median hours to restore after failure")
    
    # Supporting data
    total_deployments: int = Field(..., ge=0)
    failed_deployments: int = Field(..., ge=0)
    time_period_days: int = Field(default=90, description="Analysis window (default 90 days)")
```

---

### 1.5 BranchProtectionMetrics

**Purpose**: Branch protection enforcement levels.

**Schema**:
```python
class BranchProtectionMetrics(BaseModel):
    """Branch protection coverage and enforcement."""
    
    full_coverage: float = Field(..., ge=0.0, le=1.0, description="% repos with required reviews + status checks + CODEOWNERS")
    partial_coverage: float = Field(..., ge=0.0, le=1.0, description="% repos with at least one protection rule")
    
    repos_with_required_reviews: int = Field(..., ge=0)
    repos_with_required_status_checks: int = Field(..., ge=0)
    repos_with_codeowners: int = Field(..., ge=0)
    repos_with_admin_enforcement: int = Field(..., ge=0)
```

---

### 1.6 SecurityPostureMetrics

**Purpose**: Security scanning enablement.

**Schema**:
```python
class SecurityPostureMetrics(BaseModel):
    """Security scanning adoption across organization."""
    
    code_scanning_enabled: float = Field(..., ge=0.0, le=1.0, description="% repos with code scanning")
    dependabot_enabled: float = Field(..., ge=0.0, le=1.0, description="% repos with Dependabot")
    secret_scanning_enabled: float = Field(..., ge=0.0, le=1.0, description="% repos with secret scanning")
    
    total_code_scanning_alerts: int = Field(..., ge=0)
    total_dependabot_alerts: int = Field(..., ge=0)
    total_secret_scanning_alerts: int = Field(..., ge=0)
```

---

### 1.7 DeveloperExperienceMetrics

**Purpose**: Metrics affecting developer productivity.

**Schema**:
```python
class TimeMetric(BaseModel):
    """Time-based metric with percentiles."""
    median: float = Field(..., description="Median value")
    p90: float = Field(..., description="90th percentile")
    unit: str = Field(default="hours", description="Time unit")

class DeveloperExperienceMetrics(BaseModel):
    """Developer experience and productivity metrics."""
    
    pr_cycle_time: TimeMetric = Field(..., description="Time from PR open to merge")
    time_to_first_review: TimeMetric = Field(..., description="Time from PR open to first review")
    review_turnaround: TimeMetric = Field(..., description="Time from review request to approval")
    
    ci_pass_rate: float = Field(..., ge=0.0, le=1.0, description="% of PRs passing CI on first run")
    
    total_prs_analyzed: int = Field(..., ge=0)
    median_pr_size_lines: int = Field(..., ge=0, description="Median lines changed per PR")
```

---

### 1.8 ReusableWorkflowMetrics

**Purpose**: Reusable workflow adoption (IDP proxy).

**Schema**:
```python
class ReusableWorkflowMetrics(BaseModel):
    """Reusable workflow adoption as IDP maturity proxy."""
    
    adoption_rate: float = Field(..., ge=0.0, le=1.0, description="% repos using org-level workflows")
    repos_using_shared_workflows: int = Field(..., ge=0)
    total_shared_workflows: int = Field(..., ge=0, description="Unique org-level workflows referenced")
```

---

### 1.9 BenchmarkGap

**Purpose**: Gap between current state and high-maturity threshold.

**Schema**:
```python
class BenchmarkGap(BaseModel):
    """Gap analysis for a single dimension."""
    
    dimension: str = Field(..., description="Dimension name (e.g., 'Deployment Automation')")
    current_value: float = Field(..., description="Current metric value (e.g., 0.45)")
    target_value: float = Field(..., description="High-maturity threshold (e.g., 0.61)")
    gap: float = Field(..., description="Difference (target - current)")
    gap_percentage: float = Field(..., description="Gap as percentage (gap * 100)")
    recommendation: str = Field(..., description="Actionable next step")
```

---

## 2. Repository-Level Entities

### 2.1 RepositoryMetrics

**Purpose**: Metrics for a single repository.

**Schema**:
```python
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
    last_pushed_at: datetime | None = Field(None, description="Last push timestamp")
    
    # Deployment automation
    has_deploy_workflow: bool = Field(default=False)
    deploy_workflow_name: str | None = Field(None)
    deploy_workflow_uses_environment: bool = Field(default=False, description="Uses environment: keyword")
    
    # Branch protection
    branch_protection_score: int = Field(default=0, ge=0, le=3, description="0=none, 1=partial, 2=full, 3=admin enforced")
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
    pr_cycle_time_hours: float | None = Field(None, description="Median PR cycle time (active repos only)")
    ci_pass_rate: float | None = Field(None, ge=0.0, le=1.0, description="CI pass rate (active repos only)")
    
    # Workflow metadata
    total_workflows: int = Field(default=0, ge=0)
    uses_reusable_workflows: bool = Field(default=False)
    reusable_workflows_used: list[str] = Field(default_factory=list, description="List of shared workflow names")
```

---

### 2.2 WorkflowRun

**Purpose**: Represents a single GitHub Actions workflow run.

**Schema**:
```python
class WorkflowRun(BaseModel):
    """GitHub Actions workflow run."""
    
    id: int = Field(..., description="Workflow run ID")
    name: str = Field(..., description="Workflow file name")
    repository: str = Field(..., description="Repository full name")
    
    created_at: datetime
    updated_at: datetime
    
    status: str = Field(..., description="queued, in_progress, completed")
    conclusion: str | None = Field(None, description="success, failure, cancelled, skipped")
    
    event: str = Field(..., description="push, pull_request, schedule, workflow_dispatch")
    head_branch: str = Field(..., description="Branch that triggered the run")
    head_sha: str = Field(..., description="Commit SHA")
    
    is_deploy_workflow: bool = Field(default=False, description="Detected as deploy workflow")
    uses_environment: bool = Field(default=False, description="Uses environment: keyword")
```

---

### 2.3 PullRequest

**Purpose**: Pull request with review metadata.

**Schema**:
```python
class PullRequest(BaseModel):
    """Pull request with review timings."""
    
    number: int = Field(..., description="PR number")
    repository: str = Field(..., description="Repository full name")
    title: str = Field(..., description="PR title")
    
    state: str = Field(..., description="open, closed")
    merged: bool = Field(default=False)
    
    created_at: datetime
    merged_at: datetime | None = Field(None)
    closed_at: datetime | None = Field(None)
    
    # Review timings
    first_review_at: datetime | None = Field(None, description="First review or comment timestamp")
    approved_at: datetime | None = Field(None, description="First approval timestamp")
    
    # Metrics
    additions: int = Field(..., ge=0, description="Lines added")
    deletions: int = Field(..., ge=0, description="Lines deleted")
    changed_files: int = Field(..., ge=0)
    
    # CI status
    ci_passed_on_first_run: bool | None = Field(None, description="Status checks passed on first commit")
    
    def cycle_time_hours(self) -> float | None:
        """Calculate PR cycle time in hours."""
        if self.merged_at and self.created_at:
            delta = self.merged_at - self.created_at
            return delta.total_seconds() / 3600
        return None
    
    def time_to_first_review_hours(self) -> float | None:
        """Calculate time to first review in hours."""
        if self.first_review_at and self.created_at:
            delta = self.first_review_at - self.created_at
            return delta.total_seconds() / 3600
        return None
```

---

### 2.4 SecurityInfo

**Purpose**: Security scanning status for a repository.

**Schema**:
```python
class SecurityInfo(BaseModel):
    """Security scanning status for a repository."""
    
    repository: str = Field(..., description="Repository full name")
    
    # Code scanning
    code_scanning_enabled: bool = Field(default=False)
    code_scanning_alerts: list[dict] = Field(default_factory=list, description="Alert summaries")
    
    # Dependabot
    dependabot_enabled: bool = Field(default=False)
    dependabot_alerts_count: int = Field(default=0, ge=0)
    
    # Secret scanning
    secret_scanning_enabled: bool = Field(default=False)
    secret_scanning_alerts_count: int = Field(default=0, ge=0)
```

---

## 3. Data Flow Through Entities

### Collection → Analysis → Scoring

```python
# 1. Collectors produce raw entities
repositories: list[RepositoryMetrics] = RepositoriesCollector().collect()
workflow_runs: list[WorkflowRun] = WorkflowsCollector().collect()
pull_requests: list[PullRequest] = PullRequestsCollector().collect()

# 2. Analyzers calculate metrics
deployment_rate = DeploymentAutomationAnalyzer().analyze(repositories, workflow_runs)
dora_metrics = DORAMetricsAnalyzer().analyze(workflow_runs, pull_requests)
dev_experience = DeveloperExperienceAnalyzer().analyze(pull_requests)

# 3. Aggregate into OrganizationMetrics
org_metrics = OrganizationMetrics(
    deployment_automation_rate=deployment_rate.rate,
    dora=dora_metrics,
    developer_experience=dev_experience,
    # ...
)

# 4. Scorer calculates dimension scores
dimension_scores = MaturityScorer().calculate_scores(org_metrics)
maturity_tier = MaturityScorer().calculate_tier(dimension_scores)

# 5. Generate gaps
gaps = MaturityScorer().calculate_gaps(org_metrics, dimension_scores)

# 6. Assemble AnalysisResult
analysis = AnalysisResult(
    organization="my-org",
    analyzed_at=datetime.now(),
    maturity_tier=maturity_tier,
    total_score=dimension_scores.total(),
    dimension_scores=dimension_scores,
    metrics=org_metrics,
    repositories=repositories,
    gaps=gaps,
)

# 7. Persist and report
storage.save(analysis)
HTMLReporter().generate(analysis)
```

---

## 4. Validation Rules

### Pydantic Validators

```python
from pydantic import field_validator

class AnalysisResult(BaseModel):
    # ... fields ...
    
    @field_validator('maturity_tier')
    @classmethod
    def validate_tier(cls, v: str) -> str:
        if v not in ['High', 'Mid', 'Low']:
            raise ValueError("Maturity tier must be High, Mid, or Low")
        return v
    
    @field_validator('total_score')
    @classmethod
    def validate_score(cls, v: int) -> int:
        if not 0 <= v <= 14:
            raise ValueError("Total score must be 0-14")
        return v
    
    @field_validator('inactive_repository_count')
    @classmethod
    def validate_inactive_count(cls, v: int, info) -> int:
        if v > info.data.get('repository_count', 0):
            raise ValueError("Inactive count cannot exceed total repository count")
        return v
```

---

## 5. Serialization Examples

### JSON Output (AnalysisResult)

```json
{
  "schema_version": "1.0",
  "organization": "my-org",
  "analyzed_at": "2026-03-01T14:30:00Z",
  "tool_version": "0.1.0",
  "maturity_tier": "Mid",
  "total_score": 7,
  "repository_count": 45,
  "inactive_repository_count": 5,
  "dimension_scores": {
    "deployment_automation": 1,
    "branch_protection": 1,
    "reusable_workflows": 0,
    "code_scanning": 2,
    "audit_trail": 1,
    "pr_cycle_time": 1,
    "ci_pass_rate": 1
  },
  "metrics": { /* ... */ },
  "repositories": [ /* ... */ ],
  "gaps": [ /* ... */ ]
}
```

---

## 6. Schema Evolution Strategy

**Version 1.0** (MVP):
- All entities defined above
- Simple version check: Load JSON, check `schema_version == "1.0"`

**Future Versions**:
- **1.1**: Add new optional fields (backward compatible)
- **2.0**: Add required fields or rename fields (breaking change)

**Migration Strategy**:
```python
def load_analysis(json_path: Path) -> AnalysisResult:
    data = json.loads(json_path.read_text())
    version = data.get('schema_version', '1.0')
    
    if version == '1.0':
        return AnalysisResult.model_validate(data)
    elif version == '1.1':
        # Migrate 1.1 → 1.0 or load as 1.1 model
        return AnalysisResultV1_1.model_validate(data)
    else:
        raise ValueError(f"Unsupported schema version: {version}")
```

---

## Summary

**Entities Defined**: 14 Pydantic models covering analysis results, metrics, and raw data entities

**Key Design Decisions**:
1. **Type-safe**: All entities use Pydantic for runtime validation
2. **Immutable results**: AnalysisResult is append-only (no in-place updates)
3. **Clear ownership**: Each entity has single responsibility (repo metrics, org metrics, DORA, etc.)
4. **Serializable**: All models use JSON-compatible types (str, int, float, datetime)
5. **Extendable**: Schema version field enables future migrations

**Next Step**: Generate `contracts/cli-schema.md` defining CLI interface
