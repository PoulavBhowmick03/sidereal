#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Live Blend-backed Sidereal lifecycle on Stellar testnet:
# deposit -> split -> wait for real Blend interest -> claim -> recombine -> redeem.
#
# This script never uses mock auth or the mock exchange-rate setter. It expects
# the deployer to hold the exact USDC reserve asset used by the configured pool.

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${DEPLOY_IDENTITY:-sidereal-deployer}"
WASM_DIR="${WASM_DIR:-target/wasm32v1-none/release}"
BLEND_POOL="${BLEND_POOL:-CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF}"
UNDERLYING="${BLEND_USDC:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}"
DEPOSIT_AMOUNT="${DEPOSIT_AMOUNT:-30000000}"
WAIT_SECONDS="${WAIT_SECONDS:-2400}"
POLL_SECONDS="${POLL_SECONDS:-30}"
TERM_SECONDS="${TERM_SECONDS:-3600}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

inv() {
  local id="$1"
  shift
  local out attempt=0
  while :; do
    if out="$(stellar contract invoke --id "$id" --source "$IDENTITY" --network "$NETWORK" \
      --auto-sign -- "$@" 2>/tmp/smoke_blend_err)"; then
      printf '%s' "$out" | tr -d '"'
      return 0
    fi
    if grep -Eq "Request timeout|TxBadSeq|TryAgainLater|rate.?limit|50[0-9]|timed out|Timeout|transaction simulation failed" /tmp/smoke_blend_err \
      && (( attempt < 5 )); then
      attempt=$(( attempt + 1 ))
      log "transient invoke failure, retry $attempt/5" >&2
      sleep $(( 8 + attempt * 4 ))
      continue
    fi
    cat /tmp/smoke_blend_err >&2
    return 1
  done
}

deploy() {
  local name="$1" hash
  hash="$(stellar contract upload --wasm "$WASM_DIR/$name.wasm" \
    --source "$IDENTITY" --network "$NETWORK")"
  sleep 8
  stellar contract deploy --wasm-hash "$hash" --source "$IDENTITY" --network "$NETWORK"
}

command -v stellar >/dev/null 2>&1 || die "stellar-cli not found"
for wasm in sidereal_sy_wrapper sidereal_pt_token sidereal_yt_token sidereal_tokenizer; do
  [[ -f "$WASM_DIR/$wasm.wasm" ]] || die "missing $WASM_DIR/$wasm.wasm"
done

ADMIN="$(stellar keys address "$IDENTITY")"
MATURITY="$(( $(date -u +%s) + TERM_SECONDS ))"
if [[ -n "${SY:-}" && -n "${PT:-}" && -n "${YT:-}" && -n "${TK:-}" ]]; then
  RATE_START="${RATE_START:-1000000000000000000}"
  FACE="$(inv "$PT" balance --id "$ADMIN")"
  (( FACE > 0 )) || die "resume position has no PT"
  log "Resuming SY=$SY PT=$PT YT=$YT TK=$TK"
else
  AVAILABLE="$(inv "$UNDERLYING" balance --id "$ADMIN")"
  (( AVAILABLE >= DEPOSIT_AMOUNT )) || die "need $DEPOSIT_AMOUNT Blend USDC, have $AVAILABLE"
  log "Deploying fresh Blend-backed lifecycle"
  SY="$(deploy sidereal_sy_wrapper)"; log "SY=$SY"
  PT="$(deploy sidereal_pt_token)"; log "PT=$PT"
  YT="$(deploy sidereal_yt_token)"; log "YT=$YT"
  TK="$(deploy sidereal_tokenizer)"; log "TK=$TK"
  inv "$SY" initialize_blend --admin "$ADMIN" --underlying "$UNDERLYING" --pool "$BLEND_POOL" >/dev/null; sleep 8
  inv "$PT" initialize --admin "$ADMIN" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY" >/dev/null; sleep 8
  inv "$YT" initialize --admin "$ADMIN" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY" >/dev/null; sleep 8
  inv "$TK" initialize --admin "$ADMIN" --sy_token "$SY" --pt_token "$PT" --yt_token "$YT" --maturity "$MATURITY" >/dev/null; sleep 8
  log "Depositing $DEPOSIT_AMOUNT reserve units into Blend"
  MINTED="$(inv "$SY" deposit --from "$ADMIN" --amount "$DEPOSIT_AMOUNT")"
  (( MINTED > 0 && MINTED <= DEPOSIT_AMOUNT )) || die "invalid SY minted: $MINTED"
  RATE_START="$(inv "$SY" exchange_rate)"
  log "Minted $MINTED SY at derived rate $RATE_START"
  inv "$TK" split --from "$ADMIN" --sy_amount "$MINTED" >/dev/null; sleep 8
  FACE="$(inv "$PT" balance --id "$ADMIN")"
  (( FACE > 0 )) || die "split minted no PT"
fi

log "Waiting for positive claimable yield from real Blend b-rate accrual"
deadline="$(( $(date -u +%s) + WAIT_SECONDS ))"
while :; do
  RATE_NOW="$(inv "$SY" exchange_rate)"
  CLAIMABLE="$(inv "$TK" preview_claim_yield --holder "$ADMIN")"
  if (( RATE_NOW > RATE_START && CLAIMABLE > 0 )); then
    break
  fi
  (( $(date -u +%s) < deadline )) || \
    die "no positive yield before timeout, rate=$RATE_NOW claimable=$CLAIMABLE"
  log "rate=$RATE_NOW claimable=$CLAIMABLE, waiting ${POLL_SECONDS}s"
  sleep "$POLL_SECONDS"
done

CLAIMED="$(inv "$TK" claim_yield --holder "$ADMIN")"
(( CLAIMED > 0 )) || die "claim returned no yield"
PRINCIPAL="$(inv "$TK" recombine --from "$ADMIN" --pt_amount "$FACE" --yt_amount "$FACE")"
(( PRINCIPAL > 0 )) || die "recombine returned no principal"
SY_BALANCE="$(inv "$SY" balance --id "$ADMIN")"
UNDERLYING_OUT="$(inv "$SY" redeem --from "$ADMIN" --sy_amount "$SY_BALANCE")"
(( UNDERLYING_OUT > 0 )) || die "redeem returned no underlying"

log "BLEND SMOKE PASSED"
printf 'SY=%s\nPT=%s\nYT=%s\nTK=%s\nrate_start=%s\nrate_end=%s\nclaimed=%s\nredeemed=%s\n' \
  "$SY" "$PT" "$YT" "$TK" "$RATE_START" "$RATE_NOW" "$CLAIMED" "$UNDERLYING_OUT"
