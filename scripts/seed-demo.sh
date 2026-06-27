#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Seeds a freshly deployed market with some activity so the demo shows real
# numbers: deposits underlying for SY and splits part of it into PT + YT (the
# Tier 1 real-settlement core).
#
# The AMM liquidity step is Tier 2 (the AMM/YT flash route is experimental and
# its nested authorization is not yet proven on testnet, see docs/REMAINING.md).
# It is OFF by default so a Tier 1 demo never depends on it. Opt in with
# SEED_AMM=1 once the AMM auth is verified on testnet.
#
# Run AFTER scripts/deploy-testnet.sh, which writes the contract addresses to
# app/.env.local. Requires stellar-cli and the same deployer identity.

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${DEPLOY_IDENTITY:-sidereal-deployer}"
ENV_FILE="${ENV_FILE:-app/.env.local}"

# Amounts in base units (7 decimals). Defaults: deposit 1000, split 500, seed
# the pool with 250 PT / 250 SY.
DEPOSIT="${DEPOSIT:-10000000000}"
SPLIT="${SPLIT:-5000000000}"
LIQ_PT="${LIQ_PT:-2500000000}"
LIQ_SY="${LIQ_SY:-2500000000}"

# Tier 2 AMM seeding is opt-in. Default off keeps the demo on the proven core.
SEED_AMM="${SEED_AMM:-0}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v stellar >/dev/null 2>&1 || die "stellar-cli not found. Install: cargo install --locked stellar-cli"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found. Run scripts/deploy-testnet.sh first."

# Pull the deployed addresses written by the deploy script.
addr() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d'"' -f2; }
SY="$(addr NEXT_PUBLIC_SY_ADDRESS)"
TOKENIZER="$(addr NEXT_PUBLIC_TOKENIZER_ADDRESS)"
AMM="$(addr NEXT_PUBLIC_MARKET_ADDRESS)"
[[ -n "$SY" && -n "$TOKENIZER" ]] || die "missing addresses in $ENV_FILE"
[[ "$SEED_AMM" != "1" || -n "$AMM" ]] || die "SEED_AMM=1 but NEXT_PUBLIC_MARKET_ADDRESS missing in $ENV_FILE"

ADMIN="$(stellar keys address "$IDENTITY")"
invoke() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --source "$IDENTITY" --network "$NETWORK" -- "$@"
}

log "Seeding as $ADMIN"

log "Depositing underlying for SY ($DEPOSIT base units)"
invoke "$SY" deposit --from "$ADMIN" --amount "$DEPOSIT"

log "Splitting SY into PT + YT ($SPLIT base units)"
invoke "$TOKENIZER" split --from "$ADMIN" --sy_amount "$SPLIT"

if [[ "$SEED_AMM" == "1" ]]; then
  log "Seeding AMM liquidity ($LIQ_PT PT / $LIQ_SY SY) [Tier 2, experimental]"
  invoke "$AMM" add_liquidity --from "$ADMIN" --pt_in "$LIQ_PT" --sy_in "$LIQ_SY"
  log "Done. Core seeded and AMM has reserves; reload the app to see quotes."
else
  log "Skipping AMM liquidity (Tier 2). Set SEED_AMM=1 to seed it once AMM auth is verified on testnet."
  log "Done. Core seeded (deposit + split); the Tier 1 demo path is ready."
fi
