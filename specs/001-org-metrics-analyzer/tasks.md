# Tasks: GitHub Organization DevOps Metrics Analyzer

**Feature Branch**: `001-org-metrics-analyzer`  
**Input**: Design documents from `/specs/001-org-metrics-analyzer/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tech Stack**: Python 3.11+, GitHub CLI, pandas, plotly, jinja2, typer, pytest  
**Project Type**: Library + CLI tool  
**Storage**: Local JSON files

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create Python package structure `devex_metrics/` per plan.md project layout
- [X] T002 Initialize pyproject.toml with Python 3.11+ and dependencies (typer, pandas, requests, jinja2, plotly, pyyaml, pytest)
- [X] T003 [P] Create README.md with installation and quick start instructions
- [X] T004 [P] Configure pytest with conftest.py in tests/ directory
- [X] T005 [P] Setup .gitignore for Python (venv/, __pycache__/, *.pyc, .pytest_cache/)
- [X] T006 Create devex_metrics/__init__.py and devex_metrics/__main__.py entry points
- [X] T007 Create devex_metrics/version.py with version string "0.1.0"

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Implement GitHub CLI authentication in devex_metrics/auth/gh_cli.py with `gh auth token` integration
- [X] T009 Create base data models in devex_metrics/models/ (AnalysisResult, RepositoryMetrics, DimensionScores per data-model.md)
- [X] T010 [P] Implement GitHub API rate limiter in devex_metrics/utils/rate_limiter.py tracking 5000 req/hr limit
- [X] T011 [P] Create base collector class in devex_metrics/collectors/base.py with rate limit handling and retry logic
- [X] T012 [P] Implement YAML parser utility in devex_metrics/utils/yaml_parser.py for workflow file parsing
- [X] T013 [P] Create progress bar utilities in devex_metrics/utils/progress.py using rich or tqdm
- [X] T014 Implement State of DevOps 2026 benchmarks in devex_metrics/scorers/benchmarks.py (HIGH=10-14, MID=5-9, LOW=0-4)
- [X] T015 Create pytest fixtures in tests/conftest.py for mock GitHub API responses using responses library

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Analyze Organization Metrics (Priority: P1) 🎯 MVP

**Goal**: Enable DevOps managers to analyze their GitHub organization and receive a maturity score with supporting metrics

**Independent Test**: Run `devex-metrics analyze <org>` and receive HTML report showing maturity tier (High/Mid/Low), deployment automation rate, DORA metrics, branch protection status, and security posture

### Implementation for User Story 1

#### Data Collection (T016-T022)

- [X] T016 [P] [US1] Implement repository collector in devex_metrics/collectors/repositories.py fetching all org repos via `/orgs/{org}/repos` 
- [X] T017 [P] [US1] Implement workflow collector in devex_metrics/collectors/workflows.py fetching workflow files and runs via `/repos/{owner}/{repo}/actions/workflows`
- [X] T018 [P] [US1] Implement branch protection collector in devex_metrics/collectors/branch_protection.py fetching default branch protection rules
- [X] T019 [P] [US1] Implement security collector in devex_metrics/collectors/security.py fetching code scanning, secret scanning, Dependabot alerts
- [X] T020 [US1] Implement repository activity detection in devex_metrics/collectors/repositories.py identifying inactive repos (no commits in 90 days per FR-006a)
- [X] T021 [US1] Add pagination handling in devex_metrics/collectors/base.py for organizations with 100+ repositories per FR-006
- [X] T022 [US1] Implement workflow environment keyword detection in devex_metrics/collectors/workflows.py parsing YAML for `environment:` keyword per A-003

#### Metrics Calculation (T023-T027)

- [X] T023 [P] [US1] Implement deployment automation analyzer in devex_metrics/analyzers/deployment_automation.py calculating % repos with deploy workflows per FR-007
- [X] T024 [P] [US1] Implement branch protection analyzer in devex_metrics/analyzers/branch_protection.py scoring required reviews, status checks, CODEOWNERS per FR-010
- [X] T025 [P] [US1] Implement security posture analyzer in devex_metrics/analyzers/security_posture.py aggregating code scanning, secrets, Dependabot per FR-011
- [X] T026 [P] [US1] Implement DORA metrics analyzer in devex_metrics/analyzers/dora_metrics.py calculating Deployment Frequency, Lead Time, CFR, MTTR per FR-008
- [X] T027 [US1] Implement maturity scorer in devex_metrics/scorers/maturity_scorer.py classifying org into High/Mid/Low tiers per FR-014 and FR-015

#### CLI Interface (T028-T033)

- [X] T028 [US1] Implement CLI command structure in devex_metrics/cli.py using typer with `analyze` command per contracts/cli-schema.md
- [X] T029 [US1] Add organization argument and format/output/verbose options to `analyze` command per CLI contract
- [X] T030 [US1] Implement authentication check in `analyze` command calling gh_cli.py to verify GitHub CLI auth per FR-002
- [X] T031 [US1] Add progress indicators for data collection phases (repos, workflows, metrics) using progress.py utilities
- [X] T032 [US1] Implement exit codes (0=success, 1=auth error, 2=API error, 3=validation, 4=I/O) per CLI contract
- [X] T033 [US1] Add console output summary showing maturity tier, repo count, inactive repos per CLI contract stdout format

#### Results Presentation - Basic (T034-T038)

- [X] T034 [US1] Create base HTML template in devex_metrics/reporters/templates/report.html with maturity tier summary section
- [X] T035 [US1] Implement HTML reporter in devex_metrics/reporters/html_reporter.py using Jinja2 per FR-021
- [X] T036 [US1] Add dimension scores table to HTML template showing 7 dimensions with 0-2 scores per FR-018
- [X] T037 [US1] Add metrics summary section to HTML template showing deployment automation %, branch protection %, security status per FR-018
- [X] T038 [US1] Generate self-contained HTML with embedded CSS (no external dependencies for offline viewing)

**Checkpoint**: User Story 1 MVP complete - can analyze org, calculate maturity tier, generate basic HTML report

---

## Phase 4: User Story 2 - Compare Against Industry Benchmarks (Priority: P2)

**Goal**: Enable engineering directors to see how their org stacks up against State of DevOps 2026 industry benchmarks with specific gap analysis

**Independent Test**: Run `devex-metrics analyze <org>` and see each metric displayed alongside industry threshold (e.g., "Deployment Automation: 45% | High-maturity threshold: ≥61%") with color-coded indicators

### Implementation for User Story 2

- [X] T039 [P] [US2] Implement benchmark comparison engine in devex_metrics/scorers/benchmarks.py loading thresholds from docs/state-of-devops-2026/metrics-reference.md per FR-016
- [X] T040 [P] [US2] Create BenchmarkComparison model in devex_metrics/models/metrics.py with current_value, threshold, gap, status per data-model.md
- [X] T041 [P] [US2] Implement gap calculator in devex_metrics/scorers/maturity_scorer.py identifying delta to next tier per FR-017
- [X] T042 [US2] Add benchmark comparison section to HTML template showing metrics vs thresholds in table format per FR-019
- [X] T043 [US2] Implement color-coding in HTML template (green=above, yellow=at, red=below benchmark) per US2 acceptance criteria
- [X] T044 [US2] Add "Recommendations" section to HTML template showing top 3 gaps with specific improvement targets per FR-020 and SC-004
- [X] T045 [US2] Calculate exact improvement needed (e.g., "7 more repos need deploy workflows") in maturity_scorer.py per SC-005
- [X] T046 [US2] Add strengths/weaknesses summary section identifying best and worst performing dimensions per FR-020

**Checkpoint**: User Stories 1 AND 2 complete - full analysis with benchmarking and actionable recommendations

---

## Phase 5: User Story 3 - Analyze Individual User Repositories (Priority: P3)

**Goal**: Enable individual developers to analyze their personal GitHub repositories without requiring an organization

**Independent Test**: Run `devex-metrics analyze <username>` and receive same metrics report scoped to user's repositories

### Implementation for User Story 3

- [X] T047 [US3] Add user account detection in devex_metrics/collectors/repositories.py determining if input is org or user via `/users/{user}` vs `/orgs/{org}` endpoints
- [X] T048 [US3] Implement user repository collector in devex_metrics/collectors/repositories.py fetching repos via `/users/{user}/repos` per FR-001
- [X] T049 [US3] Apply same metrics calculation logic from US1 to user repositories with appropriate scoping per US3 acceptance criteria
- [X] T050 [US3] Update CLI `analyze` command to handle both org and username inputs per FR-001
- [X] T051 [US3] Update HTML template to display "User: {username}" vs "Organization: {org}" in report header

**Checkpoint**: User Stories 1, 2, AND 3 complete - supports both organizations and individual users

---

## Phase 6: User Story 4 - Track Metrics Over Time (Priority: P4)

**Goal**: Enable DevOps teams to run periodic analyses and track improvements in maturity over time

**Independent Test**: Run two analyses weeks apart, then view trend data showing how each metric changed with direction indicators (↑↓)

### Implementation for User Story 4

- [ ] T052 [P] [US4] Implement local storage in devex_metrics/storage/local_store.py saving JSON files to ~/.devex-metrics/analyses/{org}/{timestamp}.json per FR-022
- [ ] T053 [P] [US4] Create storage directory structure on first run with unlimited retention (user-managed cleanup) per clarification
- [ ] T054 [US4] Implement JSON serialization for AnalysisResult model with schema_version field per data-model.md
- [ ] T055 [US4] Update `analyze` command to auto-save results to local storage after report generation
- [ ] T056 [P] [US4] Implement `history list` CLI command in devex_metrics/cli.py showing previous analyses per contracts/cli-schema.md
- [ ] T057 [P] [US4] Implement `history compare` CLI command comparing two analysis timestamps per contracts/cli-schema.md
- [ ] T058 [US4] Create trend data calculator in devex_metrics/analyzers/trends.py computing metric deltas and direction per FR-023 and SC-008
- [ ] T059 [US4] Add historical trend section to HTML template with line charts showing metrics over time using Plotly per FR-023
- [ ] T060 [US4] Implement change indicators (↑ improved, ↓ declined, → stable) in HTML template per US4 acceptance criteria
- [ ] T061 [US4] Highlight positive changes and magnitude (e.g., "+16% deployment automation") per US4 acceptance criteria
- [ ] T062 [US4] Implement alert section for declining metrics per US4 acceptance criteria

**Checkpoint**: All 4 user stories complete - full feature implementation with historical tracking

---

## Phase 7: Pull Request & Developer Experience Metrics (Enhancement)

**Purpose**: Add developer experience metrics (PR cycle time, review times) to enhance maturity analysis

- [ ] T063 [P] [US1] Implement pull request collector in devex_metrics/collectors/pull_requests.py fetching PRs via `/repos/{owner}/{repo}/pulls` per FR-012
- [ ] T064 [P] [US1] Implement developer experience analyzer in devex_metrics/analyzers/developer_experience.py calculating PR cycle time, time to first review, CI pass rate per FR-012
- [ ] T065 [US1] Add developer experience metrics to HTML template in dedicated section
- [ ] T066 [P] [US1] Implement reusable workflow analyzer in devex_metrics/analyzers/reusable_workflows.py detecting `uses: {org}/{repo}` patterns per FR-009
- [ ] T067 [US1] Add reusable workflow adoption metric to dimension scores and HTML report

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final refinements for production readiness

- [ ] T068 [P] Add comprehensive error handling with user-friendly messages for common failures (auth, rate limit, network errors)
- [ ] T069 [P] Implement `--version` command in CLI showing tool version per contracts/cli-schema.md
- [ ] T070 [P] Implement `auth check` command in CLI validating GitHub CLI authentication per contracts/cli-schema.md
- [ ] T071 [P] Add `history clean` command for deleting old analyses per contracts/cli-schema.md
- [ ] T072 Add detailed logging with --verbose flag logging API requests, responses, rate limit status
- [ ] T073 Implement `--no-cache` flag to force fresh API calls bypassing any response caching
- [ ] T074 Add validation for organization/user existence before starting analysis per FR-003
- [ ] T075 Implement GitHub Enterprise Server support checking base_url configuration per Edge Cases
- [ ] T076 Add archived repository detection and exclusion per Edge Cases
- [ ] T077 [P] Create comprehensive test suite: unit tests for each analyzer, integration tests for CLI commands, contract tests for API mocking
- [ ] T078 [P] Add quickstart.md examples to README.md for common use cases
- [ ] T079 Generate sample HTML report for documentation purposes
- [ ] T080 Perform final validation against all Success Criteria (SC-001 through SC-008) from spec.md

---

## Dependency Graph

```
Phase 1 (Setup) → Phase 2 (Foundation)
                 ↓
         Phase 3 (US1) ← MVP Delivery Point
                 ↓
         Phase 4 (US2)
                 ↓
         Phase 5 (US3)
                 ↓
         Phase 6 (US4)
                 ↓
         Phase 7 (Enhancements)
                 ↓
         Phase 8 (Polish)
```

**Critical Path**: T001-T015 → T016-T038 (US1 MVP) → T039-T046 (US2 Benchmarking)

**Parallel Opportunities**:
- Within Phase 2: T010, T011, T012, T013 (different modules)
- Within US1 Data Collection: T016, T017, T018, T019 (different collectors)
- Within US1 Metrics: T023, T024, T025, T026 (different analyzers)
- US2 tasks T039, T040, T041 (model + comparison engine)
- US4 storage tasks T052, T053 can start independently

---

## Implementation Strategy

### MVP Scope (Weeks 1-3)
Focus exclusively on **Phase 1, Phase 2, and Phase 3 (US1)**:
- Core data collection from GitHub
- Basic metrics calculation (deployment automation, DORA, branch protection, security)
- Maturity tier scoring
- Simple HTML report generation

**Deliverable**: Working CLI tool that can analyze an org and produce a maturity report

### Incremental Delivery (Weeks 4-6)
- **Week 4**: Add US2 (Benchmarking with gaps and recommendations)
- **Week 5**: Add US3 (User account support) + US4 Part 1 (Local storage)
- **Week 6**: Complete US4 (Historical tracking with trends)

### Enhancement Phase (Weeks 7-8)
- Add PR metrics and developer experience (Phase 7)
- Final polish, testing, documentation (Phase 8)

---

## Task Count Summary

- **Phase 1 (Setup)**: 7 tasks
- **Phase 2 (Foundation)**: 8 tasks
- **Phase 3 (US1 - MVP)**: 23 tasks (T016-T038)
- **Phase 4 (US2)**: 8 tasks (T039-T046)
- **Phase 5 (US3)**: 5 tasks (T047-T051)
- **Phase 6 (US4)**: 11 tasks (T052-T062)
- **Phase 7 (Enhancements)**: 5 tasks (T063-T067)
- **Phase 8 (Polish)**: 13 tasks (T068-T080)

**Total**: 80 tasks

**Parallelizable**: 24 tasks marked with [P]

**Estimated Effort**: 6-8 weeks (based on plan.md phase estimates)
