#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Runs frontend integration checks against a testnet deployment.
#
# By default this reads deployments/testnet.toml. To point the app at a fresh
# throwaway market produced by prove-testnet-amm-routes.sh, pass:
#
#   PROOF_FILE=deployments/amm-routes-testnet.state.env \
#     bash scripts/check-frontend-testnet.sh
#
# The script does not require wallet automation. It verifies build-time
# integration and live read-only browser flows. Wallet-submitted flows still
# require a real browser wallet or a separate signer harness.

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

MANIFEST="${MANIFEST:-deployments/testnet.toml}"
PROOF_FILE="${PROOF_FILE:-}"
WRITE_ENV_LOCAL="${WRITE_ENV_LOCAL:-0}"
RUN_STATIC="${RUN_STATIC:-1}"
RUN_E2E="${RUN_E2E:-1}"
PLAYWRIGHT_PROJECTS="${PLAYWRIGHT_PROJECTS:-desktop-chromium}"

TESTNET_RPC="${NEXT_PUBLIC_SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
TESTNET_PASSPHRASE="${NEXT_PUBLIC_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
SIMULATION_SOURCE="${NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS:-GBGHELMOABS7WCYOMJTWQRGQ6VZYLYXXMLE7JJAHJ6I4WW7FMJSDERN3}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m  ok:\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

manifest_value() {
  local key="$1"
  awk -F'"' -v key="$key" '$0 ~ "^[[:space:]]*" key "[[:space:]]*=" { print $2; exit }' "$MANIFEST"
}

proof_value() {
  local key="$1"
  awk -F'"' -v key="$key" '$0 ~ "^" key "=" { print $2; exit }' "$PROOF_FILE"
}

load_addresses() {
  if [[ -n "$PROOF_FILE" ]]; then
    [[ -f "$PROOF_FILE" ]] || die "PROOF_FILE not found: $PROOF_FILE"
    SY="$(proof_value SY)"
    PT="$(proof_value PT)"
    YT="$(proof_value YT)"
    TOKENIZER="$(proof_value TOKENIZER)"
    AMM="$(proof_value AMM)"
  else
    [[ -f "$MANIFEST" ]] || die "manifest not found: $MANIFEST"
    SY="$(manifest_value sy_wrapper)"
    PT="$(manifest_value pt_token)"
    YT="$(manifest_value yt_token)"
    TOKENIZER="$(manifest_value tokenizer)"
    AMM="$(manifest_value amm)"
  fi
}

require_addr() {
  local label="$1" value="$2"
  if ! [[ "$value" =~ ^C[A-Z0-9]{55}$ ]]; then
    die "$label is not a contract address: '$value'"
  fi
}

load_addresses
require_addr SY "$SY"
require_addr PT "$PT"
require_addr YT "$YT"
require_addr TOKENIZER "$TOKENIZER"
require_addr AMM "$AMM"

export NEXT_PUBLIC_SOROBAN_RPC_URL="$TESTNET_RPC"
export NEXT_PUBLIC_NETWORK_PASSPHRASE="$TESTNET_PASSPHRASE"
export NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS="$SIMULATION_SOURCE"
export NEXT_PUBLIC_MARKET_ID="${NEXT_PUBLIC_MARKET_ID:-blend-usdc-q3}"
export NEXT_PUBLIC_TOKEN_DECIMALS="${NEXT_PUBLIC_TOKEN_DECIMALS:-7}"
export NEXT_PUBLIC_SY_ADDRESS="$SY"
export NEXT_PUBLIC_PT_ADDRESS="$PT"
export NEXT_PUBLIC_YT_ADDRESS="$YT"
export NEXT_PUBLIC_TOKENIZER_ADDRESS="$TOKENIZER"
export NEXT_PUBLIC_MARKET_ADDRESS="$AMM"

log "Frontend testnet config"
printf '  SY=%s\n  PT=%s\n  YT=%s\n  TOKENIZER=%s\n  AMM=%s\n' "$SY" "$PT" "$YT" "$TOKENIZER" "$AMM"

if [[ "$WRITE_ENV_LOCAL" == "1" ]]; then
  cat > app/.env.local <<EOF
NEXT_PUBLIC_SOROBAN_RPC_URL="$NEXT_PUBLIC_SOROBAN_RPC_URL"
NEXT_PUBLIC_NETWORK_PASSPHRASE="$NEXT_PUBLIC_NETWORK_PASSPHRASE"
NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS="$NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS"
NEXT_PUBLIC_MARKET_ID="$NEXT_PUBLIC_MARKET_ID"
NEXT_PUBLIC_TOKEN_DECIMALS="$NEXT_PUBLIC_TOKEN_DECIMALS"
NEXT_PUBLIC_SY_ADDRESS="$NEXT_PUBLIC_SY_ADDRESS"
NEXT_PUBLIC_PT_ADDRESS="$NEXT_PUBLIC_PT_ADDRESS"
NEXT_PUBLIC_YT_ADDRESS="$NEXT_PUBLIC_YT_ADDRESS"
NEXT_PUBLIC_TOKENIZER_ADDRESS="$NEXT_PUBLIC_TOKENIZER_ADDRESS"
NEXT_PUBLIC_MARKET_ADDRESS="$NEXT_PUBLIC_MARKET_ADDRESS"
EOF
  ok "Wrote app/.env.local"
fi

RAN_CHECKS=0

if [[ "$RUN_STATIC" == "1" ]]; then
  RAN_CHECKS=1
  log "Running SDK and app static checks"
  pnpm --filter @sidereal/sdk build
  pnpm --filter @sidereal/app run lint
  pnpm --filter @sidereal/app run typecheck
  pnpm --filter @sidereal/app test
  pnpm --filter @sidereal/app run build
fi

if [[ "$RUN_E2E" == "1" ]]; then
  RAN_CHECKS=1
  export E2E_EXPECT_DEPLOYED=1
  log "Running Playwright live-read smoke"
  if [[ "$PLAYWRIGHT_PROJECTS" == "all" ]]; then
    pnpm --filter @sidereal/app exec playwright test e2e/smoke.spec.ts
  else
    IFS=',' read -r -a projects <<< "$PLAYWRIGHT_PROJECTS"
    for project in "${projects[@]}"; do
      pnpm --filter @sidereal/app exec playwright test --project="$project" e2e/smoke.spec.ts
    done
  fi
fi

if [[ "$RAN_CHECKS" == "1" ]]; then
  ok "Frontend live-read integration checks passed"
else
  ok "Frontend testnet config resolved, checks disabled"
fi
ok "Wallet-submitted flows are not covered by this script"
