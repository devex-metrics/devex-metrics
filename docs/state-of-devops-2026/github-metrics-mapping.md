# GitHub Metrics Mapping — Report KPIs → GitHub-Observable Signals

> Maps every key metric from the State of DevOps 2026 report to specific GitHub APIs, scoring thresholds, and dashboard widget recommendations.  
> This is the implementation blueprint for a GitHub-native DevEx metrics dashboard.

---

## Architecture Overview

```
GitHub Organization
├── Repositories (repos API)
│   ├── Branch protection rules
│   ├── Code scanning alerts
│   ├── Secret scanning alerts
│   └── Dependabot alerts
├── Actions (workflow_runs API)
│   ├── Deploy workflow runs
│   ├── Test workflow runs
│   ├── Reusable workflow usage
│   └── Scheduled vs. triggered runs
├── Pull Requests (pulls API)
│   ├── Cycle time (created → merged)
│   ├── Time to first review
│   └── Review turnaround
└── Audit Log (audit_log API)
    ├── Permission changes
    ├── Branch protection changes
    └── Workflow changes
```

---

## Metric Mapping Table

### A. Deployment Automation (Primary Maturity Signal)

| Report Metric | GitHub Signal | API Endpoint | Scoring |
|---|---|---|---|
| **Deployment automation rate** | % of repos with active `deploy` workflow (matching name pattern) that runs on push/merge | `GET /repos/{owner}/{repo}/actions/workflows` | High: ≥61% of repos have automated deploy; Low: <31% |
| **Deployment success rate** | Successful `deploy` workflow runs / total deploy runs, per repo | `GET /repos/{owner}/{repo}/actions/runs?event=push` | Track `conclusion: success` vs `failure` |
| **Commit-to-deploy coverage** | % of pushes to `main`/production branch that trigger a deploy workflow run | Cross-reference push events + workflow runs | High: all pushes trigger deploy; Low: manual/none |

> **Note:** Requires identifying "deploy workflows" by name convention (e.g., `deploy*`, `release*`, workflows using `environment:`). Recommend documenting an org-level naming convention.

---

### B. DORA Metrics

| DORA Metric | GitHub Signal | API Endpoint | Thresholds (DORA standard) |
|---|---|---|---|
| **Deployment Frequency** | Count of successful deploy workflow runs per time period, per repo or org | `GET /repos/{owner}/{repo}/actions/runs?status=success` filtered to deploy workflows | Elite: multiple/day; High: daily–weekly; Med: weekly–monthly; Low: < monthly |
| **Lead Time for Changes** | `PR.created_at` → `PR.merged_at` + time from merge to next successful deploy run | `GET /repos/{owner}/{repo}/pulls?state=closed` + workflow runs | Elite: <1hr; High: <1day; Med: <1wk; Low: >1mo |
| **Change Failure Rate** | Failed deploy runs / total deploy runs (or % of PRs within X days that introduce a hotfix PR) | `GET /repos/{owner}/{repo}/actions/runs` filter by conclusion | Elite: 0–5%; Med: ~15%; Low: >30% |
| **MTTR (Time to Restore)** | Time from first failed deploy run → next successful deploy run on same branch | `GET /repos/{owner}/{repo}/actions/runs` ordered by created_at | Elite: <1hr; High: <1day; Med: <1wk; Low: >1mo |

> **Requires GitHub Environments:** Lead time commit→deploy and MTTR are most accurate when teams use [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) with `environment:` in workflow YAML. Without environments, deploy workflows must be inferred from job/workflow names.

---

### C. Delivery Standardization

| Report Metric | GitHub Signal | API Endpoint | Thresholds |
|---|---|---|---|
| **Reusable workflow adoption** (IDP proxy) | % of repos using `uses:` to reference org-level reusable workflows | `GET /repos/{owner}/{repo}/contents/.github/workflows/*.yml` — parse for `uses: owner/` | High: ≥79% of repos use shared workflows; Low: <21% |
| **Shared pipeline templates** | Org-level starter workflows defined in `.github` repo | `GET /repos/{org}/.github/contents/workflow-templates` | Present = centralized; absent = team-defined |
| **Workflow consistency score** | Variance in workflow file patterns across repos (e.g., all have lint, test, deploy jobs) | Parse workflow files per repo for standard job names | High: consistent stages; Low: each repo differs |

---

### D. Governance & Security Posture

These map to the report's "centralize security standards" benchmark (51% all orgs, 69% high-maturity).

| Report Metric | GitHub Signal | API Endpoint | Scoring |
|---|---|---|---|
| **Branch protection — required reviews** | `required_pull_request_reviews.required_approving_review_count ≥ 1` on default branch | `GET /repos/{owner}/{repo}/branches/{branch}/protection` | Must-have for High-maturity |
| **Branch protection — required status checks** | `required_status_checks.contexts` not empty on default branch | same as above | Must-have for High-maturity |
| **CODEOWNERS file present** | `.github/CODEOWNERS` or `CODEOWNERS` exists | `GET /repos/{owner}/{repo}/contents/CODEOWNERS` | Indicates governed review routing |
| **Code scanning enabled** | At least one code scanning alert dismissal or `code-scanning` workflow present | `GET /repos/{owner}/{repo}/code-scanning/alerts` | 0 = not set up; any = enabled |
| **Secret scanning enabled** | Secret scanning alert API accessible | `GET /repos/{owner}/{repo}/secret-scanning/alerts` | Requires GitHub Advanced Security or public repos |
| **Dependabot alerts enabled** | Alert count accessible | `GET /repos/{owner}/{repo}/dependabot/alerts` | Enabled + acted on = mature posture |
| **Admin enforce on branch protection** | `enforce_admins.enabled: true` | branch protection API | True = consistent governance |

---

### E. Audit Trail Automation

Maps to the report's finding that only **39%** have fully automated audit trails (critical compliance gap).

| Report Metric | GitHub Signal | API Endpoint | Scoring |
|---|---|---|---|
| **Required PR reviews before merge** | `required_approving_review_count ≥ 1` | Branch protection API | Present = automated gate |
| **Dismiss stale reviews on push** | `dismiss_stale_reviews: true` | Branch protection API | Present = stronger audit trail |
| **Workflow artifact retention** | Workflows configured with `actions/upload-artifact` | Parse workflow YAML | Present = audit-recoverable runs |
| **Org-level audit log retention** | GitHub Enterprise: audit log streaming enabled | GitHub Enterprise Admin API | Streaming = fully automated |
| **PR merge require linear history** | `required_linear_history: true` | Branch protection API | Present = traceable history |

---

### F. Developer Experience (Top KPI at 47% measuring it)

| KPI | GitHub Signal | API Endpoint | Benchmark |
|---|---|---|---|
| **PR Cycle Time** | `PR.merged_at - PR.created_at` | `GET /repos/{owner}/{repo}/pulls?state=closed` | Track median and p90; aim for <1 day on small PRs |
| **Time to First Review** | time from `PR.created_at` to first `review` or `review_comment` event | `GET /repos/{owner}/{repo}/pulls/{number}/reviews` | Aim: <4 hours in business hours |
| **Review Turnaround** | time from `review_requested` to `review_submitted` | `GET /repos/{owner}/{repo}/pulls/{number}/requested_reviewers` + reviews | Track to identify bottlenecks |
| **CI Pass Rate** | % of PRs where all status checks pass on first run | `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` | High: >90%; Low: <60% |
| **PR Size** | Lines changed per merged PR (`additions + deletions`) | `GET /repos/{owner}/{repo}/pulls/{number}` | Smaller PRs correlate with higher quality and faster review |

---

### G. Operational Efficiency (Top KPI at 57% measuring it)

| KPI | GitHub Signal | Composite Formula | Notes |
|---|---|---|---|
| **Overall deploy throughput** | Deploy workflow run frequency × success rate | `deploy_runs_success / time_period` | Combine with deployment frequency |
| **CI/CD pipeline health** | % of workflow runs completing without failure (not just deploys) | All workflow runs success rate | Baseline health signal |
| **Automation coverage** | % of repos with at least one CI workflow | Count repos with `.github/workflows/*.yml` | Simple IDP proxy |
| **Mean time between deploys** | Average time between consecutive successful deploy runs, per repo | Calculated from workflow run timestamps | Consistency signal |

---

### H. Productivity ROI (Second KPI at 49% measuring it)

| ROI Signal | GitHub Signal | Notes |
|---|---|---|
| **Deployment velocity trend** | Deploy frequency over time (weekly/monthly trend) | Show direction, not just value |
| **Automation savings estimate** | (Manual deploy baseline hours) × automated deploy count | Requires org-provided baseline; surface as "estimated hours saved" |
| **Rework rate** | PRs merged to fix previous PRs within 24h on same area | Heuristic: look for hotfix branch patterns |
| **Test automation breadth** | % of workflow runs containing test jobs | Parse for `test`, `spec`, `jest`, `pytest` job names |

---

## Maturity Scoring Model

Use the following to classify a GitHub org or repo into a maturity tier:

### Tier Scoring (each dimension = 0–2 points)

| Dimension | Low (0) | Mid (1) | High (2) |
|---|---|---|---|
| Deployment automation | <31% repos have deploy workflows | 31–60% | ≥61% |
| Branch protection enforced | Not present | Partial (some repos) | All repos, required reviews + status checks |
| Reusable workflow adoption | <21% repos use shared workflows | 21–78% | ≥79% |
| Code scanning | Not enabled | Enabled on some repos | Enabled org-wide |
| Audit trail | No required reviews, no CODEOWNERS | Partial | Required reviews + CODEOWNERS + linear history |
| PR cycle time | >1 week median | 1–7 days | <1 day median |
| CI pass rate | <60% | 60–89% | ≥90% |

**Total score → Tier:**
- **0–4:** Low maturity
- **5–9:** Mid maturity
- **10–14:** High maturity

---

## Dashboard Widget Recommendations

| Widget | Primary Metric | Data Source | Alert Threshold |
|---|---|---|---|
| **Deployment Automation Rate** | % repos with deploy workflow | Actions API | 🔴 <31% · 🟡 31–60% · 🟢 ≥61% |
| **Deployment Frequency** | Deploys/week (org-wide trend) | Actions API | Trend line; flag declining weeks |
| **DORA Lead Time** | Median PR-to-deploy time | PRs + Actions | 🔴 >1mo · 🟡 >1wk · 🟢 <1day |
| **Change Failure Rate** | Failed deploy % | Actions API | 🔴 >30% · 🟡 15–30% · 🟢 <5% |
| **MTTR** | Median time failure→fix | Actions API | 🔴 >1wk · 🟡 1day–1wk · 🟢 <1hr |
| **Branch Protection Coverage** | % repos with required reviews | Repos API | 🔴 <50% · 🟢 100% |
| **Reusable Workflow Adoption** | % repos using org workflows | Actions API | IDP maturity proxy |
| **PR Cycle Time** | Median PR open→merge | PRs API | P50 and P90 trend |
| **Audit Trail Score** | Required reviews + CODEOWNERS + linear history | Repos + branches API | Checklist per repo |
| **Security Posture** | Code scan + Dependabot + secret scan | Security APIs | Count of enabled vs. total repos |

---

## Notes on GitHub API Authentication & Rate Limits

- All endpoints require a GitHub App or PAT with appropriate scopes: `repo`, `read:org`, `security_events`, `actions`
- For org-wide metrics, use `GET /orgs/{org}/repos` to enumerate repos, then fan out per-repo calls
- GraphQL API (`POST /graphql`) is more efficient for bulk PR and workflow run data — recommended for dashboards
- REST pagination: max 100 per page; use `Link` header for cursor iteration
- Rate limits: REST = 5,000 req/hr (authenticated); GraphQL = 5,000 points/hr
- For large orgs (500+ repos), use [GitHub Enterprise Audit Log Streaming](https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/streaming-the-audit-log-for-your-enterprise) for real-time event ingestion

---

## SMB vs. Enterprise Considerations

| Dimension | Enterprise (report benchmark applies) | SMB (needs supplemental sources) |
|---|---|---|
| Company size | 1,000+ employees | < 1,000 employees |
| Benchmark source | This report (Perforce 2026) | DORA Accelerate, GitHub Octoverse |
| Deployment automation threshold | High: ≥61% | Likely lower absolute %, same relative ranking |
| IDP / reusable workflow threshold | 79% = high-maturity | May not apply — many SMBs are single-product |
| Branch protection | Same standards apply regardless of size | — |
| Incident response | Same 3-tier model still valid | — |

> Recommendation: apply the **DORA 4-tier model** (Elite/High/Med/Low) for SMBs, and **Perforce High/Mid/Low** for enterprise-size customers. Both can be surfaced in the same dashboard with a company-size toggle.
