#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# End-to-end testnet smoke test for the Sidereal core lifecycle.
#
# Deploys a fresh short-maturity market (SY/PT/YT/tokenizer) from the already
# built wasm, then walks the full lifecycle and asserts every on-chain result:
#
#   deposit -> split -> rate bump -> preview/claim yield -> recombine
#   -> (wait for maturity) -> freeze rate -> redeem PT -> redeem SY to underlying
#
# Each economic assertion is checked against the closed-form expectation
# (telescoping yield, principal redemption at the frozen rate, conservation).
# The script exits non-zero on the first mismatch, so it doubles as a
# post-deploy regression check for a grant demo or CI.
#
# It does NOT touch the committed main-market deployment; everything here is a
# throwaway market on a short term. No private keys are written or echoed.
#
# Requirements: stellar-cli, the release wasm already built
# (target/wasm32v1-none/release/*.wasm), a funded deployer identity.
#
# Usage:
#   bash scripts/smoke-testnet.sh
#   TERM_SECONDS=600 DEPLOY_IDENTITY=sidereal-deployer bash scripts/smoke-testnet.sh

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${DEPLOY_IDENTITY:-sidereal-deployer}"
WASM_DIR="${WASM_DIR:-target/wasm32v1-none/release}"

WAD="1000000000000000000"
# How long the throwaway market lives before maturity. Must comfortably exceed
# the time to deploy + walk the pre-maturity steps (~4 min with settle sleeps).
TERM_SECONDS="${TERM_SECONDS:-600}"

# Lifecycle amounts (7-decimal base units, as Stellar USDC).
DEPOSIT_AMOUNT="${DEPOSIT_AMOUNT:-10000000}"   # 10 USDC
SPLIT_AMOUNT="${SPLIT_AMOUNT:-10000000}"       # split the whole deposit
RATE_AFTER="${RATE_AFTER:-1200000000000000000}" # bump SY rate to 1.20

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# muldiv <a> <b> <c> -> floor(a * b / c), matching the contract's mul_div_floor.
# WAD-scale products (~1e25) overflow bash's 64-bit signed ints, so this delegates
# to python3's arbitrary-precision integers. The contract computes in i128.
muldiv() { python3 -c "import sys; a,b,c=map(int,sys.argv[1:]); print(a*b//c)" "$1" "$2" "$3"; }

# assert_eq <label> <actual> <expected> -- for authoritative values returned by
# a tx's own execution (minted/claimed/redeemed amounts), which cannot be stale.
assert_eq() {
  if [[ "$2" != "$3" ]]; then
    die "$1: expected '$3', got '$2'"
  fi
  ok "$1 = $2"
}

# expect_read <label> <expected> <id> <read-fn> [args...]
# Polls a read-only accessor until it equals <expected>, absorbing testnet RPC
# read lag (the public RPC is load-balanced; a read can hit a replica whose
# latest ledger trails the one that included the prior write, returning a stale
# value). A genuinely wrong value never converges, so this still fails on a real
# mismatch -- it only tolerates eventual consistency.
expect_read() {
  local label="$1" expected="$2" id="$3"; shift 3
  local got attempt=0 max=8
  while :; do
    got="$(inv "$id" "$@")"
    if [[ "$got" == "$expected" ]]; then
      ok "$label = $got"
      return 0
    fi
    if (( attempt >= max )); then
      die "$label: expected '$expected', got '$got' after $max reads (not RPC lag)"
    fi
    attempt=$(( attempt + 1 ))
    printf '\033[1;33m  read lag on %s (got %s, want %s), retry %d/%d\033[0m\n' \
      "$label" "$got" "$expected" "$attempt" "$max" >&2
    sleep 8
  done
}

# Settle gap between submissions. Submitting before the prior tx's new account
# sequence and state writes have propagated across the load-balanced RPC's
# replicas gives TxBadSeq or stale-state simulation failures; a pause of several
# ledger closes (testnet closes ~every 5-6s) lets the replicas converge.
settle() { sleep 16; }

# inv <id> <fn> [args...] -> prints the contract return (quotes stripped).
# Retries transient submission errors with backoff. "already applied" is treated
# as success (a timed-out submit that actually landed); the exact post-state
# assertions after each economic step guard against an accidental double-apply.
inv() {
  local id="$1"; shift
  local out attempt=0 max=5
  while :; do
    if out="$(stellar contract invoke --id "$id" --source "$IDENTITY" \
        --network "$NETWORK" -- "$@" 2>/tmp/smoke_inv_err)"; then
      printf '%s' "$out" | tr -d '"'
      return 0
    fi
    if is_already_applied /tmp/smoke_inv_err; then
      printf '\033[1;33m  %s already applied (timed-out submit landed)\033[0m\n' "$1" >&2
      printf ''
      return 0
    fi
    if is_transient /tmp/smoke_inv_err && (( attempt < max )); then
      attempt=$(( attempt + 1 ))
      printf '\033[1;33m  retry %d/%d (transient) on %s\033[0m\n' "$attempt" "$max" "$1" >&2
      sleep $(( 10 + attempt * 8 ))
      continue
    fi
    cat /tmp/smoke_inv_err >&2
    die "invoke $* failed"
  done
}

# Transient testnet errors that are safe to re-run. Two classes:
#  - submission errors: TxBadSeq (rejected, never applied), timeouts / 5xx /
#    rate limits (RPC-side; may or may not have landed, paired with an
#    "already applied" check or an exact post-state assertion downstream).
#  - stale-state simulation failures: the public RPC is load-balanced, so a
#    transaction's simulation can hit a replica whose latest ledger trails a
#    just-confirmed write and fail (e.g. InsufficientBalance for a balance that
#    expect_read already confirmed). Bounded retry lets the replica catch up; a
#    genuinely failing op never recovers and still dies after the retries.
is_transient() {
  grep -Eq "TxBadSeq|submission timeout|TryAgainLater|rate.?limit|50[0-9] |timed out|Timeout|transaction simulation failed|Contract Code not found" "$1"
}
# An error that means the effect already happened (a timed-out submit did land).
is_already_applied() {
  grep -Eq "AlreadyInitialized|already initialized|ExistingValue|already exists" "$1"
}

# retry_out <label> <stellar args...> -> stdout, retrying transient errors.
retry_out() {
  local label="$1"; shift
  local out attempt=0 max=5
  while :; do
    if out="$(stellar "$@" 2>/tmp/smoke_inv_err)"; then
      printf '%s' "$out"
      return 0
    fi
    if is_already_applied /tmp/smoke_inv_err; then
      printf '\033[1;33m  %s already applied (timed-out submit landed)\033[0m\n' "$label" >&2
      return 0
    fi
    if is_transient /tmp/smoke_inv_err && (( attempt < max )); then
      attempt=$(( attempt + 1 ))
      printf '\033[1;33m  retry %d/%d (transient) on %s\033[0m\n' "$attempt" "$max" "$label" >&2
      sleep $(( 10 + attempt * 8 ))
      continue
    fi
    cat /tmp/smoke_inv_err >&2
    die "$label failed"
  done
}

deploy_hash() {
  # deploy_hash <wasm-name> -> contract id (uploads wasm, then deploys by hash)
  local hash id
  hash="$(retry_out "upload $1" contract upload --wasm "$WASM_DIR/$1.wasm" \
    --source "$IDENTITY" --network "$NETWORK")"
  settle
  id="$(retry_out "deploy $1" contract deploy --wasm-hash "$hash" \
    --source "$IDENTITY" --network "$NETWORK")"
  settle
  printf '%s' "$id"
}

command -v stellar >/dev/null 2>&1 || die "stellar-cli not found"
[[ -f "$WASM_DIR/sidereal_sy_wrapper.wasm" ]] || die "wasm not built; run: make build"

ADMIN="$(stellar keys address "$IDENTITY")"
MATURITY="$(( $(date -u +%s) + TERM_SECONDS ))"
log "Deployer: $ADMIN"
log "Throwaway market maturity: $MATURITY (now + ${TERM_SECONDS}s)"

# --- underlying SAC (deploy or reuse the deployer's test USDC) ---------------
UNDERLYING="$(retry_out "deploy underlying SAC" contract asset deploy \
  --asset "USDC:$ADMIN" --source "$IDENTITY" --network "$NETWORK")"
settle
log "Underlying USDC SAC: $UNDERLYING"

# --- deploy a fresh market ---------------------------------------------------
log "Deploying fresh SY/PT/YT/tokenizer"
SY="$(deploy_hash sidereal_sy_wrapper)"; log "  SY=$SY"
PT="$(deploy_hash sidereal_pt_token)";   log "  PT=$PT"
YT="$(deploy_hash sidereal_yt_token)";   log "  YT=$YT"
TK="$(deploy_hash sidereal_tokenizer)";  log "  TK=$TK"

log "Initializing"
inv "$SY" initialize --admin "$ADMIN" --underlying "$UNDERLYING" >/dev/null; settle
inv "$PT" initialize --admin "$ADMIN" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY" >/dev/null; settle
inv "$YT" initialize --admin "$ADMIN" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY" >/dev/null; settle
inv "$TK" initialize --admin "$ADMIN" --sy_token "$SY" --pt_token "$PT" --yt_token "$YT" --maturity "$MATURITY" >/dev/null; settle

# Running expectation of the holder's SY balance, advanced step by step.
sy_expected=0

# --- deposit -----------------------------------------------------------------
log "Deposit $DEPOSIT_AMOUNT underlying"
minted="$(inv "$SY" deposit --from "$ADMIN" --amount "$DEPOSIT_AMOUNT")"; settle
assert_eq "SY minted (rate 1.0)" "$minted" "$DEPOSIT_AMOUNT"
sy_expected="$DEPOSIT_AMOUNT"
expect_read "SY balance after deposit" "$sy_expected" "$SY" balance --id "$ADMIN"

# --- split -------------------------------------------------------------------
log "Split $SPLIT_AMOUNT SY into PT+YT"
inv "$TK" split --from "$ADMIN" --sy_amount "$SPLIT_AMOUNT" >/dev/null; settle
sy_expected="$(( sy_expected - SPLIT_AMOUNT ))"
expect_read "PT minted (asset units, rate 1.0)" "$SPLIT_AMOUNT" "$PT" balance --id "$ADMIN"
expect_read "YT minted (asset units, rate 1.0)" "$SPLIT_AMOUNT" "$YT" balance --id "$ADMIN"
expect_read "SY spent by split" "$sy_expected" "$SY" balance --id "$ADMIN"

# --- rate bump + claim yield -------------------------------------------------
log "Bump SY rate to $RATE_AFTER"
inv "$SY" set_exchange_rate --admin "$ADMIN" --exchange_rate "$RATE_AFTER" >/dev/null; settle

# The exchange rate is an admin mock here. In production it rises because the
# wrapped yield source actually accrued more underlying; the vault would already
# hold the extra. With a mock rate, nothing entered the vault, so the shares now
# claim more underlying than is on hand. Top the vault up with the underlying the
# new rate implies (S * R / WAD), so SY redemptions are honoured at the new rate.
# This is the deliberate testnet stand-in for real yield accrual.
needed_underlying="$(muldiv "$DEPOSIT_AMOUNT" "$RATE_AFTER" "$WAD")"
topup="$(( needed_underlying - DEPOSIT_AMOUNT ))"
log "Top up vault underlying by $topup (simulate the accrued yield backing)"
inv "$UNDERLYING" transfer --from "$ADMIN" --to "$SY" --amount "$topup" >/dev/null; settle

# telescoping yield: owed = bal * (R - c) / (c * R) * WAD, c = 1.0 (mint rate)
# = SPLIT * (RATE_AFTER - WAD) / RATE_AFTER  (since c = WAD)
expected_yield="$(muldiv "$SPLIT_AMOUNT" "$(( RATE_AFTER - WAD ))" "$RATE_AFTER")"
preview="$(inv "$TK" preview_claim_yield --holder "$ADMIN")"; settle
assert_eq "preview_claim_yield (telescoping)" "$preview" "$expected_yield"

log "Claim yield"
claimed="$(inv "$TK" claim_yield --holder "$ADMIN")"; settle
assert_eq "claim_yield payout" "$claimed" "$expected_yield"
sy_expected="$(( sy_expected + expected_yield ))"
expect_read "SY balance after claim" "$sy_expected" "$SY" balance --id "$ADMIN"

# --- recombine ---------------------------------------------------------------
# return only principal: pt * WAD / rate
log "Recombine $SPLIT_AMOUNT PT+YT"
expected_principal="$(muldiv "$SPLIT_AMOUNT" "$WAD" "$RATE_AFTER")"
returned="$(inv "$TK" recombine --from "$ADMIN" --pt_amount "$SPLIT_AMOUNT" --yt_amount "$SPLIT_AMOUNT")"; settle
assert_eq "recombine returns principal at rate" "$returned" "$expected_principal"
sy_expected="$(( sy_expected + expected_principal ))"
expect_read "PT burned by recombine" "0" "$PT" balance --id "$ADMIN"
expect_read "YT burned by recombine" "0" "$YT" balance --id "$ADMIN"
expect_read "SY balance after recombine" "$sy_expected" "$SY" balance --id "$ADMIN"

# At this point the holder has reclaimed all value: yield (claimed) + principal
# (recombined). Re-split the whole SY balance so there is a PT position to
# redeem at maturity. face = sy * rate / WAD (asset units).
log "Re-split $sy_expected SY for the maturity-redeem leg"
inv "$TK" split --from "$ADMIN" --sy_amount "$sy_expected" >/dev/null; settle
pt_for_redeem="$(muldiv "$sy_expected" "$RATE_AFTER" "$WAD")"
expect_read "PT held for redeem (face at rate)" "$pt_for_redeem" "$PT" balance --id "$ADMIN"

# --- wait for maturity -------------------------------------------------------
log "Waiting for maturity ($MATURITY)"
while [[ "$(date -u +%s)" -lt "$MATURITY" ]]; do
  remaining="$(( MATURITY - $(date -u +%s) ))"
  log "  ${remaining}s to maturity"
  sleep 15
done
# small cushion so the ledger close timestamp is past maturity
sleep 10

# --- freeze + redeem PT ------------------------------------------------------
log "Freeze maturity rate"
frozen="$(inv "$TK" freeze_maturity_rate)"; settle
assert_eq "frozen maturity rate" "$frozen" "$RATE_AFTER"

log "Redeem PT at maturity"
expected_redeem="$(muldiv "$pt_for_redeem" "$WAD" "$RATE_AFTER")"
redeemed="$(inv "$TK" redeem_at_maturity --from "$ADMIN" --pt_amount "$pt_for_redeem")"; settle
assert_eq "redeem_at_maturity pays principal (not 1:1)" "$redeemed" "$expected_redeem"
expect_read "PT burned by redeem" "0" "$PT" balance --id "$ADMIN"

# --- redeem SY to underlying -------------------------------------------------
log "Redeem SY principal to underlying"
expected_underlying="$(muldiv "$redeemed" "$RATE_AFTER" "$WAD")"
got_underlying="$(inv "$SY" redeem --from "$ADMIN" --sy_amount "$redeemed")"; settle
assert_eq "SY redeem returns underlying at rate" "$got_underlying" "$expected_underlying"

log "SMOKE TEST PASSED"
printf '\nMarket (throwaway, matured):\n  SY=%s\n  PT=%s\n  YT=%s\n  TK=%s\n' "$SY" "$PT" "$YT" "$TK"
