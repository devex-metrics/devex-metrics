# devex-metrics

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**GitHub Organization DevOps Metrics Analyzer** - Calculate DevOps maturity scores based on State of DevOps 2026 benchmarks.

## Overview

`devex-metrics` is a command-line tool that analyzes GitHub organizations and user accounts to assess DevOps maturity using industry benchmarks from the [State of DevOps 2026 report](docs/state-of-devops-2026/). Get instant insights into:

- **Deployment automation maturity** - % of repositories with automated deployments
- **DORA 4 key metrics** - Deployment frequency, lead time, change failure rate, MTTR
- **Security posture** - Code scanning, Dependabot, secret scanning enablement
- **Developer experience** - PR cycle time, review turnaround, CI pass rate
- **Branch protection enforcement** - Required reviews, status checks, CODEOWNERS
- **Workflow reusability** - Internal Developer Platform (IDP) maturity proxy

**Output**: Interactive HTML reports with charts + JSON for programmatic use.

## Quick Start

### Prerequisites

- Python 3.11 or higher
- GitHub CLI (`gh`) installed and authenticated

### Installation

```bash
pip install devex-metrics
```

### First Analysis

```bash
# Authenticate with GitHub CLI (if not already done)
gh auth login --scopes repo,read:org,security_events

# Analyze your organization
devex-metrics analyze my-org

# View the generated HTML report
open my-org-report-2026-03-01T14-30-00.html
```

### Example Output

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

## Features

### Maturity Scoring

Organizations are scored across 7 dimensions (0-2 points each):

| Dimension | High Tier (2 pts) | Mid Tier (1 pt) | Low Tier (0 pts) |
|-----------|-------------------|-----------------|------------------|
| Deployment Automation | ≥61% repos | 31-60% repos | <31% repos |
| Branch Protection | 90%+ full coverage | 50%+ partial | <50% |
| Reusable Workflows | ≥79% adoption | 21-78% | <21% |
| Code Scanning | Org-wide enabled | Partial | Not enabled |
| Audit Trail | Full enforcement | Partial | None |
| PR Cycle Time | <1 day median | 1-7 days | >1 week |
| CI Pass Rate | ≥90% | 60-89% | <60% |

**Total Score**: 10-14 = High Maturity | 5-9 = Mid Maturity | 0-4 = Low Maturity

### HTML Reports

Self-contained HTML reports include:
- Executive summary with maturity tier
- Radar chart showing dimension scores vs benchmarks
- DORA metrics trends
- Gap analysis with specific recommendations
- Per-repository details table
- Historical trend comparison (if previous analyses exist)

### Historical Tracking

Track your progress over time:

```bash
# List previous analyses
devex-metrics history list my-org

# Compare two analyses
devex-metrics history compare my-org 2026-03-01 2026-03-15
```

## CLI Commands

### `analyze` - Analyze Organization

```bash
devex-metrics analyze <org> [OPTIONS]

Options:
  --format <html|json>     Output format (default: html)
  --output <path>          Output file path
  --verbose, -v            Enable debug logging
  --no-cache               Skip cached data, force fresh API calls
```

### `history` - Historical Analysis

```bash
# List previous analyses
devex-metrics history list <org> [--limit N]

# Compare two analyses
devex-metrics history compare <org> <date1> <date2>

# Clean old analyses
devex-metrics history clean --before <date> [--org <org>] [--dry-run]
```

### `auth` - Authentication

```bash
# Check GitHub CLI authentication status
devex-metrics auth check

# Show version information
devex-metrics version
```

## Architecture

```
devex_metrics/
├── auth/              # GitHub CLI authentication
├── collectors/        # GitHub API data collection
├── analyzers/         # Metrics calculation engines
├── scorers/          # Maturity tier scoring
├── reporters/        # HTML/JSON report generation
├── storage/          # Local JSON file persistence
└── utils/            # Shared utilities
```

**Key Design Decisions**:
- **Library-first design** - Core logic is reusable (enables future GitHub Action integration)
- **GitHub CLI authentication** - Reuses existing user sessions, no token management
- **Strict workflow detection** - Only workflows with `environment:` keyword counted as deploy workflows
- **Local JSON storage** - No database required, files stored in `~/.devex-metrics/analyses/`
- **Self-contained HTML** - Reports work offline with embedded charts (no CDN dependencies)

## Development

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/devex-metrics/devex-metrics.git
cd devex-metrics

# Install in editable mode with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run linters
black .
ruff check .
mypy devex_metrics/
```

### Running Tests

```bash
# Run all tests
pytest

# Run only unit tests
pytest -m unit

# Run with coverage
pytest --cov=devex_metrics --cov-report=html
```

## Documentation

- [Quick Start Guide](specs/001-org-metrics-analyzer/quickstart.md)
- [State of DevOps 2026 Report](docs/state-of-devops-2026/README.md)
- [Metrics Reference](docs/state-of-devops-2026/metrics-reference.md)
- [GitHub Metrics Mapping](docs/state-of-devops-2026/github-metrics-mapping.md)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

- Report bugs and request features via [GitHub Issues](https://github.com/devex-metrics/devex-metrics/issues)
- For questions, see the [Quick Start Guide](specs/001-org-metrics-analyzer/quickstart.md)
