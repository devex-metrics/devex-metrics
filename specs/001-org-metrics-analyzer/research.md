# Research & Technology Decisions: GitHub Organization DevOps Metrics Analyzer

**Phase**: 0 (Research)  
**Date**: March 1, 2026  
**Status**: Complete

## Purpose

Document technology stack decisions, architecture patterns, and implementation approaches for the GitHub Organization DevOps Metrics Analyzer. All decisions are based on the feature specification, State of DevOps 2026 benchmark documentation, and GitHub API capabilities.

---

## 1. Programming Language Selection

### Decision: Python 3.11+

### Rationale

**Strengths**:
- **Rich ecosystem for data processing**: pandas for time-series DORA metrics, NumPy for statistical calculations
- **GitHub API libraries**: PyGithub, ghapi exist if needed, but we'll use requests + GitHub CLI
- **CLI frameworks**: typer provides type-safe CLI with automatic help generation
- **HTML templating**: Jinja2 is mature and well-documented
- **Charting libraries**: plotly has excellent Python support with offline HTML embedding
- **YAML parsing**: pyyaml is the standard library for workflow file analysis
- **Cross-platform**: Runs on Windows, macOS, Linux without compilation

**Alternatives Considered**:

| Language | Pros | Cons | Rejection Reason |
|----------|------|------|------------------|
| **TypeScript/Node.js** | GitHub Octokit SDK, strong typing, async I/O | Weaker data processing libraries than Python, chart.js requires more manual setup | Pandas equivalent (danfo.js) less mature; pandas excels at DORA time-series calculations |
| **PowerShell** | Native on Windows, good GitHub CLI integration | Limited ecosystem for data processing and charting, harder cross-platform distribution | No equivalent to pandas/plotly; JSON parsing verbose |
| **Go** | Fast, single binary, good HTTP client | Weak data science ecosystem, no native charting, more verbose for data transformation | Overkill for I/O-bound task; data processing harder than Python |

**Final Verdict**: Python 3.11+ offers the best balance of data processing power, GitHub API integration, and HTML report generation capabilities.

---

## 2. GitHub Authentication Strategy

### Decision: GitHub CLI (`gh`) Token Integration

### Rationale

**Why GitHub CLI**:
- Users likely already have `gh` installed and authenticated
- Reuses existing session - no need to ask users for personal access tokens
- Handles OAuth device flow, token storage, and refresh automatically
- Command: `gh auth token` returns current token, `gh auth status` checks scopes
- Works with both github.com and GitHub Enterprise Server

**Implementation Approach**:
```python
import subprocess

def get_github_token() -> str:
    result = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True)
    if result.returncode != 0:
        raise AuthenticationError("GitHub CLI not authenticated. Run: gh auth login")
    return result.stdout.strip()
```

**Scope Verification**:
- Required scopes: `repo`, `read:org`, `security_events` (for code scanning)
- Check via: `gh auth status -t` to verify token has required permissions
- Error early if scopes missing with actionable message

**Fallback**: Accept `GITHUB_TOKEN` environment variable if `gh` not installed (for CI/CD environments)

**Alternatives Considered**:
- **OAuth App**: Too complex, requires user registration + consent flow
- **PAT in config file**: Security risk, users forget to rotate tokens
- **Interactive prompt**: Worse UX than reusing existing `gh auth`

---

## 3. GitHub API Strategy

### Decision: REST API v3 with Rate Limit Awareness

### Rationale

**Why REST over GraphQL** (for MVP):
- **Simplicity**: Each endpoint maps 1:1 to spec requirements (`GET /repos/{owner}/{repo}`)
- **Documentation**: More Stack Overflow examples, easier debugging
- **Specification alignment**: `github-metrics-mapping.md` references REST endpoints explicitly
- **Rate limit clarity**: REST has fixed 5,000 req/hr limit; GraphQL has complex point system

**GraphQL Migration Path** (future optimization):
- Phase 2: Use GraphQL to fetch repo + workflows + PRs in single query
- Reduces API calls from ~10 per repo to ~2 per repo
- Enables faster analysis for orgs with 500+ repos

**Rate Limiting Strategy**:
```python
class RateLimiter:
    def __init__(self, session: requests.Session):
        self.session = session
        self.remaining = 5000
        self.reset_time = None
    
    def check_and_wait(self, response: requests.Response):
        self.remaining = int(response.headers.get('X-RateLimit-Remaining', 5000))
        self.reset_time = int(response.headers.get('X-RateLimit-Reset', 0))
        
        if self.remaining < 100:
            wait_seconds = self.reset_time - time.time()
            print(f"Rate limit low ({self.remaining}/5000). Pausing {wait_seconds}s...")
            time.sleep(wait_seconds + 5)
```

**Pagination Strategy**:
- Use `Link` header for cursor-based pagination (standard for GitHub API)
- Fetch 100 items per page (max allowed)
- For large orgs (500+ repos), show progress: "Fetching repos: 100/550..."

**Endpoint Usage**:
| Data Source | Endpoint | Calls per Repo |
|-------------|----------|----------------|
| Repository metadata | `GET /repos/{owner}/{repo}` | 1 |
| Workflows list | `GET /repos/{owner}/{repo}/actions/workflows` | 1 |
| Workflow runs | `GET /repos/{owner}/{repo}/actions/runs?per_page=100` | ~1-3 (paginated) |
| Pull requests | `GET /repos/{owner}/{repo}/pulls?state=closed&per_page=100` | ~3-5 (90 days) |
| Branch protection | `GET /repos/{owner}/{repo}/branches/{branch}/protection` | 1 |
| Code scanning | `GET /repos/{owner}/{repo}/code-scanning/alerts` | 1 |

**Total**: ~10-15 API calls per repository → 100 repos = 1,000-1,500 calls (well under 5,000 limit)

---

## 4. Deployment Workflow Detection

### Decision: Strict Keyword Detection (`environment:` in workflow YAML)

### Rationale

Per specification clarification: "Only workflows using `environment:` keyword (strict, fewer false positives)."

**Implementation**:
```python
import yaml

def has_deploy_workflow(workflow_content: str) -> bool:
    try:
        workflow = yaml.safe_load(workflow_content)
        # Check all jobs for 'environment' key
        for job in workflow.get('jobs', {}).values():
            if 'environment' in job:
                return True
        return False
    except yaml.YAMLError:
        return False
```

**Why not name-based detection** (e.g., `deploy.yml`):
- Names are unreliable (some orgs use `release.yml`, `production.yml`, `cd.yml`)
- `environment:` keyword is GitHub's official way to specify deployment targets
- Reduces false positives (test workflows named `deploy-test.yml` excluded)

**Limitations** (documented in report):
- Workflows using dynamic environment names via `${{ vars.ENVIRONMENT }}` may not be detected
- Workaround: Provide `--deploy-workflow-pattern` CLI flag for custom detection

---

## 5. HTML Report Generation

### Decision: Jinja2 Templates + Plotly Offline Charts

### Rationale

**Why Jinja2**:
- Standard Python templating engine
- Supports logic in templates (loops, conditionals)
- Clear separation between data and presentation

**Why Plotly over alternatives**:

| Library | Pros | Cons | Verdict |
|---------|------|------|---------|
| **Plotly** | Python API, interactive charts, offline embedding with `plotly.offline.plot()`, exports to standalone HTML | Larger file size (~3MB for plotly.js) | ✅ **Chosen** - Best Python integration |
| **Matplotlib** | Mature, lightweight static images | No interactivity, requires base64 image embedding, not suitable for drill-down | ❌ Not interactive enough for executive reports |
| **Chart.js** | Lightweight (~200KB), popular | Requires manually constructing JavaScript, no Python API, harder to maintain | ❌ Too much manual JavaScript |

**Self-Contained HTML Strategy**:
```python
import plotly.graph_objects as go
from plotly.offline import plot

fig = go.Figure(data=[...])
html_div = plot(fig, include_plotlyjs='cdn', output_type='div')  # For testing

# For production (self-contained):
html_div = plot(fig, include_plotlyjs='inline', output_type='div')  # Embeds plotly.js
```

**File Size Management**:
- Use `include_plotlyjs='inline'` to embed plotly.min.js (~3MB gzipped)
- For orgs with 500+ repos, offer `--summary-only` flag to exclude per-repo table (reduces HTML size)

**Chart Types**:
1. **Radar Chart**: Dimension scores (7 axes) vs High-maturity thresholds
2. **Bar Chart**: Benchmark comparisons (current vs target)
3. **Line Chart**: DORA metrics trends over time (if historical data exists)
4. **Table**: Repository-level details (sortable, filterable via JavaScript)

---

## 6. Data Processing & Metrics Calculation

### Decision: Pandas for Time-Series Aggregation

### Rationale

**Why Pandas**:
- **DORA metrics require time-series calculations**:
  - Deployment Frequency: Count successful deploys per day/week
  - Lead Time: `PR.merged_at` → next deploy timestamp (requires timestamp math)
  - MTTR: Failed deploy → successful deploy (time delta calculation)
- **Statistical functions**: `df.median()`, `df.quantile(0.90)` for P90 calculations
- **Groupby operations**: Group PRs by repository, calculate median cycle time per repo
- **Date/time handling**: `pd.to_datetime()` handles ISO 8601 timestamps from GitHub API

**Example - Deployment Frequency Calculation**:
```python
import pandas as pd

def calculate_deployment_frequency(workflow_runs: list[dict]) -> float:
    df = pd.DataFrame(workflow_runs)
    df['created_at'] = pd.to_datetime(df['created_at'])
    df = df[df['conclusion'] == 'success']  # Only successful runs
    
    # Group by date, count deploys per day
    daily_deploys = df.groupby(df['created_at'].dt.date).size()
    return daily_deploys.mean()  # Average deploys per day
```

**Alternatives Considered**:
- **Plain Python loops**: Too verbose for time-series operations, no built-in quantile functions
- **NumPy**: Good for arrays, but lacks DataFrame structure for heterogeneous data (timestamps + strings + ints)

---

## 7. CLI Framework Selection

### Decision: Typer

### Rationale

**Why Typer over Click/Argparse**:
- **Type hints**: Function signature defines CLI interface automatically
- **Automatic validation**: `--org: str` enforces string input, helpful error messages
- **Rich output**: Built-in progress bars, colored output, tables via `rich` integration
- **Less boilerplate**: No manual `@click.option()` decorators

**Example**:
```python
import typer
from rich.progress import track

app = typer.Typer()

@app.command()
def analyze(
    org: str = typer.Argument(..., help="GitHub organization or username"),
    format: str = typer.Option("html", help="Output format: html or json"),
    output: Path = typer.Option(None, help="Output file path"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable debug logging")
):
    """Analyze GitHub organization DevOps metrics."""
    typer.echo(f"Analyzing {org}...")
    for repo in track(repos, description="Collecting data..."):
        # ... collection logic
```

**CLI Structure**:
```bash
devex-metrics analyze my-org --format html --output report.html
devex-metrics history list my-org
devex-metrics history clean --before 2025-01-01
devex-metrics version
```

---

## 8. Local Storage Format

### Decision: Timestamped JSON Files in `~/.devex-metrics/`

### Rationale

**Why JSON over SQLite**:
- **Portability**: Files can be copied, backed up, version-controlled
- **Schema-less**: No migrations needed when adding new metrics
- **Simple querying**: Load last N files for trend analysis, no SQL needed
- **Human-readable**: Users can inspect results without special tools

**File Structure**:
```
~/.devex-metrics/
└── analyses/
    └── my-org/
        ├── 2026-03-01T14-30-00.json  # ISO 8601 timestamp in filename
        ├── 2026-03-08T14-30-00.json
        └── 2026-03-15T14-30-00.json
```

**JSON Schema Design**:
- Use Pydantic models with `.model_dump_json()` for serialization
- Include `schema_version` field for future compatibility
- Store both raw metrics and calculated scores for reproducibility

**Trend Analysis**:
```python
def load_historical_analyses(org: str, limit: int = 10) -> list[AnalysisResult]:
    analyses_dir = Path.home() / '.devex-metrics' / 'analyses' / org
    json_files = sorted(analyses_dir.glob('*.json'), reverse=True)[:limit]
    return [AnalysisResult.model_validate_json(f.read_text()) for f in json_files]
```

**Retention Policy**: None - user manages cleanup via `devex-metrics history clean` command

---

## 9. Testing Strategy

### Decision: Pytest with HTTP Mocking via `responses`

### Test Types

#### 1. Unit Tests (`tests/unit/`)
- Test individual analyzers with synthetic data
- Test scorers with known inputs → expected tier outputs
- Mock GitHub API responses using `responses` library

**Example**:
```python
import responses
from devex_metrics.collectors import RepositoriesCollector

@responses.activate
def test_repositories_collector():
    responses.add(
        responses.GET,
        'https://api.github.com/orgs/my-org/repos',
        json=[{'name': 'repo1', 'default_branch': 'main'}],
        status=200,
        headers={'X-RateLimit-Remaining': '4999'}
    )
    
    collector = RepositoriesCollector('my-org', token='fake-token')
    repos = collector.collect()
    
    assert len(repos) == 1
    assert repos[0].name == 'repo1'
```

#### 2. Integration Tests (`tests/integration/`)
- Test full analysis workflow with mocked GitHub API
- Use fixtures in `tests/fixtures/github_api_responses/`
- Verify end-to-end: input org → HTML report generation

#### 3. Contract Tests (`tests/contract/`)
- Test CLI command structure and output formats
- Verify exit codes and error messages
- Ensure backward compatibility as features evolve

**Test Data Fixtures**:
- Store sample GitHub API responses as JSON files
- Store sample workflow YAML files for parser testing
- Store expected analysis results for regression testing

---

## 10. Inactive Repository Handling

### Decision: 90-Day Threshold, Exclude from Quality Metrics Only

### Rationale

Per specification: "Include inactive repos in counts but exclude from quality metrics to prevent skewing results."

**Implementation**:
```python
def is_inactive(repo: Repository) -> bool:
    if not repo.pushed_at:
        return True
    days_since_push = (datetime.now() - repo.pushed_at).days
    return days_since_push > 90
```

**Application**:
- **Include in coverage metrics**:
  - Deployment automation rate: `repos_with_deploy_workflow / total_repos` (includes inactive)
  - Reusable workflow adoption: `repos_using_shared_workflows / total_repos` (includes inactive)
- **Exclude from quality metrics**:
  - PR cycle time: Calculate median only from active repos
  - CI pass rate: Calculate only from active repos with recent workflow runs
  - Time to first review: Calculate only from active repos

**Reporting**: Show inactive count in report summary: "45 repositories analyzed (5 inactive)"

---

## 11. Benchmark Threshold Codification

### Decision: Hardcode Thresholds in `scorers/benchmarks.py`

### Rationale

State of DevOps 2026 thresholds are stable, not user-configurable:

```python
# scorers/benchmarks.py
from dataclasses import dataclass

@dataclass
class MaturityThresholds:
    deployment_automation_high: float = 0.61  # ≥61% repos automated
    deployment_automation_mid: float = 0.31   # ≥31% repos automated
    
    reusable_workflows_high: float = 0.79     # ≥79% repos use shared workflows
    reusable_workflows_mid: float = 0.21
    
    branch_protection_full: float = 0.90      # ≥90% repos fully protected
    branch_protection_partial: float = 0.50
    
    # DORA thresholds (from metrics-reference.md)
    deployment_frequency_elite: str = ">1 per day"
    deployment_frequency_high: str = "1 per week - 1 per day"
    
    # ... etc
```

**Future**: If DORA publishes updated thresholds, update `benchmarks.py` and bump `schema_version` in JSON output

---

## 12. Error Handling Strategy

### Decision: Fail-Fast with Actionable Error Messages

### Rationale

**User-Facing Errors Must**:
1. Explain what went wrong
2. Reference the spec requirement that failed
3. Provide actionable next steps

**Example Error Messages**:
```python
# Bad:
raise Exception("API call failed")

# Good:
raise GitHubAPIError(
    "Failed to fetch repositories for organization 'my-org'. "
    "Ensure the organization exists and you have read access. "
    "Spec requirement: FR-003 (enumerate all accessible repositories). "
    "GitHub API error: 404 Not Found"
)
```

**Error Categories**:
1. **Authentication errors**: Missing `gh`, invalid token, insufficient scopes
2. **API errors**: Rate limit, 404 not found, 403 forbidden
3. **Data validation errors**: Invalid org name format, no repos found
4. **File I/O errors**: Cannot write to output path, disk full

**Logging Strategy**:
- **Default (non-verbose)**: Show progress and errors only
- **Verbose (`--verbose`)**: Log all API calls with request/response details
- Use Python's `logging` module with structured messages

---

## 13. Performance Considerations

### Targets (from spec)
- **100 repos in < 5 minutes**: ~3 seconds per repo average
- **Handle 500+ repos**: ~15-25 minutes (acceptable for batch analysis)

### Optimization Strategies

#### 1. Parallel API Calls (Future)
```python
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=10) as executor:
    futures = [executor.submit(collect_repo_data, repo) for repo in repos]
    results = [f.result() for f in futures]
```

**Why not in MVP**: Add complexity, harder to debug. Sequential is sufficient for 100 repos.

#### 2. Caching (Future)
- Cache repository metadata for 1 hour (repos rarely change names/descriptions)
- Skip refetching workflow runs that already exist in local storage
- Use `If-None-Match` header with ETags for conditional requests

#### 3. GraphQL Migration (Phase 2)
- Fetch repo + workflows + last 100 PRs in single query
- Reduces API calls from ~10 per repo to ~2 per repo
- Requires learning GitHub GraphQL schema (added complexity)

---

## 14. Documentation Strategy

### Types of Documentation

1. **User Documentation** (`README.md`):
   - Installation instructions (pip install)
   - Quick start guide
   - Example commands
   - Troubleshooting common errors

2. **Developer Documentation** (`docs/`):
   - `architecture.md`: Component overview, data flow diagrams
   - `metrics-calculation.md`: How each metric is calculated (references `github-metrics-mapping.md`)
   - `extending.md`: How to add new metrics or collectors

3. **Specification References**:
   - Link to `specs/001-org-metrics-analyzer/spec.md` from README
   - Link to `docs/state-of-devops-2026/metrics-reference.md` for benchmark definitions

4. **Code Comments**:
   - Docstrings for all public functions (Google style)
   - Inline comments for complex calculations (e.g., DORA lead time logic)

---

## 15. Dependency Management

### Decision: Use `pyproject.toml` with Poetry (or setuptools)

### Production Dependencies

```toml
[project]
name = "devex-metrics"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "requests>=2.31.0",
    "pandas>=2.1.0",
    "pyyaml>=6.0",
    "jinja2>=3.1.0",
    "plotly>=5.18.0",
    "typer>=0.9.0",
    "pydantic>=2.5.0",
    "rich>=13.0.0",  # For typer progress bars
]
```

### Development Dependencies

```toml
[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-cov>=4.1.0",
    "responses>=0.24.0",  # HTTP mocking
    "black>=23.0.0",      # Code formatting
    "ruff>=0.1.0",        # Linting
    "mypy>=1.7.0",        # Type checking
]
```

### Why Poetry optional, setuptools sufficient:
- Poetry better for dependency resolution, but adds setup complexity
- Setuptools + `pyproject.toml` sufficient for single-package CLI tool
- Decision: Start with setuptools, migrate to Poetry if dependency conflicts arise

---

## Research Summary

All technical decisions resolved. No blockers for implementation.

**Key Decisions**:
1. ✅ Python 3.11+ with pandas for data processing
2. ✅ GitHub CLI token integration for authentication
3. ✅ REST API v3 with rate limit tracking
4. ✅ Jinja2 + Plotly for self-contained HTML reports
5. ✅ Timestamped JSON files for local storage
6. ✅ Pytest with HTTP mocking for testing
7. ✅ Typer for CLI with rich output

**Next Phase**: Generate `data-model.md` (entity relationships and Pydantic schemas)
