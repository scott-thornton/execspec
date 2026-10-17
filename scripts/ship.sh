#!/usr/bin/env bash
# Solo ship loop: push the current branch, open a PR, wait for the
# required CI check, rebase-merge on green, clean up. main is
# PR-gated (required status checks + linear history); this keeps the
# whole flow one command.
#
# Usage: scripts/ship.sh [--squash]
#   --squash  squash-merge instead of rebase-merge (for messy branches)
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ]; then
  echo "ship.sh: you are on main; create a feature branch first" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "ship.sh: working tree is dirty; commit first" >&2
  exit 1
fi

git push -u origin "$BRANCH"

PR_URL=$(gh pr create --fill-first --head "$BRANCH" 2>/dev/null || gh pr create --title "merge $BRANCH" --body "" --head "$BRANCH")
echo "PR opened: $PR_URL"

# Wait for checks to register, then watch them (exits nonzero on failure).
sleep 15
if ! gh pr checks "$PR_URL" --watch --fail-fast; then
  echo "ship.sh: checks failed on $PR_URL" >&2
  exit 1
fi

MERGE_FLAG="--rebase"
if [ "${1:-}" = "--squash" ]; then
  MERGE_FLAG="--squash"
fi
gh pr merge "$PR_URL" "$MERGE_FLAG" --delete-branch
git checkout main
git pull --ff-only
echo "shipped: $PR_URL (main is up to date)"
