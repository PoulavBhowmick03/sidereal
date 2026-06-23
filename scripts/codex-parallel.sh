#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-/Users/odinson/Developer/sidereal}"
BASE_BRANCH="${BASE_BRANCH:-main}"
ROOT_NAME="${ROOT_NAME:-sidereal}"
RUNS="${RUNS:-6}"
SLEEP_SECONDS="${SLEEP_SECONDS:-20}"

cd "$REPO"

if [[ ! -f AGENTS.md ]]; then
  echo "AGENTS.md not found at repo root"
  exit 1
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Refusing to run: $REPO is not a git repository."
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to start with a dirty tree."
  git status --short
  exit 3
fi

if [[ "$(git branch --show-current)" != "$BASE_BRANCH" ]]; then
  echo "Expected to start from branch $BASE_BRANCH, found $(git branch --show-current)"
  exit 4
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found"
  exit 5
fi

if ! git log --all --format=%s | grep -Fxq "feat: freeze interfaces"; then
  echo "Freeze commit missing. Running bootstrap pass first."
  ALLOW_MAIN=1 ROLE=bootstrap MAX_RUNS=1 SLEEP_SECONDS="$SLEEP_SECONDS" ./scripts/codex-loop.sh

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Bootstrap left uncommitted changes. Resolve before parallel launch."
    git status --short
    exit 6
  fi
fi

WORKTREE_BASE="$(dirname "$REPO")"
AMM_DIR="${WORKTREE_BASE}/${ROOT_NAME}-amm"
TOKEN_DIR="${WORKTREE_BASE}/${ROOT_NAME}-tokenization"
AMM_BRANCH="${AMM_BRANCH:-feat/amm}"
TOKEN_BRANCH="${TOKEN_BRANCH:-feat/tokenization}"

mkdir -p "$REPO/.codex/logs"

ensure_worktree() {
  local path="$1"
  local branch="$2"

  if [[ -d "$path/.git" || -f "$path/.git" ]]; then
    echo "Reusing existing worktree: $path"
    return
  fi

  git worktree add "$path" -b "$branch"
}

launch_worker() {
  local path="$1"
  local role="$2"
  local log="$3"

  (
    cd "$path"
    ROLE="$role" MAX_RUNS="$RUNS" SLEEP_SECONDS="$SLEEP_SECONDS" ./scripts/codex-loop.sh
  ) >"$log" 2>&1 &
  echo $!
}

ensure_worktree "$AMM_DIR" "$AMM_BRANCH"
ensure_worktree "$TOKEN_DIR" "$TOKEN_BRANCH"

amm_log="$REPO/.codex/logs/parallel-codex-1.log"
token_log="$REPO/.codex/logs/parallel-codex-2.log"

amm_pid="$(launch_worker "$AMM_DIR" "codex-1" "$amm_log")"
token_pid="$(launch_worker "$TOKEN_DIR" "codex-2" "$token_log")"

echo "Started Codex workers:"
echo "  codex-1 pid=$amm_pid worktree=$AMM_DIR log=$amm_log"
echo "  codex-2 pid=$token_pid worktree=$TOKEN_DIR log=$token_log"
echo
echo "Tail logs with:"
echo "  tail -f $amm_log"
echo "  tail -f $token_log"
