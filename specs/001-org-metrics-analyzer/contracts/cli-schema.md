# CLI Interface Contract: devex-metrics

**Phase**: 1 (Design)  
**Date**: March 1, 2026  
**Purpose**: Define command-line interface specification for the devex-metrics tool

---

## Overview

The `devex-metrics` CLI is the primary user interface for analyzing GitHub organizations. It follows Unix conventions: arguments for required inputs, options/flags for optional configuration, exit codes for automation, and machine-readable JSON output available alongside human-readable HTML.

---

## Installation

```bash
pip install devex-metrics
```

**Entry Point**: `devex-metrics` command (console script defined in `pyproject.toml`)

---

## Commands

### 1. `analyze` - Analyze Organization Metrics

**Purpose**: Collect data from GitHub and generate DevOps maturity report.

**Syntax**:
```bash
devex-metrics analyze <ORG> [OPTIONS]
```

**Arguments**:
- `<ORG>` (required): GitHub organization or username to analyze

**Options**:
- `--format <html|json>` (default: `html`): Output format
- `--output <PATH>` (optional): Output file path (default: `{org}-report-{timestamp}.html`)
- `--verbose` / `-v` (flag): Enable debug logging
- `--no-cache` (flag): Skip cached data, force fresh API calls
- `--deploy-workflow-pattern <PATTERN>` (optional): Custom regex pattern for deploy workflow detection (default: detect `environment:` keyword)

**Examples**:
```bash
# Analyze organization, generate HTML report
devex-metrics analyze my-org

# Analyze with custom output path
devex-metrics analyze my-org --output /reports/my-org.html

# Generate JSON output for programmatic use
devex-metrics analyze my-org --format json --output my-org.json

# Verbose logging for debugging
devex-metrics analyze my-org --verbose
```

**Exit Codes**:
- `0`: Success - analysis completed, report generated
- `1`: Authentication error (GitHub CLI not authenticated)
- `2`: API error (rate limit exceeded, 404 not found, network error)
- `3`: Validation error (invalid org name, no repositories found)
- `4`: File I/O error (cannot write output file)

**Output** (stdout):
```
Analyzing organization: my-org
Fetching repositories...  [████████████████████] 100% (45/45)
Collecting workflows...   [████████████████████] 100% (45/45)
Analyzing pull requests... [████████████████████] 100% (450/450)
Calculating metrics...    ✓
Generating report...      ✓

Analysis Complete
─────────────────
Maturity Tier: Mid (7/14 points)
Repositories Analyzed: 45 (5 inactive)
Report saved to: my-org-report-2026-03-01T14-30-00.html

Top Recommendations:
• Increase deployment automation: 45% → 61% target (7 more repos)
• Enable code scanning on 10 additional repositories
• Add CODEOWNERS files to 15 repositories
```

**Progress Indicators**:
- Progress bars for long operations (repository collection, PR analysis)
- Spinner for indeterminate operations (rate limit wait)
- ETA display for remaining work

---

### 2. `history list` - List Previous Analyses

**Purpose**: Show historical analyses for an organization.

**Syntax**:
```bash
devex-metrics history list <ORG> [OPTIONS]
```

**Arguments**:
- `<ORG>` (required): GitHub organization or username

**Options**:
- `--limit <N>` (default: 10): Maximum number of analyses to show
- `--format <table|json>` (default: `table`): Output format

**Examples**:
```bash
# List last 10 analyses for my-org
devex-metrics history list my-org

# List last 20 analyses
devex-metrics history list my-org --limit 20

# JSON output for scripting
devex-metrics history list my-org --format json
```

**Output** (table format):
```
Historical Analyses: my-org
───────────────────────────────────────────────────────
Date                  | Tier | Score | Repos | File
───────────────────────────────────────────────────────
2026-03-15 14:30 UTC  | Mid  | 7     | 45    | ~/.devex-metrics/analyses/my-org/2026-03-15T14-30-00.json
2026-03-08 14:30 UTC  | Mid  | 6     | 43    | ~/.devex-metrics/analyses/my-org/2026-03-08T14-30-00.json
2026-03-01 14:30 UTC  | Low  | 4     | 40    | ~/.devex-metrics/analyses/my-org/2026-03-01T14-30-00.json
```

**Exit Codes**:
- `0`: Success
- `3`: No analyses found for organization

---

### 3. `history clean` - Delete Old Analyses

**Purpose**: Remove old analysis files to free disk space.

**Syntax**:
```bash
devex-metrics history clean [OPTIONS]
```

**Options**:
- `--org <ORG>` (optional): Clean only specific organization (default: all orgs)
- `--before <DATE>` (required): Delete analyses before this date (ISO 8601 format or relative like "30d")
- `--dry-run` (flag): Show what would be deleted without actually deleting

**Examples**:
```bash
# Delete all analyses before 2025-01-01 (dry run first)
devex-metrics history clean --before 2025-01-01 --dry-run
devex-metrics history clean --before 2025-01-01

# Delete my-org analyses older than 30 days
devex-metrics history clean --org my-org --before 30d

# Delete all analyses older than 90 days
devex-metrics history clean --before 90d
```

**Output** (dry-run):
```
[DRY RUN] Would delete 5 analyses:
• my-org: 2024-12-15T10-00-00.json (76 days old)
• my-org: 2024-12-20T10-00-00.json (71 days old)
• another-org: 2024-11-01T10-00-00.json (120 days old)

Total space to free: 2.3 MB

Run without --dry-run to delete.
```

**Exit Codes**:
- `0`: Success
- `4`: File I/O error

---

### 4. `history compare` - Compare Two Analyses

**Purpose**: Show how metrics changed between two analysis runs (trend analysis).

**Syntax**:
```bash
devex-metrics history compare <ORG> <DATE1> <DATE2> [OPTIONS]
```

**Arguments**:
- `<ORG>` (required): GitHub organization or username
- `<DATE1>` (required): Older analysis timestamp (ISO 8601 or `YYYY-MM-DD`)
- `<DATE2>` (required): Newer analysis timestamp (ISO 8601 or `YYYY-MM-DD`)

**Options**:
- `--format <table|json>` (default: `table`): Output format

**Examples**:
```bash
# Compare two specific analyses
devex-metrics history compare my-org 2026-03-01 2026-03-15

# JSON output
devex-metrics history compare my-org 2026-03-01 2026-03-15 --format json
```

**Output**:
```
Comparison: my-org (2026-03-01 → 2026-03-15)
────────────────────────────────────────────────────────────
Metric                      | 2026-03-01 | 2026-03-15 | Change
────────────────────────────────────────────────────────────
Maturity Tier               | Low        | Mid        | ↑ +1 tier
Total Score                 | 4          | 7          | ↑ +3
Deployment Automation       | 35%        | 45%        | ↑ +10%
Deploy Frequency (per day)  | 1.2        | 2.5        | ↑ +108%
PR Cycle Time (median hrs)  | 48         | 24         | ↓ -50% (improved)
CI Pass Rate                | 75%        | 88%        | ↑ +13%
Repository Count            | 40         | 45         | ↑ +5

Top Improvements:
• Deployment automation increased by 10 percentage points (4 repos added workflows)
• PR cycle time decreased from 48 hours to 24 hours (50% improvement)
```

**Exit Codes**:
- `0`: Success
- `3`: One or both analyses not found

---

### 5. `version` - Show Tool Version

**Purpose**: Display version information.

**Syntax**:
```bash
devex-metrics version
```

**Output**:
```
devex-metrics v0.1.0
Python 3.11.5
GitHub CLI: gh version 2.40.0 (2023-12-13)
```

**Exit Codes**:
- `0`: Success

---

### 6. `auth check` - Verify GitHub Authentication

**Purpose**: Check GitHub CLI authentication status and required scopes.

**Syntax**:
```bash
devex-metrics auth check
```

**Output** (success):
```
✓ GitHub CLI authenticated
✓ Token has required scopes: repo, read:org, security_events
✓ Rate limit: 4,850 / 5,000 requests remaining
  Reset at: 2026-03-01 15:30:00 UTC (12 minutes)

Ready to analyze GitHub organizations.
```

**Output** (failure - missing scopes):
```
✗ GitHub CLI authenticated but token missing required scopes

Current scopes: repo, read:org
Required scopes: repo, read:org, security_events

To re-authenticate with correct scopes:
  gh auth logout
  gh auth login --scopes repo,read:org,security_events
```

**Exit Codes**:
- `0`: Authenticated with required scopes
- `1`: Not authenticated or missing scopes

---

## Global Options

These options apply to all commands:

- `--help` / `-h`: Show help message
- `--version`: Show version (same as `devex-metrics version`)

---

## Configuration File (Optional - Not MVP)

Future enhancement: Support `~/.devex-metrics/config.yaml` for defaults.

```yaml
# ~/.devex-metrics/config.yaml
output:
  format: html
  directory: ~/reports

analysis:
  deploy_workflow_pattern: "environment:"
  inactive_threshold_days: 90

github:
  enterprise_url: https://github.mycompany.com  # For GitHub Enterprise Server
```

---

## Environment Variables

- `GITHUB_TOKEN`: Override GitHub CLI token (for CI/CD environments)
- `GITHUB_ENTERPRISE_URL`: GitHub Enterprise Server URL (default: https://api.github.com)
- `DEVEX_METRICS_HOME`: Override storage directory (default: `~/.devex-metrics`)

**Example** (CI/CD):
```bash
export GITHUB_TOKEN="${{ secrets.GITHUB_TOKEN }}"
devex-metrics analyze my-org --format json --output metrics.json
```

---

## Error Messages

All error messages follow this format:
```
Error: <Brief description>

<Detailed explanation>

<Actionable next step>

Spec reference: <FR-XXX requirement ID>
```

**Example - Authentication Error**:
```
Error: GitHub CLI not authenticated

The 'gh auth token' command failed. GitHub CLI must be authenticated 
to access organization data.

To authenticate:
  gh auth login --scopes repo,read:org,security_events

For CI/CD environments, set GITHUB_TOKEN environment variable.

Spec reference: FR-002 (GitHub CLI authentication)
```

**Example - Rate Limit Error**:
```
Error: GitHub API rate limit exceeded

Current rate limit: 0 / 5,000 requests remaining
Reset at: 2026-03-01 15:30:00 UTC (12 minutes)

The analysis has been paused. Resume in 12 minutes by re-running the command.
Alternatively, use a different GitHub account with a fresh rate limit.

Spec reference: FR-005 (GitHub API rate limiting)
```

---

## Output Formats

### HTML Report

**Location**: `{org}-report-{timestamp}.html`  
**Structure**: Self-contained HTML with embedded CSS, Plotly.js, and chart data  
**Size**: ~5-10 MB (includes Plotly.js library)  
**Offline viewable**: Yes - no CDN dependencies

**Sections**:
1. Executive Summary (maturity tier, score, repo count)
2. Dimension Scores (radar chart)
3. DORA Metrics (cards with tier classification)
4. Benchmark Comparisons (bar chart showing gaps)
5. Repository Detail Table (sortable, filterable)
6. Historical Trends (line chart if previous analyses exist)

### JSON Output

**Location**: `{org}-report-{timestamp}.json`  
**Schema**: Defined in `data-model.md` (AnalysisResult entity)  
**Use Cases**: Programmatic consumption, CI/CD integration, custom dashboards

---

## Testing Contract

Contract tests (`tests/contract/test_cli_commands.py`) verify:

1. **Command existence**: All documented commands exist
2. **Required arguments**: Commands fail if required args missing
3. **Exit codes**: Match documented behavior
4. **Help text**: `--help` output includes all documented options
5. **Output format**: JSON output is valid AnalysisResult schema
6. **Error messages**: Error messages include actionable guidance

**Example Test**:
```python
def test_analyze_command_requires_org():
    result = subprocess.run(['devex-metrics', 'analyze'], capture_output=True)
    assert result.returncode == 2  # Argument error
    assert 'required: ORG' in result.stderr.decode()

def test_analyze_command_generates_html():
    result = subprocess.run(['devex-metrics', 'analyze', 'test-org'], capture_output=True)
    assert result.returncode == 0
    assert Path('test-org-report-*.html').exists()
```

---

## Backward Compatibility

**Versioning Strategy**: Semantic versioning (MAJOR.MINOR.PATCH)

- **MAJOR**: Breaking changes to CLI interface (remove commands, change exit codes)
- **MINOR**: New commands or options (backward compatible)
- **PATCH**: Bug fixes (no interface changes)

**Deprecation Process**:
1. Add deprecation warning to command output (1 minor version)
2. Remove command in next major version
3. Document migration path in CHANGELOG

---

## Summary

**Commands Defined**: 6 (analyze, history list, history clean, history compare, version, auth check)  
**Exit Codes**: 5 (success, auth error, API error, validation error, I/O error)  
**Output Formats**: 2 (HTML, JSON)  
**Environment Variables**: 3 (GITHUB_TOKEN, GITHUB_ENTERPRISE_URL, DEVEX_METRICS_HOME)

**Next Step**: Generate `quickstart.md` for user onboarding
