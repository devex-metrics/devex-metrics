# Implementation Plan: GitHub Organization DevOps Metrics Analyzer

**Branch**: `001-org-metrics-analyzer` | **Date**: March 1, 2026 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-org-metrics-analyzer/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a CLI tool that analyzes GitHub organizations and user accounts to calculate DevOps maturity metrics based on the State of DevOps 2026 benchmarks. The system authenticates via GitHub CLI, collects repository data through GitHub REST API, calculates DORA metrics and maturity scores, and generates HTML reports with embedded visualizations. Results are stored locally as JSON files for historical trend tracking.

## Technical Context

**Language/Version**: Python 3.11+  
**Primary Dependencies**: 
- **GitHub CLI (`gh`)**: Authentication layer - reuses existing user sessions
- **requests** or **httpx**: HTTP client for GitHub REST API calls with retry logic
- **pandas**: Data aggregation and metrics calculation
- **jinja2**: HTML report templating engine
- **plotly** or **chart.js**: Interactive chart generation (embedded in HTML)
- **pyyaml**: Parse GitHub Actions workflow YAML files  
- **click** or **typer**: CLI framework with rich help text

**Storage**: Local JSON files for analysis results (one file per analysis run, timestamped)  
**Testing**: pytest with responses/httpx-mock for GitHub API mocking, fixtures for test data  
**Target Platform**: Cross-platform CLI (Windows, macOS, Linux) via PyPI distribution  
**Project Type**: Library + CLI tool (library-first design enables future GitHub Action integration)  
**Performance Goals**: Analyze 100 repositories in < 5 minutes; handle GitHub API rate limits gracefully  
**Constraints**: 
- GitHub API rate limit: 5,000 requests/hour (authenticated)
- Must work with both github.com and GitHub Enterprise Server
- No external database - local files only
- HTML reports must be self-contained (no external CDN dependencies for offline viewing)

**Scale/Scope**: Support organizations with 100-500 repositories; handle pagination for large orgs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Note**: Constitution file (`.specify/memory/constitution.md`) is currently a template with no defined principles. General software engineering best practices will guide this project:

✅ **Library-First Design**: Core analysis logic will be implemented as a library (`devex_metrics` package) with CLI as a thin wrapper - enables future integrations (GitHub Actions, web dashboard)

✅ **Test-First Development**: TDD will be applied - write tests first for metric calculations, API parsing, and scoring logic before implementation

✅ **Single Responsibility**: Each module handles one concern:
  - `collectors/`: GitHub API data collection only
  - `analyzers/`: Metrics calculation only  
  - `scorers/`: Maturity tier scoring only
  - `reporters/`: HTML generation only

✅ **No Premature Abstraction**: Start with concrete implementations for GitHub; avoid building for "future GitLab support" until actually needed

⚠️ **Complexity Justified**: Multiple data sources (repos, workflows, PRs, branch protection) require separate collectors - this is inherent domain complexity, not over-engineering

✅ **Observability**: All API calls logged with request/response details; progress bars for long operations; detailed error messages referencing spec requirements

**Status**: PASS - No constitutional violations identified

## Project Structure

### Documentation (this feature)

```text
specs/001-org-metrics-analyzer/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - technology research and decisions
├── data-model.md        # Phase 1 output - entity relationships and schemas
├── quickstart.md        # Phase 1 output - getting started guide
└── contracts/           # Phase 1 output - CLI interface contracts
    └── cli-schema.md    # Command-line interface specification
```

### Source Code (repository root)

```text
devex_metrics/                    # Main Python package
├── __init__.py
├── __main__.py                   # Entry point for `python -m devex_metrics`
├── cli.py                        # CLI commands using typer/click
├── version.py                    # Version string
│
├── auth/                         # GitHub authentication
│   ├── __init__.py
│   └── gh_cli.py                # GitHub CLI integration (`gh auth token`)
│
├── collectors/                   # GitHub data collection
│   ├── __init__.py
│   ├── base.py                  # Base collector with rate limit handling
│   ├── repositories.py          # Repository metadata collector
│   ├── workflows.py             # GitHub Actions workflow collector
│   ├── pull_requests.py         # PR metrics collector
│   ├── branch_protection.py     # Branch protection rules collector
│   └── security.py              # Code scanning, Dependabot, secrets collector
│
├── models/                       # Data models (dataclasses/Pydantic)
│   ├── __init__.py
│   ├── repository.py            # Repository entity
│   ├── workflow.py              # Workflow entity
│   ├── pull_request.py          # PR entity
│   ├── metrics.py               # Computed metrics entities
│   └── analysis.py              # Analysis result container
│
├── analyzers/                    # Metric calculation engines
│   ├── __init__.py
│   ├── deployment_automation.py # Deploy workflow detection & automation rate
│   ├── dora_metrics.py          # DORA 4 key metrics calculation
│   ├── branch_protection.py     # Branch protection scoring
│   ├── security_posture.py      # Security metrics aggregation
│   ├── developer_experience.py  # PR cycle time, review times
│   └── reusable_workflows.py    # Reusable workflow adoption rate
│
├── scorers/                      # Maturity tier scoring
│   ├── __init__.py
│   ├── maturity_scorer.py       # Overall maturity tier calculator
│   └── benchmarks.py            # State of DevOps 2026 threshold definitions
│
├── reporters/                    # Output generation
│   ├── __init__.py
│   ├── html_reporter.py         # HTML report generator
│   ├── json_reporter.py         # JSON export
│   ├── templates/               # Jinja2 templates
│   │   ├── report.html          # Main HTML report template
│   │   └── partials/            # Reusable template components
│   └── charts/                  # Chart generation helpers
│       └── plotly_charts.py     # Plotly chart builders
│
├── storage/                      # Local file storage
│   ├── __init__.py
│   └── local_store.py           # JSON file persistence with timestamps
│
└── utils/                        # Shared utilities
    ├── __init__.py
    ├── rate_limiter.py          # GitHub API rate limit tracker
    ├── yaml_parser.py           # Workflow YAML parsing utilities
    └── progress.py              # Progress bar helpers

tests/
├── __init__.py
├── conftest.py                   # Pytest fixtures and configuration
│
├── unit/                         # Unit tests for individual modules
│   ├── test_auth.py
│   ├── test_collectors.py
│   ├── test_analyzers.py
│   ├── test_scorers.py
│   └── test_reporters.py
│
├── integration/                  # Integration tests using API mocks
│   ├── test_full_analysis.py   # End-to-end analysis workflow
│   └── test_github_api.py      # GitHub API interaction patterns
│
├── contract/                     # Contract tests for CLI interface
│   └── test_cli_commands.py    # CLI command structure and output format
│
└── fixtures/                     # Test data
    ├── github_api_responses/    # Mocked GitHub API responses (JSON)
    ├── workflow_files/          # Sample workflow YAML files
    └── expected_outputs/        # Expected analysis results for validation

docs/                             # Project documentation
├── architecture.md              # Architecture overview
├── metrics-calculation.md       # How each metric is calculated
└── extending.md                 # Guide for adding new metrics

pyproject.toml                    # Poetry/setuptools configuration
requirements.txt                  # Production dependencies
requirements-dev.txt              # Development dependencies
README.md                         # Project overview and quick start
LICENSE                           # MIT License
.gitignore                        # Git ignore patterns
```

**Structure Decision**: Single Python package with clear module separation by responsibility. Library-first design allows CLI, GitHub Action, and future web dashboard to reuse the same analysis engine. Collectors are separate from analyzers to enable independent testing and future support for additional data sources (e.g., GitHub GraphQL API for better performance).

## Complexity Tracking

> **No constitutional violations identified.**

The project has inherent domain complexity due to multiple GitHub data sources (repositories, workflows, pull requests, branch protection rules, security scanning), but this complexity is managed through clear module separation and single-responsibility design. Each collector, analyzer, and reporter has one job and can be tested independently.

---

## Data Flow & Architecture

### High-Level Data Flow

```
┌─────────────────┐
│   User Input    │
│ (org/username)  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  GitHub CLI     │◄─── Existing gh auth session
│  Authentication │
└────────┬────────┘
         │ (access token)
         v
┌─────────────────────────────────────────────────────────┐
│              Collectors (parallel execution)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐│
│  │Repos API │  │Workflows │  │    PRs   │  │Security ││
│  │          │  │   API    │  │   API    │  │   APIs  ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘│
│       │             │             │             │     │
│       └─────────────┴─────────────┴─────────────┘     │
│                          │                            │
│                   (raw data models)                   │
└───────────────────────────┬─────────────────────────────┘
                            │
                            v
              ┌──────────────────────┐
              │     Analyzers        │
              │  (metrics engines)   │
              │                      │
              │  - Deploy automation │
              │  - DORA metrics      │
              │  - Branch protection │
              │  - Security posture  │
              │  - Dev experience    │
              └──────────┬───────────┘
                         │
                  (calculated metrics)
                         │
                         v
              ┌──────────────────────┐
              │   Maturity Scorer    │
              │                      │
              │  High/Mid/Low tier   │
              │  Per-dimension scores│
              │  Benchmark gaps      │
              └──────────┬───────────┘
                         │
                  (analysis result)
                         │
                         v
        ┌────────────────┴────────────────┐
        │                                 │
        v                                 v
┌──────────────┐                 ┌──────────────┐
│ JSON Storage │                 │ HTML Reporter│
│              │                 │              │
│ Timestamped  │                 │ Jinja2 +     │
│ local files  │                 │ Plotly charts│
└──────────────┘                 └──────────────┘
```

### Component Responsibilities

#### 1. Authentication Layer (`auth/`)
- **Purpose**: Obtain GitHub access token from GitHub CLI
- **Key Operations**:
  - Execute `gh auth token` to get existing token
  - Verify token has required scopes (repo, read:org, security_events)
  - Handle GitHub Enterprise Server hostnames
- **Failure Mode**: Exit with clear error if `gh` not installed or not authenticated

#### 2. Collectors (`collectors/`)
- **Purpose**: Retrieve raw data from GitHub REST API with rate limit awareness
- **Key Operations**:
  - `RepositoriesCollector`: List all repos in org/user, get metadata
  - `WorkflowsCollector`: Get workflow files, parse YAML, get run history
  - `PullRequestsCollector`: Get PRs with reviews, comments, merge timestamps
  - `BranchProtectionCollector`: Get protection rules for default branches
  - `SecurityCollector`: Get code scanning, Dependabot, secret scanning alerts
- **Rate Limiting Strategy**: 
  - Track remaining requests from API response headers
  - Pause collection when < 100 requests remaining
  - Resume after rate limit reset time
- **Pagination**: Use `Link` header for cursor-based pagination (100 items per page)

#### 3. Analyzers (`analyzers/`)
- **Purpose**: Transform raw data into calculated metrics
- **Key Operations**:
  - `DeploymentAutomationAnalyzer`: 
    - Parse workflow YAML for `environment:` keyword
    - Calculate % repos with deploy workflows
    - Calculate deploy frequency from workflow runs
  - `DORAMetricsAnalyzer`:
    - Deployment Frequency: Count successful deploy runs per time period
    - Lead Time: `PR.merged_at` → next deploy run timestamp
    - Change Failure Rate: Failed deploys / total deploys
    - MTTR: Time from failed deploy → next successful deploy
  - `BranchProtectionAnalyzer`: Score based on required reviews, status checks, CODEOWNERS
  - `SecurityPostureAnalyzer`: Aggregate security scanning enablement across repos
  - `DeveloperExperienceAnalyzer`: Calculate PR cycle time, review times, CI pass rate
- **Data Dependencies**: Analyzers receive data models from collectors, not raw API responses

#### 4. Scorers (`scorers/`)
- **Purpose**: Apply State of DevOps 2026 thresholds to calculate maturity tiers
- **Key Operations**:
  - `MaturityScorer.calculate_tier()`: Apply scoring rules from `benchmarks.py`
  - Each dimension scored 0-2 points based on thresholds
  - Total score mapped to High (10-14) / Mid (5-9) / Low (0-4) tier
- **Benchmark Source**: `scorers/benchmarks.py` hardcodes thresholds from `docs/state-of-devops-2026/metrics-reference.md`

#### 5. Reporters (`reporters/`)
- **Purpose**: Generate human-readable and machine-readable outputs
- **Key Operations**:
  - `HTMLReporter`: Render Jinja2 template with embedded Plotly charts
  - `JSONReporter`: Serialize analysis result to JSON
  - Charts: Bar charts for dimension scores, trend lines for historical data
- **Self-Contained HTML**: Use `plotly.offline` to embed JavaScript inline (no CDN dependencies)

#### 6. Storage (`storage/`)
- **Purpose**: Persist analysis results for historical comparison
- **Key Operations**:
  - Save to `~/.devex-metrics/analyses/{org-name}/{timestamp}.json`
  - Load previous analyses for trend calculation
  - User manually cleans up old files (no automatic retention policy)

---

## Technology Stack Details

### Core Libraries

| Library | Version | Purpose | Why Chosen |
|---------|---------|---------|------------|
| **Python** | 3.11+ | Runtime | Type hints, dataclasses, modern syntax |
| **requests** | 2.31+ | HTTP client | Mature, well-documented, simple retry logic |
| **pandas** | 2.1+ | Data aggregation | Powerful for time-series DORA metrics calculation |
| **pyyaml** | 6.0+ | YAML parsing | Parse workflow files to detect `environment:` keyword |
| **jinja2** | 3.1+ | Templating | HTML report generation with logic |
| **plotly** | 5.18+ | Charting | Interactive charts with offline embedding |
| **typer** | 0.9+ | CLI framework | Type-safe, automatic help generation, rich output |
| **pydantic** | 2.5+ | Data validation | Type-safe data models with validation |
| **pytest** | 7.4+ | Testing | Industry standard, fixtures, parameterization |
| **responses** | 0.24+ | HTTP mocking | Mock GitHub API responses in tests |

### Alternative Considerations

| Decision Point | Options Evaluated | Choice | Rationale |
|---|---|---|---|
| HTTP Client | requests vs httpx vs aiohttp | **requests** | Synchronous is sufficient; API calls are I/O bound but not so frequency-critical to need async |
| CLI Framework | click vs typer vs argparse | **typer** | Type hints, automatic validation, better error messages |
| Data Models | dataclasses vs pydantic vs attrs | **pydantic** | Runtime validation prevents bad data from propagating through pipeline |
| Charting | plotly vs matplotlib vs chart.js | **plotly** | Interactive charts in HTML, offline embedding support |
| YAML Parsing | pyyaml vs ruamel.yaml | **pyyaml** | Sufficient for read-only parsing; no need to preserve comments |

### GitHub API Strategy

**REST vs GraphQL**:
- **Phase 1 (MVP)**: Use REST API for simplicity and clear 1:1 mapping to spec requirements
- **Phase 2 (optimization)**: Consider GraphQL for bulk operations (single query fetches repo + workflows + PRs)

**Authentication**:
- Use GitHub CLI's existing token via `gh auth token`
- Fallback: Read token from `GITHUB_TOKEN` environment variable
- **Scope validation**: Check for `repo`, `read:org`, `security_events` scopes; error if missing

**Rate Limiting**:
- Track from `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers
- Pause collection at < 100 remaining requests
- Show progress: "Rate limit low (50/5000), pausing until XX:XX"

---

## Scoring Engine Design

### Maturity Tier Calculation

The scoring engine applies State of DevOps 2026 benchmarks from `docs/state-of-devops-2026/metrics-reference.md`:

```python
# Pseudo-code for scoring logic
class MaturityScorer:
    def calculate_tier(self, metrics: AnalysisMetrics) -> MaturityTier:
        scores = {
            'deployment_automation': self._score_deploy_automation(metrics),
            'branch_protection': self._score_branch_protection(metrics),
            'reusable_workflows': self._score_reusable_workflows(metrics),
            'code_scanning': self._score_code_scanning(metrics),
            'audit_trail': self._score_audit_trail(metrics),
            'pr_cycle_time': self._score_pr_cycle_time(metrics),
            'ci_pass_rate': self._score_ci_pass_rate(metrics),
        }
        
        total_score = sum(scores.values())  # Each dimension: 0-2 points
        
        if total_score >= 10:
            return MaturityTier.HIGH
        elif total_score >= 5:
            return MaturityTier.MID
        else:
            return MaturityTier.LOW
```

### Per-Dimension Scoring Rules

#### 1. Deployment Automation (0-2 points)
```python
def _score_deploy_automation(self, metrics):
    rate = metrics.deployment_automation_rate  # % repos with deploy workflows
    if rate >= 0.61:  # High-maturity threshold
        return 2
    elif rate >= 0.31:  # Mid-maturity threshold
        return 1
    else:
        return 0
```

#### 2. Branch Protection (0-2 points)
```python
def _score_branch_protection(self, metrics):
    # All repos must have: required reviews + status checks + CODEOWNERS
    if metrics.branch_protection_full_coverage >= 0.90:
        return 2
    elif metrics.branch_protection_partial_coverage >= 0.50:
        return 1
    else:
        return 0
```

#### 3. Reusable Workflows (0-2 points)
```python
def _score_reusable_workflows(self, metrics):
    rate = metrics.reusable_workflow_adoption_rate
    if rate >= 0.79:  # High-maturity IDP proxy
        return 2
    elif rate >= 0.21:
        return 1
    else:
        return 0
```

#### 4-7. Security, Audit, Dev Experience, CI
Similar 3-tier thresholds applied from `metrics-reference.md`

### Benchmark Gap Reporting

```python
def calculate_gaps(self, metrics, tier):
    gaps = []
    if metrics.deployment_automation_rate < 0.61:
        gap_percentage = 0.61 - metrics.deployment_automation_rate
        gaps.append({
            'dimension': 'Deployment Automation',
            'current': f'{metrics.deployment_automation_rate:.0%}',
            'target': '61%',
            'gap': f'{gap_percentage:.0%}',
            'recommendation': f'Automate {gap_percentage * 100:.0f}% more repos to reach High tier'
        })
    return gaps
```

---

## HTML Report Generation Strategy

### Report Structure

```html
<!DOCTYPE html>
<html>
<head>
    <title>DevOps Metrics Report - {org_name}</title>
    <!-- Embedded CSS (no external stylesheets) -->
    <style>
        /* Tailwind-inspired utility classes or custom CSS */
    </style>
    <!-- Plotly.js embedded inline -->
    <script src="data:text/javascript;base64,{plotly_min_js_base64}"></script>
</head>
<body>
    <!-- Executive Summary -->
    <section class="summary">
        <h1>Maturity Tier: {tier} ({score}/14 points)</h1>
        <p>Analysis Date: {timestamp}</p>
        <p>Repositories Analyzed: {repo_count}</p>
    </section>
    
    <!-- Dimension Scores (radar/bar chart) -->
    <section class="scores">
        <div id="dimension-chart"></div>
        <script>
            Plotly.newPlot('dimension-chart', {data}, {layout});
        </script>
    </section>
    
    <!-- DORA Metrics -->
    <section class="dora">
        <h2>DORA 4 Key Metrics</h2>
        <div class="metric-card">
            <h3>Deployment Frequency</h3>
            <p class="value">{deploy_freq}</p>
            <p class="tier">Tier: {dora_tier}</p>
        </div>
        <!-- Repeat for Lead Time, Change Failure Rate, MTTR -->
    </section>
    
    <!-- Benchmark Comparisons -->
    <section class="benchmarks">
        <h2>Gap Analysis</h2>
        <table>
            <tr>
                <th>Dimension</th>
                <th>Current</th>
                <th>High-Maturity Threshold</th>
                <th>Gap</th>
            </tr>
            <!-- Loop through gaps -->
        </table>
    </section>
    
    <!-- Repository-Level Detail Table -->
    <section class="repos">
        <h2>Repository Breakdown</h2>
        <table>
            <tr>
                <th>Repository</th>
                <th>Deploy Workflow</th>
                <th>Branch Protection</th>
                <th>Code Scanning</th>
                <th>PR Cycle Time</th>
            </tr>
            <!-- Loop through repos -->
        </table>
    </section>
    
    <!-- Historical Trends (if previous analyses exist) -->
    <section class="trends">
        <h2>Trend Over Time</h2>
        <div id="trend-chart"></div>
    </section>
</body>
</html>
```

### Chart Specifications

1. **Dimension Scores Radar Chart**:
   - 7 axes (one per dimension)
   - Current org score vs High-maturity threshold
   - Plotly `scatterpolar` type

2. **DORA Metrics Timeline**:
   - Line chart showing deployment frequency over past 90 days
   - Plotly `scatter` with `mode='lines+markers'`

3. **Benchmark Comparison Bar Chart**:
   - Horizontal bars: current value vs threshold
   - Color-coded: green (above), yellow (at), red (below)

### Self-Contained HTML Requirements

- **No CDN dependencies**: Embed Plotly.js as base64 data URI
- **Inline CSS**: All styles in `<style>` tag
- **Offline viewable**: User can open HTML file without internet

### Jinja2 Template Variables

```python
template_context = {
    'org_name': str,
    'timestamp': datetime,
    'tier': 'High' | 'Mid' | 'Low',
    'total_score': int,  # 0-14
    'dimension_scores': dict[str, int],  # 0-2 per dimension
    'dora_metrics': {
        'deployment_frequency': {'value': str, 'tier': str},
        'lead_time': {'value': str, 'tier': str},
        'change_failure_rate': {'value': str, 'tier': str},
        'mttr': {'value': str, 'tier': str},
    },
    'gaps': list[GapAnalysis],
    'repositories': list[RepositoryDetail],
    'historical_data': list[PreviousAnalysis],  # for trend charts
}
```

---

## Local Storage Strategy

### File Layout

```
~/.devex-metrics/                    # User home directory
├── config.json                      # Optional: user preferences (not MVP)
└── analyses/
    ├── my-org/
    │   ├── 2026-03-01T14-30-00.json
    │   ├── 2026-03-08T14-30-00.json
    │   └── 2026-03-15T14-30-00.json
    └── another-org/
        └── 2026-03-01T10-00-00.json
```

### JSON Schema (Analysis Result)

```json
{
  "schema_version": "1.0",
  "metadata": {
    "organization": "my-org",
    "analyzed_at": "2026-03-01T14:30:00Z",
    "tool_version": "0.1.0",
    "analyzer": "github-cli-user@example.com"
  },
  "summary": {
    "maturity_tier": "Mid",
    "total_score": 7,
    "repository_count": 45,
    "inactive_repository_count": 5
  },
  "dimension_scores": {
    "deployment_automation": 1,
    "branch_protection": 1,
    "reusable_workflows": 0,
    "code_scanning": 2,
    "audit_trail": 1,
    "pr_cycle_time": 1,
    "ci_pass_rate": 1
  },
  "metrics": {
    "deployment_automation_rate": 0.45,
    "deploy_workflow_count": 20,
    "dora": {
      "deployment_frequency": {"value": 2.5, "unit": "per_day", "tier": "High"},
      "lead_time_hours": {"median": 18, "p90": 48, "tier": "High"},
      "change_failure_rate": 0.08,
      "mttr_hours": {"median": 2, "p90": 6, "tier": "Elite"}
    },
    "branch_protection": {
      "full_coverage": 0.60,
      "partial_coverage": 0.80
    },
    "security": {
      "code_scanning_enabled": 0.75,
      "dependabot_enabled": 0.90,
      "secret_scanning_enabled": 0.85
    },
    "developer_experience": {
      "pr_cycle_time_hours": {"median": 24, "p90": 72},
      "time_to_first_review_hours": {"median": 4, "p90": 12},
      "ci_pass_rate": 0.88
    }
  },
  "repositories": [
    {
      "name": "api-service",
      "url": "https://github.com/my-org/api-service",
      "default_branch": "main",
      "is_inactive": false,
      "has_deploy_workflow": true,
      "deploy_workflow_name": "deploy.yml",
      "branch_protection_score": 2,
      "code_scanning_enabled": true,
      "pr_cycle_time_hours_median": 18
    }
  ],
  "gaps": [
    {
      "dimension": "Deployment Automation",
      "current_value": 0.45,
      "target_value": 0.61,
      "gap": 0.16,
      "recommendation": "Automate 16% more repos (7 additional repos) to reach High tier"
    }
  ]
}
```

### Retention & Cleanup
- **No automatic cleanup**: User manages disk space
- **CLI command for listing old analyses**: `devex-metrics history list`
- **CLI command for deleting old analyses**: `devex-metrics history clean --before 2025-01-01`

---

## Implementation Phases

### Phase 0: Research & Design (Completed by `/speckit.plan`)
- ✅ Technology stack selection
- ✅ Architecture design
- ✅ Data model definition
- ✅ CLI contract specification
- ✅ Benchmark threshold codification

### Phase 1: Core Data Collection (MVP)
**Goal**: Collect raw data from GitHub for a single organization

**Tasks**:
1. Implement GitHub CLI authentication (`auth/gh_cli.py`)
2. Implement base collector with rate limiting (`collectors/base.py`)
3. Implement repository collector (`collectors/repositories.py`)
4. Implement workflow collector with YAML parsing (`collectors/workflows.py`)
5. Write tests for collectors using mocked API responses

**Success Criteria**:
- Can list all repos in an org
- Can identify repos with deploy workflows (using `environment:` keyword)
- Rate limiting prevents API quota exhaustion

**Estimated Duration**: 1-2 weeks

---

### Phase 2: Metrics Calculation
**Goal**: Transform raw data into calculated metrics

**Tasks**:
1. Implement deployment automation analyzer
2. Implement DORA metrics analyzer (deployment frequency, lead time, CFR, MTTR)
3. Implement branch protection analyzer
4. Implement security posture analyzer
5. Write unit tests for all analyzers

**Success Criteria**:
- Deployment automation rate accurately calculated
- DORA metrics match manual calculation from test data
- All metrics align with definitions in `github-metrics-mapping.md`

**Estimated Duration**: 1-2 weeks

---

### Phase 3: Scoring & Benchmarking
**Goal**: Apply State of DevOps 2026 thresholds to calculate maturity tier

**Tasks**:
1. Implement maturity scorer with hardcoded thresholds from `metrics-reference.md`
2. Implement gap analysis calculator
3. Write tests verifying tier classification aligns with spec

**Success Criteria**:
- Scorer correctly classifies High/Mid/Low tier based on total score
- Gap analysis provides actionable recommendations

**Estimated Duration**: 3-5 days

---

### Phase 4: HTML Report Generation
**Goal**: Generate human-readable reports with charts

**Tasks**:
1. Create Jinja2 HTML template
2. Implement Plotly chart generation (radar, bar, line charts)
3. Embed Plotly.js and CSS inline for self-contained HTML
4. Implement JSON reporter for machine-readable output
5. Test report rendering with sample data

**Success Criteria**:
- HTML report opens offline in browser
- Charts are interactive
- Report matches executive summary mockup

**Estimated Duration**: 1 week

---

### Phase 5: Local Storage & Historical Tracking
**Goal**: Store analyses and show trends over time

**Tasks**:
1. Implement local file storage with timestamped JSON files
2. Implement history loading for trend calculation
3. Add trend charts to HTML report
4. Add CLI commands for listing/cleaning old analyses

**Success Criteria**:
- Multiple analyses of same org stored with unique timestamps
- Trend chart shows metric changes over time
- User can list and clean old analyses

**Estimated Duration**: 3-5 days

---

### Phase 6: Pull Request & Developer Experience Metrics
**Goal**: Add PR cycle time and review time metrics

**Tasks**:
1. Implement PR collector with pagination
2. Implement developer experience analyzer
3. Add inactive repository detection (90-day threshold)
4. Update HTML report to show dev experience metrics

**Success Criteria**:
- PR cycle time calculated correctly (created → merged)
- Inactive repos excluded from quality metrics

**Estimated Duration**: 1 week

---

### Phase 7: CLI Refinement & Error Handling
**Goal**: Polish CLI usability and error messages

**Tasks**:
1. Add progress bars for long operations
2. Improve error messages with actionable suggestions
3. Add `--verbose` flag for detailed logging
4. Add `--format json|html` flag for output selection
5. Write CLI contract tests

**Success Criteria**:
- Clear progress feedback during 5-minute analysis
- Error messages reference spec requirements
- CLI help text is comprehensive

**Estimated Duration**: 3-5 days

---

### Total Estimated Timeline: 6-8 weeks

---

## Risk Mitigation

### Risk 1: GitHub API Rate Limits
**Likelihood**: High (orgs with 100+ repos generate 500+ API calls)  
**Impact**: Analysis fails mid-run, incomplete data

**Mitigation**:
- Implement rate limit tracking from response headers
- Pause collection at < 100 remaining requests
- Resume after reset time (show countdown timer)
- Use conditional requests (`If-None-Match`) to save quota on unchanged data

---

### Risk 2: Workflow File Parsing Complexity
**Likelihood**: Medium (workflow YAML can be complex with templates/matrices)  
**Impact**: False negatives (deploy workflows not detected)

**Mitigation**:
- Start with simple keyword detection (`environment:` in YAML)
- Document known limitations (e.g., dynamic environment names via variables)
- Add `--deploy-workflow-pattern` CLI flag for custom detection patterns
- Log all workflows analyzed for manual review

---

### Risk 3: DORA Metrics Data Availability
**Likelihood**: Medium (historical data may not exist for new repos)  
**Impact**: DORA metrics show "insufficient data" instead of calculated values

**Mitigation**:
- Require minimum 7 days of workflow run history for DORA calculations
- Show "N/A" with explanation when data insufficient
- Document minimum data requirements in report

---

### Risk 4: GitHub Enterprise Server API Differences
**Likelihood**: Medium (some endpoints may not exist or have different schemas)  
**Impact**: Analysis fails for Enterprise customers

**Mitigation**:
- Test against both github.com and GitHub Enterprise Server
- Detect API version and feature availability at runtime
- Gracefully degrade missing features (e.g., no code scanning = score 0)

---

### Risk 5: HTML Report Size with Large Orgs
**Likelihood**: Low (only affects orgs with 500+ repos)  
**Impact**: 10MB+ HTML files are slow to open in browser

**Mitigation**:
- Paginate repository detail table (show top 50, rest in expandable sections)
- Compress embedded Plotly.js with gzip
- Offer `--summary-only` flag to exclude per-repo details

---

## Success Metrics (Post-Launch)

1. **Functional Correctness**:
   - All maturity tier classifications match manual calculations (100% accuracy)
   - DORA metrics match reference calculations from test data

2. **Performance**:
   - Analyze 100 repos in < 5 minutes on standard network
   - No API rate limit exhaustion for orgs < 200 repos

3. **Usability**:
   - Non-technical executives can understand HTML report without documentation
   - Error messages result in < 2 support requests per 100 users

4. **Adoption** (if open-sourced):
   - 50+ organizations run analysis in first 3 months
   - 10+ GitHub stars in first month

---

## Next Steps (Phase 0 → Phase 1 Transition)

1. **Generate `research.md`** (Phase 0):
   - Document final technology choices (Python 3.11, requests, plotly, typer)
   - Research GitHub CLI token handling best practices
   - Research plotly offline embedding techniques

2. **Generate `data-model.md`** (Phase 1):
   - Define Pydantic models for Repository, Workflow, PullRequest, AnalysisResult
   - Define relationships between entities

3. **Generate `contracts/cli-schema.md`** (Phase 1):
   - Define CLI commands: `analyze`, `history`, `version`
   - Define CLI flags: `--org`, `--format`, `--output`, `--verbose`
   - Define exit codes and error messages

4. **Update agent context** (Phase 1):
   - Run `.specify/scripts/powershell/update-agent-context.ps1 -AgentType copilot`
   - Add Python, pytest, GitHub CLI to technology context

5. **Generate `tasks.md`** (Phase 2 - not part of `/speckit.plan`):
   - Break implementation phases into granular tasks
   - Assign priorities and dependencies

---

## Appendix: Key Decisions

### Why Python over TypeScript/PowerShell?
- **Ecosystem**: pandas for DORA time-series, plotly for charts, pyyaml for parsing
- **GitHub CLI exists**: No need to reimplement GitHub API client
- **Data processing**: pandas excels at metrics aggregation (e.g., median PR cycle time)
- **Deployment**: PyPI distribution simpler than npm for CLI tools

### Why Plotly over Chart.js?
- **Python-native**: Generate charts in Python, not JavaScript
- **Offline embedding**: `plotly.offline` supports self-contained HTML
- **Interactivity**: Hover tooltips, zoom, pan built-in

### Why REST API over GraphQL?
- **Simplicity**: 1:1 mapping to spec requirements, easier to debug
- **Documentation**: REST API examples more prevalent in Stack Overflow
- **Future**: Can migrate to GraphQL in Phase 2 for performance optimization

### Why Local Files over SQLite?
- **Portability**: JSON files can be copied, backed up, version-controlled
- **Simplicity**: No schema migrations, just append new analysis files
- **Querying**: Trend analysis only needs last N analyses, not SQL queries

---

**Plan Status**: COMPLETE - Ready for Phase 0 (research.md generation)
