#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-/Users/odinson/Developer/sidereal}"
ROLE="${ROLE:-codex-1}"          # bootstrap | codex-1 | codex-2
MAX_RUNS="${MAX_RUNS:-6}"
SLEEP_SECONDS="${SLEEP_SECONDS:-20}"
# Shared cross-worktree message board. Lives outside every worktree so any
# agent on any branch can read/write it by absolute path. See its header.
BUS_FILE="${BUS_FILE:-/Users/odinson/Developer/.sidereal-bus/BUS.md}"

cd "$REPO"

if [[ ! -f AGENTS.md ]]; then
  echo "AGENTS.md not found at repo root"
  exit 1
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Refusing to run: $REPO is not a git repository."
  echo "Parallel Codex workers need separate branches or worktrees."
  exit 2
fi

if [[ "${ALLOW_MAIN:-0}" != "1" && "$(git branch --show-current)" == "main" ]]; then
  echo "Refusing to run on main. Create a feature branch first."
  exit 3
fi

if [[ -n "$(git status --porcelain)" && "${ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "Refusing to start with a dirty tree."
  git status --short
  exit 4
fi

case "$ROLE" in
  bootstrap)
    ROLE_SPEC="Bootstrap only. Create/fix the Cargo workspace and frozen shared interface file. Do not implement AMM or tokenization."
    TRAILER="Agent: codex-1"
    ;;
  codex-1)
    ROLE_SPEC="Codex-1 AMM agent. Owns contracts/amm/ and contracts/shared/math/. Read-only touch only for contracts/shared/types/."
    TRAILER="Agent: codex-1"
    ;;
  codex-2)
    ROLE_SPEC="Codex-2 tokenization agent. Owns contracts/sy-wrapper/, contracts/tokenizer/, contracts/pt-token/, and contracts/yt-token/."
    TRAILER="Agent: codex-2"
    ;;
  *)
    echo "Unknown ROLE: $ROLE"
    exit 5
    ;;
esac

mkdir -p .codex/logs

for run in $(seq 1 "$MAX_RUNS"); do
  ts="$(date +%Y%m%d-%H%M%S)"
  out=".codex/logs/${ROLE}-${ts}.md"

  prompt="$(cat <<PROMPT
Read AGENTS.md at the repo root before doing anything. Also read any deeper AGENTS.md for directories you touch.

Then read the shared agent bus at $BUS_FILE in full. It is the cross-worktree
message board (see its own header for the protocol). Act on anything addressed
to you ($ROLE) or to "all" under "Open threads" or in recent log entries.

You are running as: $ROLE
$ROLE_SPEC

Rules for this invocation:
- Do exactly one logical change.
- If the freeze commit "feat: freeze interfaces" is missing, do not write implementation code. Only do the interface/workspace freeze work.
- Respect the ownership table in AGENTS.md section 3.
- Preserve the PT + YT = SY invariant.
- No external oracle pricing path.
- No hardcoded private keys.
- Add SPDX headers to source files you create.
- Run the narrowest meaningful verification.
- If the change is complete and verified, commit it with a conventional commit message and this trailer:

$TRAILER

- After committing (or if you hit LOOP_STOP), APPEND one status entry to the
  shared bus at $BUS_FILE using the entry format documented in that file's
  header. Never rewrite another agent's entry. Address claude-1/claude-2 in the
  TO field when you need something from the SDK or frontend side.
- If blocked, if tests fail, if you need product input, or if you leave uncommitted changes for review, end your final answer with:
LOOP_STOP: <reason>

Keep the final answer short: changed files, tests run, commit hash, or LOOP_STOP.
PROMPT
)"

  echo "==> Codex run $run/$MAX_RUNS as $ROLE"
  codex exec \
    -C "$REPO" \
    -s danger-full-access \
    -o "$out" \
    "$prompt" </dev/null

  if grep -q "LOOP_STOP:" "$out"; then
    echo "Codex requested stop:"
    grep "LOOP_STOP:" "$out"
    exit 0
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Codex left uncommitted changes. Stopping for review."
    git status --short
    exit 0
  fi

  sleep "$SLEEP_SECONDS"
done

echo "Reached MAX_RUNS=$MAX_RUNS"
