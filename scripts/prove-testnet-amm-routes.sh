#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Deploys a fresh long-maturity Sidereal market on Stellar testnet and proves
# every AMM route with real submitted transactions:
#
#   add_liquidity, swap_sy_for_pt, swap_pt_for_sy, swap_sy_for_yt, swap_yt_for_sy
#
# This is intentionally separate from smoke-testnet.sh. The smoke script uses a
# short maturity to test lifecycle redemption; AMM curve math should be tested
# with a normal term because very short maturities create extreme implied rates.
#
# Requirements:
#   - stellar-cli
#   - built release Wasm in target/wasm32v1-none/release
#   - a funded testnet identity, default DEPLOY_IDENTITY=sidereal-smoke
#
# Usage:
#   make wasm
#   DEPLOY_IDENTITY=sidereal-smoke bash scripts/prove-testnet-amm-routes.sh
#
# Optional:
#   TRADE_AMOUNT=1000000 SLIPPAGE_BPS=500 REPORT_FILE=deployments/amm-routes-testnet.state.env \
#     bash scripts/prove-testnet-amm-routes.sh

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${DEPLOY_IDENTITY:-sidereal-smoke}"
WASM_DIR="${WASM_DIR:-target/wasm32v1-none/release}"
REPORT_FILE="${REPORT_FILE:-deployments/amm-routes-testnet.state.env}"

# 90 days by default, matching the intended product term and avoiding the
# short-maturity TWAP overflow path that is only useful for lifecycle smoke.
TERM_SECONDS="${TERM_SECONDS:-7776000}"
MATURITY="${MATURITY:-$(( $(date -u +%s) + TERM_SECONDS ))}"

# 7-decimal base units. Defaults: deposit 200, split 100, seed 80 PT / 80 SY,
# trade 0.1 per route.
DEPOSIT_AMOUNT="${DEPOSIT_AMOUNT:-2000000000}"
SPLIT_AMOUNT="${SPLIT_AMOUNT:-1000000000}"
LIQ_PT="${LIQ_PT:-800000000}"
LIQ_SY="${LIQ_SY:-800000000}"
TRADE_AMOUNT="${TRADE_AMOUNT:-1000000}"

SCALAR_ROOT="${SCALAR_ROOT:-2000000000000000000}"
INITIAL_ANCHOR="${INITIAL_ANCHOR:-1050000000000000000}"
FEE_BPS="${FEE_BPS:-10}"
TWAP_WINDOW="${TWAP_WINDOW:-1800}"
SLIPPAGE_BPS="${SLIPPAGE_BPS:-500}"
BPS_DENOMINATOR=10000

ERR_FILE="${TMPDIR:-/tmp}/sidereal_amm_routes_err.$$"
trap 'rm -f "$ERR_FILE"' EXIT

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m  ok:\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

last_value() {
  awk 'NF { line=$0 } END { gsub(/"/, "", line); print line }'
}

extract_contract_id() {
  grep -Eo 'C[A-Z0-9]{55}' | tail -1
}

extract_wasm_hash() {
  grep -Eo '[0-9a-f]{64}' | tail -1
}

mul_div_floor() {
  python3 -c "import sys; a,b,c=map(int,sys.argv[1:]); print(a*b//c)" "$1" "$2" "$3"
}

require_positive_int() {
  local label="$1" value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    die "$label must be a positive integer, got '$value'"
  fi
}

require_ge() {
  local label="$1" value="$2" minimum="$3"
  require_positive_int "$label" "$value"
  if [[ "$value" -lt "$minimum" ]]; then
    die "$label below minimum: got $value, minimum $minimum"
  fi
}

settle() {
  sleep "${SETTLE_SECONDS:-16}"
}

is_transient() {
  grep -Eq \
    "TxBadSeq|submission timeout|TryAgainLater|rate.?limit|50[0-9] |timed out|Timeout|transaction simulation failed|Contract Code not found|Contract not found|Storage MissingValue" \
    "$1"
}

retry_stellar() {
  local label="$1"
  shift
  local out attempt=0 max="${MAX_RETRIES:-8}"
  while :; do
    if out="$(stellar "$@" 2>"$ERR_FILE")"; then
      printf '%s' "$out"
      return 0
    fi
    if is_transient "$ERR_FILE" && (( attempt < max )); then
      attempt=$((attempt + 1))
      printf '\033[1;33m  retry %d/%d on %s\033[0m\n' "$attempt" "$max" "$label" >&2
      sleep $((10 + attempt * 8))
      continue
    fi
    cat "$ERR_FILE" >&2
    die "$label failed"
  done
}

invoke() {
  local id="$1"
  shift
  local out attempt=0 max="${MAX_RETRIES:-8}"
  while :; do
    if out="$(stellar contract invoke --id "$id" --source "$IDENTITY" --network "$NETWORK" -- "$@" 2>"$ERR_FILE")"; then
      printf '%s' "$out" | last_value
      return 0
    fi
    if is_transient "$ERR_FILE" && (( attempt < max )); then
      attempt=$((attempt + 1))
      printf '\033[1;33m  retry %d/%d on %s\033[0m\n' "$attempt" "$max" "$1" >&2
      sleep $((10 + attempt * 8))
      continue
    fi
    cat "$ERR_FILE" >&2
    die "invoke $* failed"
  done
}

deploy_asset() {
  local asset="$1" out
  if out="$(stellar contract asset deploy --asset "$asset" --source "$IDENTITY" --network "$NETWORK" 2>"$ERR_FILE")"; then
    printf '%s' "$out" | extract_contract_id
    return 0
  fi
  if grep -Eq "ExistingValue|already exists|contract already exists" "$ERR_FILE"; then
    stellar contract id asset --asset "$asset" --network "$NETWORK"
    return 0
  fi
  cat "$ERR_FILE" >&2
  die "deploy asset $asset failed"
}

deploy_hash() {
  local wasm="$1" upload_out hash deploy_out id
  upload_out="$(retry_stellar "upload $wasm" contract upload --wasm "$WASM_DIR/$wasm.wasm" --source "$IDENTITY" --network "$NETWORK")"
  hash="$(printf '%s' "$upload_out" | extract_wasm_hash)"
  [[ -n "$hash" ]] || die "could not parse wasm hash for $wasm"
  settle
  deploy_out="$(retry_stellar "deploy $wasm" contract deploy --wasm-hash "$hash" --source "$IDENTITY" --network "$NETWORK")"
  id="$(printf '%s' "$deploy_out" | extract_contract_id)"
  [[ -n "$id" ]] || die "could not parse deployed contract id for $wasm"
  settle
  printf '%s' "$id"
}

run_swap() {
  local label="$1" quote_fn="$2" quote_arg="$3" swap_fn="$4" amount_arg="$5" min_arg="$6"
  local quote min_out out
  quote="$(invoke "$AMM" "$quote_fn" "$quote_arg" "$TRADE_AMOUNT")"
  require_positive_int "$label quote" "$quote"
  min_out="$(mul_div_floor "$quote" "$((BPS_DENOMINATOR - SLIPPAGE_BPS))" "$BPS_DENOMINATOR")"
  log "$label quote=$quote min=$min_out"
  out="$(invoke "$AMM" "$swap_fn" --from "$ADMIN" "$amount_arg" "$TRADE_AMOUNT" "$min_arg" "$min_out")"
  settle
  require_ge "$label output" "$out" "$min_out"

  case "$label" in
    "SY->PT") SY_TO_PT_QUOTE="$quote"; SY_TO_PT_OUT="$out" ;;
    "PT->SY") PT_TO_SY_QUOTE="$quote"; PT_TO_SY_OUT="$out" ;;
    "SY->YT") SY_TO_YT_QUOTE="$quote"; SY_TO_YT_OUT="$out" ;;
    "YT->SY") YT_TO_SY_QUOTE="$quote"; YT_TO_SY_OUT="$out" ;;
  esac
}

command -v stellar >/dev/null 2>&1 || die "stellar-cli not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

for wasm in sidereal_sy_wrapper sidereal_pt_token sidereal_yt_token sidereal_tokenizer sidereal_amm; do
  [[ -f "$WASM_DIR/$wasm.wasm" ]] || die "missing $WASM_DIR/$wasm.wasm, run: make wasm"
done

if [[ "$SLIPPAGE_BPS" -lt 0 || "$SLIPPAGE_BPS" -ge "$BPS_DENOMINATOR" ]]; then
  die "SLIPPAGE_BPS must be between 0 and $((BPS_DENOMINATOR - 1))"
fi

ADMIN="$(stellar keys address "$IDENTITY")"
log "Identity: $IDENTITY = $ADMIN"
log "Maturity: $MATURITY"

UNDERLYING="$(deploy_asset "USDC:$ADMIN")"
settle
log "Underlying SAC: $UNDERLYING"

log "Deploying contracts"
SY="$(deploy_hash sidereal_sy_wrapper)"; log "  SY=$SY"
PT="$(deploy_hash sidereal_pt_token)"; log "  PT=$PT"
YT="$(deploy_hash sidereal_yt_token)"; log "  YT=$YT"
TOKENIZER="$(deploy_hash sidereal_tokenizer)"; log "  TOKENIZER=$TOKENIZER"
AMM="$(deploy_hash sidereal_amm)"; log "  AMM=$AMM"

log "Initializing contracts"
invoke "$SY" initialize --admin "$ADMIN" --underlying "$UNDERLYING" >/dev/null
settle
invoke "$PT" initialize --admin "$ADMIN" --tokenizer "$TOKENIZER" --sy_token "$SY" --maturity "$MATURITY" >/dev/null
settle
invoke "$YT" initialize --admin "$ADMIN" --tokenizer "$TOKENIZER" --sy_token "$SY" --maturity "$MATURITY" >/dev/null
settle
invoke "$TOKENIZER" initialize --admin "$ADMIN" --sy_token "$SY" --pt_token "$PT" --yt_token "$YT" --maturity "$MATURITY" >/dev/null
settle
invoke "$AMM" initialize \
  --admin "$ADMIN" \
  --pt_token "$PT" \
  --sy_token "$SY" \
  --yt_token "$YT" \
  --tokenizer "$TOKENIZER" \
  --maturity "$MATURITY" \
  --scalar_root "$SCALAR_ROOT" \
  --initial_anchor "$INITIAL_ANCHOR" \
  --fee_bps "$FEE_BPS" \
  --twap_window "$TWAP_WINDOW" >/dev/null
settle

log "Depositing, splitting, and seeding liquidity"
minted="$(invoke "$SY" deposit --from "$ADMIN" --amount "$DEPOSIT_AMOUNT")"
settle
[[ "$minted" == "$DEPOSIT_AMOUNT" ]] || die "deposit minted $minted, expected $DEPOSIT_AMOUNT"
invoke "$TOKENIZER" split --from "$ADMIN" --sy_amount "$SPLIT_AMOUNT" >/dev/null
settle
LP_OUT="$(invoke "$AMM" add_liquidity --from "$ADMIN" --pt_in "$LIQ_PT" --sy_in "$LIQ_SY")"
settle
require_positive_int "LP minted" "$LP_OUT"

INITIAL_STATE="$(invoke "$AMM" state)"
ok "Initial AMM state: $INITIAL_STATE"

run_swap "SY->PT" quote_sy_for_pt --sy_in swap_sy_for_pt --sy_in --min_pt_out
run_swap "PT->SY" quote_pt_for_sy --pt_in swap_pt_for_sy --pt_in --min_sy_out
run_swap "SY->YT" quote_sy_for_yt --sy_in swap_sy_for_yt --sy_in --min_yt_out
run_swap "YT->SY" quote_yt_for_sy --yt_in swap_yt_for_sy --yt_in --min_sy_out

FINAL_STATE="$(invoke "$AMM" state)"
ok "Final AMM state: $FINAL_STATE"

mkdir -p "$(dirname "$REPORT_FILE")"
cat > "$REPORT_FILE" <<EOF
# Generated by scripts/prove-testnet-amm-routes.sh
# Network: $NETWORK
# Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOY_IDENTITY="$IDENTITY"
ADMIN="$ADMIN"
UNDERLYING="$UNDERLYING"
SY="$SY"
PT="$PT"
YT="$YT"
TOKENIZER="$TOKENIZER"
AMM="$AMM"
MATURITY="$MATURITY"
LP_OUT="$LP_OUT"
TRADE_AMOUNT="$TRADE_AMOUNT"
SY_TO_PT_QUOTE="$SY_TO_PT_QUOTE"
SY_TO_PT_OUT="$SY_TO_PT_OUT"
PT_TO_SY_QUOTE="$PT_TO_SY_QUOTE"
PT_TO_SY_OUT="$PT_TO_SY_OUT"
SY_TO_YT_QUOTE="$SY_TO_YT_QUOTE"
SY_TO_YT_OUT="$SY_TO_YT_OUT"
YT_TO_SY_QUOTE="$YT_TO_SY_QUOTE"
YT_TO_SY_OUT="$YT_TO_SY_OUT"
EOF

ok "All AMM routes succeeded on testnet"
ok "Report written to $REPORT_FILE"
printf '\nAMM=%s\nSY=%s\nPT=%s\nYT=%s\nTOKENIZER=%s\n' "$AMM" "$SY" "$PT" "$YT" "$TOKENIZER"
