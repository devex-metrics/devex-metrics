# Feature Specification: GitHub Organization DevOps Metrics Analyzer

**Feature Branch**: `001-org-metrics-analyzer`  
**Created**: March 1, 2026  
**Status**: Draft  
**Input**: User description: "build a robust plan for analyzing all repos inside a github organization or github user and find all the datapoints needed for the info in the docs folder. we are looking at the info needed to generate our own version of the state of the devops report on our repos, and see if we can score the org against the industry standards as well. so we want to define how we will approach this, so we can build a good flow on this"

## Clarifications

### Session 2026-03-01

- Q: Historical data storage and retention strategy for analysis results? → A: Local file storage with unlimited retention (user manages cleanup)
- Q: Deploy workflow detection criteria for calculating deployment automation rate? → A: Only workflows using `environment:` keyword (strict, fewer false positives)
- Q: How to handle inactive repositories (no commits in 90 days) in metrics calculations? → A: Include inactive repos in counts but exclude from quality metrics (e.g., PR cycle time)
- Q: Primary output format for analysis results? → A: HTML reports with embedded charts and visualizations
- Q: How should users provide GitHub authentication credentials? → A: GitHub CLI integration - use existing `gh auth` login

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Analyze Organization Metrics (Priority: P1)

A DevOps manager wants to understand their organization's current DevOps maturity level by analyzing all repositories within their GitHub organization. They need to see how their team's practices compare to industry standards defined in the State of DevOps 2026 report, specifically focusing on deployment automation, DORA metrics, and security posture.

**Why this priority**: This is the core MVP functionality. Without the ability to collect and analyze metrics from GitHub, no other features can deliver value. This provides immediate actionable insights about the organization's DevOps maturity.

**Independent Test**: Can be fully tested by providing a GitHub organization name, running the analysis, and receiving a maturity score (High/Mid/Low) with supporting metrics across all measured dimensions.

**Acceptance Scenarios**:

1. **Given** a valid GitHub organization name and GitHub CLI authentication, **When** the user initiates an organization analysis, **Then** the system collects data from all accessible repositories and returns a complete metrics report
2. **Given** an organization with 50 repositories, **When** the analysis completes, **Then** the system reports metrics for deployment automation, DORA metrics, branch protection, code scanning, and developer experience KPIs
3. **Given** a completed analysis, **When** the user views the results, **Then** the system displays the organization's maturity tier (High/Mid/Low) with scores for each dimension based on State of DevOps 2026 thresholds

---

### User Story 2 - Compare Against Industry Benchmarks (Priority: P2)

An engineering director wants to see how their organization's metrics stack up against the State of DevOps 2026 industry benchmarks. They need a clear comparison showing where they excel and where they fall short, with specific benchmark thresholds highlighted.

**Why this priority**: Raw metrics are useful, but contextualizing them against industry standards makes the data actionable. This helps leadership prioritize improvements and justify DevOps investments.

**Independent Test**: Can be tested independently by taking any completed metrics analysis and displaying benchmark comparisons with color-coded indicators (above/at/below benchmark) for each measured dimension.

**Acceptance Scenarios**:

1. **Given** a completed organization analysis, **When** the user views benchmark comparisons, **Then** each metric shows the organization's value alongside the relevant industry threshold (e.g., "Deployment Automation: 45% | High-maturity threshold: ≥61%")
2. **Given** benchmark comparison results, **When** the organization scores below a threshold, **Then** the system highlights the gap and shows what percentage improvement is needed to reach the next tier
3. **Given** multiple maturity dimensions, **When** the user reviews the report, **Then** the system identifies the organization's strongest and weakest areas relative to benchmarks

---

### User Story 3 - Analyze Individual User Repositories (Priority: P3)

A developer or small team owner wants to analyze repositories under their personal GitHub account to assess their development practices and maturity, even without an organization-level account.

**Why this priority**: While organization analysis is the primary use case, supporting individual users extends the tool's utility to smaller teams, open source maintainers, and individual developers who want to improve their practices.

**Independent Test**: Can be tested independently by providing a GitHub username instead of an organization name and receiving a metrics report scoped to repositories owned by that user.

**Acceptance Scenarios**:

1. **Given** a valid GitHub username and GitHub CLI authentication, **When** the user initiates a user-level analysis, **Then** the system collects data from all repositories owned by that user and returns a metrics report
2. **Given** a user with personal repositories, **When** the analysis completes, **Then** the system applies the same scoring methodology as organization analysis but scopes it to the user's repositories

---

### User Story 4 - Track Metrics Over Time (Priority: P4)

A DevOps team lead wants to run periodic analyses of their organization to track improvements in DevOps maturity over time, measuring the impact of their standardization and automation initiatives.

**Why this priority**: Point-in-time analysis is valuable, but tracking trends demonstrates progress and ROI. This enables data-driven decision making about DevOps initiatives.

**Independent Test**: Can be tested by running multiple analyses weeks or months apart and displaying trend data showing how metrics have changed over time.

**Acceptance Scenarios**:

1. **Given** multiple analyses of the same organization from different dates, **When** the user views historical trends, **Then** the system displays how key metrics have changed over time with trend direction indicators
2. **Given** trend data, **When** metrics improve, **Then** the system highlights positive changes and their magnitude
3. **Given** trend data, **When** metrics decline, **Then** the system alerts the user to areas needing attention

---

### Edge Cases

- What happens when the GitHub organization has hundreds or thousands of repositories? (System must handle pagination and rate limiting)
- What happens when a repository has no workflow files? (System should flag it as having 0% automation coverage, not error)
- What happens when GitHub API rate limits are reached during analysis? (System should pause and resume, or queue for later completion)
- What happens when a repository is archived or has restricted access? (System should skip it with a note in the results)
- How does the system handle GitHub Enterprise vs GitHub.com differences? (Must work with both, adjusting for available features)
- What happens when a workflow file exists but has never been run? (Count as present but note zero execution history)
- How does the system handle inactive repositories with no recent commits? (Include in coverage counts like deployment automation rate, but exclude from quality metrics like PR cycle time to avoid skewing averages)
- How does the system handle monorepos vs many small repositories? (Metrics should be normalized per repository, not skewed by repo size)
- What happens when branch protection rules vary across branches in a single repository? (Focus on default branch protection, note if others differ)

## Requirements *(mandatory)*

### Functional Requirements

#### Data Collection

- **FR-001**: System MUST accept a GitHub organization name or username as input for analysis
- **FR-002**: System MUST authenticate with GitHub using the GitHub CLI (`gh auth`) existing authentication session to access repository data
- **FR-003**: System MUST discover and enumerate all accessible repositories within the specified organization or user account
- **FR-004**: System MUST collect data from GitHub repositories, Actions workflows, pull requests, branch protection settings, security scanning, and audit logs as defined in the github-metrics-mapping.md reference
- **FR-005**: System MUST handle GitHub API rate limiting by tracking usage and pausing requests when limits are approached
- **FR-006**: System MUST handle pagination for organizations with many repositories
- **FR-006a**: System MUST identify repositories as inactive if they have no commits in the past 90 days; inactive repositories are included in coverage metrics but excluded from quality metrics to prevent skewing results

#### Metrics Calculation

- **FR-007**: System MUST calculate deployment automation rate (percentage of repositories with workflows using the `environment:` keyword) as defined in State of DevOps 2026 benchmarks
- **FR-008**: System MUST calculate DORA metrics: Deployment Frequency, Lead Time for Changes, Change Failure Rate, and Mean Time to Restore
- **FR-009**: System MUST calculate reusable workflow adoption rate (percentage of repositories using shared/organization-level workflows)
- **FR-010**: System MUST assess branch protection enforcement (required reviews, status checks, CODEOWNERS presence)
- **FR-011**: System MUST assess security posture (code scanning, secret scanning, Dependabot enablement)
- **FR-012**: System MUST calculate developer experience metrics: PR cycle time, time to first review, review turnaround, CI pass rate, PR size
- **FR-013**: System MUST calculate operational efficiency metrics: CI/CD pipeline health, automation coverage

#### Scoring and Benchmarking

- **FR-014**: System MUST classify the organization into maturity tiers (High/Mid/Low) based on State of DevOps 2026 thresholds
- **FR-015**: System MUST score each dimension (deployment automation, branch protection, reusable workflows, code scanning, audit trail, PR cycle time, CI pass rate) on a 0-2 point scale as defined in metrics-reference.md
- **FR-016**: System MUST compare collected metrics against industry benchmarks from State of DevOps 2026 report
- **FR-017**: System MUST identify gaps between current state and benchmark thresholds for each metric

#### Results Presentation

- **FR-018**: System MUST present analysis results showing overall maturity tier, per-dimension scores, and individual metric values
- **FR-019**: System MUST present benchmark comparisons showing how the organization compares to industry standards
- **FR-020**: System MUST identify the organization's strongest and weakest areas relative to benchmarks
- **FR-021**: System MUST generate results as HTML reports with embedded charts and visualizations, enabling both executive review and programmatic consumption

#### Historical Tracking

- **FR-022**: System MUST store analysis results in local files with timestamps to enable historical comparison; retention is unlimited and managed by the user
- **FR-023**: System MUST display trend data when multiple analyses exist for the same organization

### Key Entities *(include if feature involves data)*

- **Organization Analysis**: Represents a complete analysis run for a GitHub organization or user, including timestamp, organization identifier, overall maturity tier, dimension scores, and all collected metrics; stored as local files with unlimited retention managed by the user
- **Repository Metrics**: Represents metrics collected for a single repository, including deployment automation status, workflow presence, branch protection settings, security scanning status, PR statistics, and workflow execution history
- **Maturity Dimension Score**: Represents a scored dimension (deployment automation, branch protection, etc.) with raw metric values, calculated score (0-2), applicable benchmark threshold, and gap analysis
- **DORA Metrics**: Represents the four key DORA metrics (Deployment Frequency, Lead Time, Change Failure Rate, MTTR) with raw values and tier classification (Elite/High/Medium/Low)
- **Benchmark Comparison**: Represents a single metric compared against its industry benchmark, including current value, benchmark threshold, gap size, and status (above/at/below)
- **Workflow Analysis**: Represents analysis of GitHub Actions workflows in a repository, including workflow names, execution frequency, success rates, and classification (deploy/test/other)
- **Security Posture**: Represents security-related metrics for a repository, including code scanning alerts, secret scanning alerts, Dependabot alerts, and branch protection enforcement
- **Developer Experience Metrics**: Represents metrics affecting developer productivity, including PR cycle time, review times, CI pass rate, and PR size distribution

## Assumptions *(implicit design decisions)*

- **A-001**: Users have GitHub CLI installed and authenticated via `gh auth login` with sufficient permissions to read organization/user data, repositories, Actions, and security settings; the system leverages this existing authentication
- **A-002**: The organization or user account being analyzed has at least read access granted to the analyzing user
- **A-003**: Deploy workflows are identified by the presence of the `environment:` keyword in the workflow YAML file, ensuring strict detection with minimal false positives
- **A-004**: All State of DevOps 2026 benchmark thresholds documented in metrics-reference.md remain valid and applicable
- **A-005**: The github-metrics-mapping.md file accurately defines all required data collection points and their corresponding metrics calculations
- **A-006**: Organizations are using GitHub standard features (Actions, branch protection, security scanning) - custom enterprise modifications may affect metric calculation
- **A-007**: Analysis will be performed at a single point in time - real-time streaming updates are out of scope
- **A-008**: Historical data for DORA metrics (e.g., deployment frequency, lead time) will be calculated from available GitHub event history within reasonable API limits (typically 90-365 days depending on data type)
- **A-009**: Repositories without any activity or commits in the past 90 days are included in coverage counts (e.g., deployment automation rate) but excluded from quality metrics (e.g., PR cycle time, CI pass rate) to avoid skewing organizational averages
- **A-010**: The system assumes standard English naming conventions for workflows and branches (e.g., "main", "master", "production" as default branches)

## Dependencies *(external requirements)*

- **D-001**: Requires network connectivity to GitHub.com or GitHub Enterprise Server instance
- **D-002**: Requires GitHub CLI (`gh`) to be installed and authenticated via `gh auth login` with appropriate scopes for reading organization data, repositories, Actions, and security settings
- **D-003**: Depends on GitHub REST API availability and documented endpoints for repositories, Actions, pull requests, branch protection, and security scanning
- **D-004**: Depends on the existing github-metrics-mapping.md documentation file for metric definitions
- **D-005**: Depends on the existing metrics-reference.md documentation file for benchmark threshold values
- **D-006**: Requires the analyzed organization or user to have GitHub Actions enabled (for deployment and CI/CD metrics)
- **D-007**: Security posture metrics depend on GitHub Advanced Security features being enabled (for some organizations this is a paid feature)

## Out of Scope *(what this feature explicitly does NOT do)*

- **OS-001**: Real-time monitoring or alerting - this is a point-in-time analysis tool, not a continuous monitoring solution
- **OS-002**: Automated remediation or configuration changes to repositories - the system only reports findings, does not modify configurations
- **OS-003**: Analysis of non-GitHub version control systems (GitLab, Bitbucket, Azure DevOps, etc.)
- **OS-004**: Deep code quality analysis beyond what GitHub's built-in security scanning provides (no custom static analysis)
- **OS-005**: Team-level or individual developer performance tracking - metrics are aggregated at repository and organization level only
- **OS-006**: Integration with project management tools (Jira, Azure Boards) for linking metrics to work items
- **OS-007**: Custom metric definitions - the system uses State of DevOps 2026 metrics as defined in the reference documentation
- **OS-008**: Detailed cost analysis or cloud spend attribution - focuses on DevOps practice maturity, not financial metrics
- **OS-009**: Predictive analytics or machine learning-based recommendations - provides descriptive analytics only

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully analyze a GitHub organization with up to 100 repositories in under 5 minutes
- **SC-002**: System accurately calculates maturity tier classification with 100% alignment to State of DevOps 2026 threshold definitions
- **SC-003**: System collects all data points specified in github-metrics-mapping.md for any repository with standard GitHub features enabled
- **SC-004**: Analysis results clearly identify at least 3 specific, actionable improvement opportunities when an organization scores below High maturity
- **SC-005**: Benchmark comparisons show exact threshold gaps (e.g., "Need 16% more repos with deploy automation to reach High tier")
- **SC-006**: System successfully handles GitHub API rate limiting without data loss or analysis failure
- **SC-007**: Results are presented as HTML reports with embedded charts and visualizations that non-technical executives can understand and make decisions from
- **SC-008**: Historical trend tracking shows clear direction of change for each tracked metric over time
