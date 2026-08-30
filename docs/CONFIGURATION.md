# Configuring a deployment

Everything that makes a deployment site-specific lives in **GitHub Actions
variables**. Nothing needs to be committed, so a customer's repository stays a
clean fork of this one and upgrades are a fast-forward rather than a merge.

`devex.config.example.json` documents the full shape. Copy it to
`devex.config.json` for local development — that filename is gitignored.

## Resolution order

Later entries win:

1. Built-in defaults
2. `devex.config.json` in the working directory (or `DEVEX_CONFIG_FILE`)
3. `DEVEX_CONFIG` — the whole config object as a JSON string, in one variable
4. Discrete `DEVEX_*` variables

Use `DEVEX_CONFIG` for the bulk of the setup and discrete variables for the
values you tweak often — a trial start date, the team repo list.

## Variables

Set these under **Settings → Secrets and variables → Actions → Variables**.

| Variable | Type | Meaning |
| --- | --- | --- |
| `DEVEX_OWNER` | string | GitHub org or username to collect. **Required.** |
| `DEVEX_OWNER_TYPE` | `org` \| `user` | How to enumerate repositories. Default `org`. |
| `DEVEX_CONFIG` | JSON | The whole config object, as in the example file. |
| `DEVEX_TITLE` | string | Dashboard title. |
| `DEVEX_ATTRIBUTION` | string | Attribution line in the header. |
| `DEVEX_ATTRIBUTION_URL` | string | Where the attribution links to. |
| `DEVEX_REPOS_INCLUDE` | list | Globs to keep. Empty means every repo. |
| `DEVEX_REPOS_EXCLUDE` | list | Globs to drop, applied after include. |
| `DEVEX_EXCLUDE_ARCHIVED` | bool | Skip archived repos. Default `true`. |
| `DEVEX_EXCLUDE_FORKS` | bool | Skip forks. Default `false`. |
| `DEVEX_MAX_IDLE_DAYS` | int | Skip repos with no push in N days. `0` disables. |
| `DEVEX_TEAM_REPOS` | list | Globs marking the trial team's repos. |
| `DEVEX_TEAM_NAME` | string | Team display name. |
| `DEVEX_TEAM_ID` | string | Stable id used in history rows and share URLs. |
| `DEVEX_DISCOVER_ALL` | bool | Collect the whole org as a baseline. Default `true`. |
| `DEVEX_TRIAL_TITLE` | string | Intervention headline. |
| `DEVEX_TRIAL_HYPOTHESIS` | string | What the intervention should change. |
| `DEVEX_TRIAL_START` | date | Intervention start, `YYYY-MM-DD`. |
| `DEVEX_BASELINE_FROM` | date | Baseline window start. |
| `DEVEX_BASELINE_TO` | date | Baseline window end. |
| `DEVEX_TRIAL_MILESTONES` | list | `2026-04-01=Training complete; 2026-05-15=Rollout` |
| `DEVEX_HISTORY_WEEKS` | int | Weeks of weekly trends to build. Default `104`. |
| `DEVEX_MAX_PR_PAGES` | int | Pages of merged PRs per repo. Default `10`. |
| `DEVEX_MAX_REPO_AGE_HOURS` | int | Per-repo cache freshness. Default `8`. |
| `DEVEX_FEATURE_DEPENDENTS` | bool | Dependent-repo counts. Default `false`. |
| `DEVEX_FEATURE_COPILOT_AGENT` | bool | Copilot agent metrics. Default `true`. |
| `DEVEX_HISTORY_ENABLED` | bool | Append to the history store. Default `true`. |
| `DEVEX_HISTORY_DIR` | path | Where the history store lives. Set by the workflow. |

Lists accept commas, semicolons or newlines. Booleans accept
`1/true/yes/on` — anything else is false. Setting a list variable to an empty
string clears it rather than falling back to the default.

Globs support `*` and `?`, and are matched against both `repo` and
`owner/repo`, case-insensitively.

## Baselining the org, measuring the team

The default posture for an improvement trial:

```
DEVEX_OWNER          = acme
DEVEX_OWNER_TYPE     = org
DEVEX_DISCOVER_ALL   = true                 # collect every repo -> org baseline
DEVEX_TEAM_REPOS     = acme/api, acme/web   # ...and flag these as the team
DEVEX_TRIAL_TITLE    = Trunk-based development
DEVEX_TRIAL_START    = 2026-05-01
```

Collection walks the whole org, so the rest of the org is the comparison group,
and the dashboard shows the team's numbers against that baseline.

To collect *only* the team's repos — much cheaper, but no baseline — set
`DEVEX_DISCOVER_ALL=false`. Repos are then filtered to `DEVEX_TEAM_REPOS`
during discovery, so the API cost drops to the team's repos alone.

## Keeping the first run affordable

On a large org, start with `DEVEX_MAX_IDLE_DAYS=180` and
`DEVEX_EXCLUDE_ARCHIVED=true`. Dormant repositories usually make up most of the
repo count and none of the signal.
