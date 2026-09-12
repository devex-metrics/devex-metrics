#!/usr/bin/env bash
#
# Check out and publish the append-only history store.
#
# The store lives on an orphan branch (default: metrics-data) so collected data
# never touches the default branch. GitHub Pages is deployed from an uploaded
# artifact rather than a branch, so this branch is purely a data store — it is
# never built or served.
#
# Usage:
#   scripts/metrics-data.sh checkout <dir> [branch]
#   scripts/metrics-data.sh publish  <dir> <message> [branch]
#
# Requires a token with contents:write in GH_TOKEN (or a pre-configured remote).

set -euo pipefail

BRANCH_DEFAULT="metrics-data"

die() { echo "metrics-data: $*" >&2; exit 1; }

remote_url() {
  local server="${GITHUB_SERVER_URL:-https://github.com}"
  local repo="${GITHUB_REPOSITORY:-}"
  [ -n "$repo" ] || die "GITHUB_REPOSITORY is not set"
  if [ -n "${GH_TOKEN:-}" ]; then
    echo "${server/https:\/\//https://x-access-token:${GH_TOKEN}@}/${repo}.git"
  else
    echo "${server}/${repo}.git"
  fi
}

cmd_checkout() {
  local dir="${1:?usage: checkout <dir> [branch]}"
  local branch="${2:-$BRANCH_DEFAULT}"
  local url
  url="$(remote_url)"

  rm -rf "$dir"

  if git clone --quiet --depth 1 --branch "$branch" "$url" "$dir" 2>/dev/null; then
    echo "metrics-data: checked out existing '$branch' into $dir"
  else
    # First run for this deployment — start the branch with no history at all,
    # so the data store shares no commits with the default branch.
    echo "metrics-data: '$branch' does not exist yet; initialising an orphan branch in $dir"
    mkdir -p "$dir"
    git -C "$dir" init --quiet --initial-branch="$branch"
    git -C "$dir" remote add origin "$url"
    printf '%s\n' \
      "# metrics-data" \
      "" \
      "Append-only history store written by the Collect DevEx Metrics workflow." \
      "This branch holds data only. It is never built, served, or merged." \
      > "$dir/README.md"
  fi
}

cmd_publish() {
  local dir="${1:?usage: publish <dir> <message> [branch]}"
  local message="${2:?usage: publish <dir> <message> [branch]}"
  local branch="${3:-$BRANCH_DEFAULT}"

  [ -d "$dir/.git" ] || die "$dir is not a git checkout — run 'checkout' first"

  git -C "$dir" config user.name "github-actions[bot]"
  git -C "$dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git -C "$dir" add -A

  if git -C "$dir" diff --cached --quiet; then
    echo "metrics-data: no changes to publish"
    return 0
  fi

  git -C "$dir" commit --quiet -m "$message"

  # A concurrent run may have pushed since the checkout. Rebase onto whatever
  # landed and retry rather than forcing over another run's data.
  local attempt
  for attempt in 1 2 3; do
    if git -C "$dir" push --quiet origin "HEAD:$branch" 2>/dev/null; then
      echo "metrics-data: published to '$branch'"
      return 0
    fi
    echo "metrics-data: push rejected (attempt $attempt); rebasing onto origin/$branch"
    git -C "$dir" fetch --quiet origin "$branch" || true
    git -C "$dir" rebase --quiet "origin/$branch" || die "could not rebase onto origin/$branch"
    sleep $((attempt * 2))
  done
  die "could not push to '$branch' after 3 attempts"
}

case "${1:-}" in
  checkout) shift; cmd_checkout "$@" ;;
  publish)  shift; cmd_publish "$@" ;;
  *) die "usage: $0 {checkout|publish} ..." ;;
esac
