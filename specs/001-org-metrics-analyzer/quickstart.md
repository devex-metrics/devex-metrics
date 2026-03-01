# Quick Start Guide: devex-metrics

**Last Updated**: March 1, 2026  
**Target Audience**: DevOps engineers, engineering managers, platform engineers  
**Time to First Report**: ~10 minutes

---

## What is devex-metrics?

`devex-metrics` is a command-line tool that analyzes your GitHub organization's DevOps practices and scores them against industry benchmarks from the State of DevOps 2026 report. Get instant insights into:

- **Deployment automation maturity** (how many repos have automated deployments)
- **DORA 4 key metrics** (deployment frequency, lead time, change failure rate, MTTR)
- **Security posture** (code scanning, Dependabot, secret scanning enablement)
- **Developer experience** (PR cycle time, review turnaround, CI pass rate)
- **Branch protection enforcement** and **audit trail automation**

**Output**: Interactive HTML report with charts + JSON for programmatic use

---

## Prerequisites

Before you begin, ensure you have:

1. **Python 3.11 or higher**
   ```bash
   python --version  # Should show 3.11.0 or higher
   ```

2. **GitHub CLI installed and authenticated**
   ```bash
   gh --version      # Should show gh version 2.0.0 or higher
   gh auth status    # Should show "Logged in as ..."
   ```

3. **Access to a GitHub organization or user account** you want to analyze
   - For organizations: You need `read` access to repositories and Actions
   - For users: Analyzing your own account works out of the box

---

## Installation

### Option 1: Install from PyPI (Recommended)

```bash
pip install devex-metrics
```

### Option 2: Install from Source

```bash
git clone https://github.com/your-org/devex-metrics.git
cd devex-metrics
pip install -e .
```

### Verify Installation

```bash
devex-metrics version
```

Expected output:
```
devex-metrics v0.1.0
Python 3.11.5
GitHub CLI: gh version 2.40.0
```

---

## First Analysis (5 minutes)

### Step 1: Authenticate GitHub CLI

If you haven't already authenticated with GitHub CLI:

```bash
gh auth login --scopes repo,read:org,security_events
```

Follow the prompts to authenticate via browser or token.

**Required Scopes**:
- `repo`: Read repositories, workflows, pull requests
- `read:org`: Read organization membership and settings
- `security_events`: Read code scanning and security alerts

### Step 2: Check Authentication

Verify your authentication has the required scopes:

```bash
devex-metrics auth check
```

Expected output:
```
✓ GitHub CLI authenticated
✓ Token has required scopes: repo, read:org, security_events
✓ Rate limit: 5,000 / 5,000 requests remaining

Ready to analyze GitHub organizations.
```

### Step 3: Run Your First Analysis

Replace `my-org` with your GitHub organization or username:

```bash
devex-metrics analyze my-org
```

**What happens next**:
1. Tool fetches all repositories in the organization (~30 seconds for 50 repos)
2. Collects workflow files, PR history, security settings (~2-3 minutes)
3. Calculates DORA metrics, deployment automation rate, and other KPIs (~30 seconds)
4. Generates HTML report with embedded charts (~10 seconds)

**Progress output**:
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
```

### Step 4: View the Report

Open the HTML report in your browser:

```bash
# On macOS
open my-org-report-2026-03-01T14-30-00.html

# On Linux
xdg-open my-org-report-2026-03-01T14-30-00.html

# On Windows
start my-org-report-2026-03-01T14-30-00.html
```

**Report Sections**:
- **Executive Summary**: Maturity tier (High/Mid/Low), total score, repo count
- **Dimension Scores**: Visual breakdown of 7 maturity dimensions
- **DORA Metrics**: Deployment frequency, lead time, change failure rate, MTTR
- **Gap Analysis**: Specific recommendations to improve your score
- **Repository Details**: Per-repo breakdown of metrics

---

## Interpreting Your Results

### Maturity Tiers

| Tier | Score | Meaning |
|------|-------|---------|
| **High** | 10-14 | You're in the top tier of DevOps maturity. Focus on maintaining practices and incremental improvements. |
| **Mid** | 5-9 | You have solid foundations but gaps remain. Prioritize recommendations to reach High tier. |
| **Low** | 0-4 | Significant opportunity for improvement. Start with deployment automation and branch protection. |

### Dimension Scores (0-2 points each)

Each dimension is scored based on State of DevOps 2026 benchmarks:

1. **Deployment Automation** (2 = ≥61% repos automated, 1 = 31-60%, 0 = <31%)
2. **Branch Protection** (2 = 90%+ repos fully protected, 1 = 50%+ partial, 0 = <50%)
3. **Reusable Workflows** (2 = ≥79% adoption, 1 = 21-78%, 0 = <21%)
4. **Code Scanning** (2 = org-wide enabled, 1 = partial, 0 = not enabled)
5. **Audit Trail** (2 = required reviews + CODEOWNERS + linear history, 1 = partial, 0 = none)
6. **PR Cycle Time** (2 = <1 day median, 1 = 1-7 days, 0 = >1 week)
7. **CI Pass Rate** (2 = ≥90%, 1 = 60-89%, 0 = <60%)

### Gap Analysis Recommendations

The report shows specific actions to close gaps:

**Example**:
```
Gap: Deployment Automation
Current: 45% | Target: 61% | Gap: 16%

Recommendation: Automate 7 more repositories to reach High tier.
Priority repos: api-service, frontend-app, data-pipeline
```

---

## Common Use Cases

### Use Case 1: Weekly Team Standup Metrics

Generate a fresh report every week to track progress:

```bash
devex-metrics analyze my-org --output weekly-report.html
```

Share `weekly-report.html` with your team via email or Slack.

### Use Case 2: Executive Dashboard (JSON Output)

Export metrics as JSON for custom dashboards:

```bash
devex-metrics analyze my-org --format json --output metrics.json
```

Use `metrics.json` to populate your internal dashboard (Tableau, Power BI, Grafana).

### Use Case 3: Trend Tracking Over Time

Run monthly analyses to track improvements:

```bash
# March analysis
devex-metrics analyze my-org

# April analysis (stored separately)
devex-metrics analyze my-org

# Compare March vs April
devex-metrics history list my-org
devex-metrics history compare my-org 2026-03-01 2026-04-01
```

**Output**:
```
Comparison: my-org (2026-03-01 → 2026-04-01)
────────────────────────────────────────────
Deployment Automation: 45% → 55% (↑ +10%)
PR Cycle Time: 48 hrs → 36 hrs (↓ -25%)
CI Pass Rate: 75% → 82% (↑ +7%)
```

### Use Case 4: CI/CD Integration

Embed metrics collection in your CI/CD pipeline:

```yaml
# GitHub Actions workflow
- name: Analyze DevOps Metrics
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    pip install devex-metrics
    devex-metrics analyze my-org --format json --output metrics.json
    
- name: Upload Metrics Artifact
  uses: actions/upload-artifact@v3
  with:
    name: devex-metrics
    path: metrics.json
```

---

## Troubleshooting

### Problem: "GitHub CLI not authenticated"

**Solution**: Run `gh auth login` with required scopes:
```bash
gh auth login --scopes repo,read:org,security_events
```

### Problem: "Rate limit exceeded"

**Cause**: GitHub API limits authenticated users to 5,000 requests per hour.

**Solution**: Wait for rate limit to reset (shown in error message), or:
- Use a different GitHub account with a fresh rate limit
- For large orgs (500+ repos), consider running during off-peak hours

### Problem: "No repositories found"

**Possible Causes**:
1. Organization name is misspelled
2. Organization is private and you don't have access
3. Username has no public repositories

**Solution**: Verify org name and check access with `gh repo list OWNER`

### Problem: "Missing required scope: security_events"

**Cause**: Your GitHub token doesn't have the `security_events` scope.

**Solution**: Re-authenticate with correct scopes:
```bash
gh auth logout
gh auth login --scopes repo,read:org,security_events
```

### Problem: Analysis takes longer than 5 minutes

**Possible Causes**:
1. Large organization (200+ repos) requires more API calls
2. Slow network connection
3. GitHub API experiencing latency

**Solution**: 
- Use `--verbose` flag to see detailed progress
- Analysis continues where it left off if interrupted (future feature)
- For very large orgs, consider filtering repos (future feature)

---

## Advanced Usage

### Custom Output Location

```bash
devex-metrics analyze my-org --output /path/to/reports/custom-name.html
```

### Verbose Logging (Debug Mode)

See detailed API calls and timing:

```bash
devex-metrics analyze my-org --verbose
```

**Output includes**:
- Every API endpoint called with timing
- Rate limit status after each call
- Detailed error messages with stack traces

### Custom Deploy Workflow Detection

Override the default `environment:` keyword detection:

```bash
devex-metrics analyze my-org --deploy-workflow-pattern "production|staging"
```

This treats any workflow file containing "production" or "staging" as a deploy workflow.

### GitHub Enterprise Server

Set the `GITHUB_ENTERPRISE_URL` environment variable:

```bash
export GITHUB_ENTERPRISE_URL=https://github.mycompany.com
devex-metrics analyze my-org
```

---

## Managing Historical Data

### View Past Analyses

```bash
devex-metrics history list my-org
```

### Compare Two Analyses

```bash
devex-metrics history compare my-org 2026-03-01 2026-03-15
```

### Clean Up Old Analyses

Free disk space by deleting old reports:

```bash
# Dry run (see what would be deleted)
devex-metrics history clean --before 2025-01-01 --dry-run

# Actually delete
devex-metrics history clean --before 2025-01-01
```

**Storage Location**: `~/.devex-metrics/analyses/{org-name}/`

---

## What's Next?

### Improve Your Score

Use the gap analysis in your report to prioritize improvements:

1. **Start with deployment automation**: Automate deploy workflows for repos without them
2. **Enable branch protection**: Require reviews and status checks on default branches
3. **Enable security scanning**: Turn on code scanning, Dependabot, and secret scanning org-wide
4. **Reduce PR cycle time**: Target <24 hours from open to merge for small PRs

### Track Progress Over Time

Run weekly or monthly analyses to measure improvements:

```bash
# Add to cron job or scheduled GitHub Action
devex-metrics analyze my-org --output latest-report.html
```

### Share with Leadership

Present the HTML report to executives to:
- Justify DevOps investments (show progress toward benchmarks)
- Identify areas needing resources (e.g., "We need 7 more repos automated")
- Celebrate wins (show improved DORA metrics over time)

---

## Getting Help

### Documentation

- **Specification**: `specs/001-org-metrics-analyzer/spec.md` (requirements and acceptance criteria)
- **Architecture**: `docs/architecture.md` (technical design)
- **Metrics Calculation**: `docs/metrics-calculation.md` (how each metric is computed)
- **CLI Reference**: `specs/001-org-metrics-analyzer/contracts/cli-schema.md` (all commands and options)

### Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/your-org/devex-metrics/issues)
- **Discussions**: [Ask questions or share use cases](https://github.com/your-org/devex-metrics/discussions)
- **Slack**: Join `#devex-metrics` channel (internal)

---

## Frequently Asked Questions

### Q: How long does analysis take?

**A**: Typical timing for 100 repositories:
- Repository enumeration: ~30 seconds
- Workflow collection: ~1-2 minutes
- PR analysis (90 days history): ~2-3 minutes
- Metrics calculation: ~30 seconds
- Report generation: ~10 seconds
- **Total: ~5 minutes**

For 500+ repos, expect 15-25 minutes.

### Q: Does this modify my repositories?

**A**: No. devex-metrics is read-only. It only collects data via GitHub API, never makes changes.

### Q: What about private repositories?

**A**: Private repos are analyzed if you have read access. Ensure your GitHub token has the `repo` scope.

### Q: Can I analyze multiple organizations?

**A**: Yes. Run the command once per organization:
```bash
devex-metrics analyze org1
devex-metrics analyze org2
```

Results are stored separately: `~/.devex-metrics/analyses/org1/`, `~/.devex-metrics/analyses/org2/`

### Q: How accurate are DORA metrics?

**A**: DORA metrics are calculated from available GitHub data:
- **Deployment Frequency**: Based on workflow runs tagged as deploys
- **Lead Time**: `PR.merged_at` → next deploy run timestamp
- **Change Failure Rate**: Failed deploy runs / total deploy runs
- **MTTR**: Failed deploy → successful deploy time

Accuracy depends on:
- Consistent naming/tagging of deploy workflows (`environment:` keyword)
- Complete PR history (analysis looks back 90 days)
- Workflow run history available

### Q: What if my org uses CI/CD tools other than GitHub Actions?

**A**: Currently, devex-metrics only supports GitHub Actions. Support for Jenkins, CircleCI, GitLab CI, etc. is not available in v0.1.0.

**Workaround**: If you use external CI/CD but trigger it via GitHub Actions, those workflows will be detected.

### Q: How much does this cost?

**A**: devex-metrics is free and open-source. The only cost is GitHub API rate limit usage:
- Analyzing 100 repos uses ~1,000-1,500 API requests
- GitHub free tier: 5,000 requests/hour (per user)
- GitHub Enterprise: Typically higher limits

---

## Summary

You're now ready to analyze your GitHub organization's DevOps maturity! 

**Quick Recap**:
1. Install: `pip install devex-metrics`
2. Authenticate: `gh auth login --scopes repo,read:org,security_events`
3. Analyze: `devex-metrics analyze my-org`
4. Review: Open generated HTML report
5. Improve: Follow gap analysis recommendations
6. Track: Re-run monthly to measure progress

**Next Steps**:
- Run your first analysis (10 minutes)
- Review the gap analysis recommendations
- Share the report with your team
- Schedule monthly re-analysis to track trends

Happy analyzing! 🚀
