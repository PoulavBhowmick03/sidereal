#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Deploys the full sidereal protocol to Stellar testnet and writes the resulting
# contract addresses to app/.env.local for the frontend.
#
# No private keys are hardcoded. The deployer identity is created with
# `stellar keys generate` and stored by the CLI; only its public address is ever
# echoed. Re-run safe: pass DEPLOY_IDENTITY to reuse an existing funded key.
#
# Requirements: stellar-cli (https://stellar.org/developers), Rust with the
# wasm32v1-none target, run from the repo root.

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${DEPLOY_IDENTITY:-sidereal-deployer}"
WASM_DIR="target/wasm32v1-none/release"
ENV_OUT="${ENV_OUT:-app/.env.local}"
CIRCLE_TESTNET_USDC_ISSUER="${CIRCLE_TESTNET_USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}"
DEFAULT_UNDERLYING_ASSET="USDC:$CIRCLE_TESTNET_USDC_ISSUER"
UNDERLYING_ASSET="${UNDERLYING_ASSET:-$DEFAULT_UNDERLYING_ASSET}"
YIELD_SOURCE="${YIELD_SOURCE:-mock}"
BLEND_POOL="${BLEND_POOL:-CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF}"
BLEND_USDC="${BLEND_USDC:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}"

# AMM curve parameters (mirror the verified defaults in the AMM test suite).
WAD="1000000000000000000"
SCALAR_ROOT="${SCALAR_ROOT:-2000000000000000000}"     # 2.0 * WAD
INITIAL_ANCHOR="${INITIAL_ANCHOR:-1050000000000000000}" # 1.05 * WAD
FEE_BPS="${FEE_BPS:-10}"                                # 0.10%
TWAP_WINDOW="${TWAP_WINDOW:-1800}"                      # 30 minutes

# Maturity: default to ~90 days out (one quarter), overridable. Unix seconds.
MATURITY="${MATURITY:-$(( $(date -u +%s) + 90 * 86400 ))}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v stellar >/dev/null 2>&1 || die "stellar-cli not found. Install: cargo install --locked stellar-cli"

case "$YIELD_SOURCE" in
  mock|circle|blend) ;;
  *) die "YIELD_SOURCE must be mock, circle, or blend, got '$YIELD_SOURCE'" ;;
esac

if [[ "$YIELD_SOURCE" == "blend" ]]; then
  MARKET_ID="${MARKET_ID:-blend-usdc-q3}"
  YIELD_SOURCE_NAME="${YIELD_SOURCE_NAME:-Blend v2 USDC pool}"
  YIELD_SOURCE_POOL_ADDRESS="$BLEND_POOL"
  YIELD_SOURCE_RESERVE_ADDRESS="$BLEND_USDC"
  YIELD_SOURCE_URL="${YIELD_SOURCE_URL:-https://docs.blend.capital/}"
else
  MARKET_ID="${MARKET_ID:-circle-usdc-q3}"
  YIELD_SOURCE_NAME="${YIELD_SOURCE_NAME:-$([[ "$YIELD_SOURCE" == "circle" ]] && printf 'Circle testnet USDC' || printf 'Simulated testnet rate')}"
  YIELD_SOURCE_POOL_ADDRESS=""
  YIELD_SOURCE_RESERVE_ADDRESS=""
  YIELD_SOURCE_URL="${YIELD_SOURCE_URL:-}"
fi

log "Building contracts to wasm ($WASM_DIR)"
cargo build --release --target wasm32v1-none \
  -p sidereal-sy-wrapper -p sidereal-pt-token -p sidereal-yt-token \
  -p sidereal-tokenizer -p sidereal-amm

# --- deployer identity -------------------------------------------------------
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  log "Generating and funding deployer identity '$IDENTITY' on $NETWORK"
  # CLI >= 23 removed --global (keys are stored globally by default); older
  # CLIs need it. Try the old form first so both work.
  stellar keys generate --global "$IDENTITY" --network "$NETWORK" --fund 2>/dev/null \
    || stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi
ADMIN="$(stellar keys address "$IDENTITY")"
log "Deployer address: $ADMIN"

deploy() {
  # deploy <wasm-name> -> echoes contract id
  stellar contract deploy \
    --wasm "$WASM_DIR/$1.wasm" \
    --source "$IDENTITY" --network "$NETWORK" 2>/dev/null
}

invoke() {
  # invoke <contract-id> <fn> [args...]
  local id="$1"; shift
  stellar contract invoke --id "$id" --source "$IDENTITY" --network "$NETWORK" -- "$@" >/dev/null
}

deploy_asset() {
  local asset="$1" out
  if out="$(stellar contract asset deploy --asset "$asset" \
    --source "$IDENTITY" --network "$NETWORK" 2>/dev/null)"; then
    printf '%s' "$out"
    return
  fi
  stellar contract id asset --asset "$asset" --network "$NETWORK"
}

# --- underlying asset --------------------------------------------------------
# The SY wrapper stores an underlying address. For testnet demos, default to
# Circle's Stellar testnet USDC SAC. Pass UNDERLYING to use a specific contract
# id, or UNDERLYING_ASSET=USDC:<issuer> to resolve another Stellar asset.
if [[ -n "${UNDERLYING:-}" ]]; then
  UNDERLYING_ID="$UNDERLYING"
  log "Using provided underlying: $UNDERLYING_ID"
elif [[ "$YIELD_SOURCE" == "blend" ]]; then
  UNDERLYING_ID="$BLEND_USDC"
  log "Using Blend reserve asset as underlying: $UNDERLYING_ID"
else
  log "Resolving underlying Stellar Asset Contract for $UNDERLYING_ASSET"
  UNDERLYING_ID="$(deploy_asset "$UNDERLYING_ASSET")"
fi
log "Underlying (USDC): $UNDERLYING_ID"

# --- deploy contracts (addresses known before init resolves the cycle) -------
log "Deploying SY wrapper";  SY="$(deploy sidereal_sy_wrapper)";  log "  SY=$SY"
log "Deploying PT token";    PT="$(deploy sidereal_pt_token)";    log "  PT=$PT"
log "Deploying YT token";    YT="$(deploy sidereal_yt_token)";    log "  YT=$YT"
log "Deploying tokenizer";   TK="$(deploy sidereal_tokenizer)";   log "  TK=$TK"
log "Deploying AMM";         AMM="$(deploy sidereal_amm)";        log "  AMM=$AMM"

# --- initialize in dependency order ------------------------------------------
log "Initializing SY wrapper"
if [[ "$YIELD_SOURCE" == "blend" ]]; then
  invoke "$SY" initialize_blend --admin "$ADMIN" --underlying "$UNDERLYING_ID" --pool "$BLEND_POOL"
else
  invoke "$SY" initialize --admin "$ADMIN" --underlying "$UNDERLYING_ID"
fi

log "Initializing PT token"
invoke "$PT" initialize --admin "$ADMIN" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY"

log "Initializing YT token"
invoke "$YT" initialize --admin "$ADMIN" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY"

log "Initializing tokenizer"
invoke "$TK" initialize --admin "$ADMIN" --sy_token "$SY" --pt_token "$PT" --yt_token "$YT" --maturity "$MATURITY"

log "Initializing AMM"
invoke "$AMM" initialize \
  --admin "$ADMIN" --pt_token "$PT" --sy_token "$SY" --yt_token "$YT" --tokenizer "$TK" \
  --maturity "$MATURITY" --scalar_root "$SCALAR_ROOT" --initial_anchor "$INITIAL_ANCHOR" \
  --fee_bps "$FEE_BPS" --twap_window "$TWAP_WINDOW"

# --- write frontend env ------------------------------------------------------
log "Writing $ENV_OUT"
cat > "$ENV_OUT" <<EOF
# Generated by scripts/deploy-testnet.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Public values only.
# Source commit: $(git rev-parse HEAD)
NEXT_PUBLIC_SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS="$ADMIN"
NEXT_PUBLIC_MARKET_ID="$MARKET_ID"
NEXT_PUBLIC_TOKEN_DECIMALS="7"
NEXT_PUBLIC_YIELD_SOURCE_KIND="$YIELD_SOURCE"
NEXT_PUBLIC_YIELD_SOURCE_NAME="$YIELD_SOURCE_NAME"
NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS="$YIELD_SOURCE_POOL_ADDRESS"
NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS="$YIELD_SOURCE_RESERVE_ADDRESS"
NEXT_PUBLIC_YIELD_SOURCE_URL="$YIELD_SOURCE_URL"
NEXT_PUBLIC_SY_ADDRESS="$SY"
NEXT_PUBLIC_PT_ADDRESS="$PT"
NEXT_PUBLIC_YT_ADDRESS="$YT"
NEXT_PUBLIC_TOKENIZER_ADDRESS="$TK"
NEXT_PUBLIC_MARKET_ADDRESS="$AMM"
EOF

log "Done. Maturity=$MATURITY ($(date -u -r "$MATURITY" +%Y-%m-%d 2>/dev/null || echo "$MATURITY"))"
log "Frontend is wired. Start it with: pnpm --filter @sidereal/app dev"
