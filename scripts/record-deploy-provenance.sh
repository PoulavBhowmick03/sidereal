#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Record deploy provenance into a committed deployment manifest.
#
# This is the mainnet-grade manifest writer. It is separate from the testnet
# deploy scripts on purpose: those may run against a dirty tree for a dry run,
# but a mainnet manifest must be anchored to a clean, committed revision so the
# recorded hashes can be reproduced later by scripts/verify-reproducible-build.sh.
#
# What it records (all public, no secrets):
#   - source_commit  : the exact committed HEAD (refuses to run on a dirty tree)
#   - source_repo    : the canonical repository URL
#   - [build]        : rust toolchain, rustc, stellar-cli (and thus wasm-opt)
#                      and soroban-sdk versions used to produce the artifacts
#   - [wasm_hashes]  : sha256 of each locally built optimized contract Wasm
#   - [onchain_hashes]: the Wasm hash read back from RPC for each deployed id
#   - contract addresses, curve params, deployer public key
#
# It asserts wasm_hash == onchain_hash for every contract before writing, so a
# manifest cannot be produced if the deployed bytecode does not match the local
# artifact.
#
# Inputs: contract addresses and deploy parameters come from a state file
# (deployments/<network>.state.env, as written by the resilient deploy script)
# and/or environment overrides. The optimized Wasm must already be built into
# WASM_DIR (run scripts/build-optimized-wasm.sh from the same clean commit).
#
# Usage:
#   NETWORK=mainnet \
#   scripts/record-deploy-provenance.sh
#
#   # or point at an explicit state file and manifest:
#   STATE_FILE=deployments/mainnet.state.env \
#   MANIFEST_OUT=deployments/mainnet.toml \
#   scripts/record-deploy-provenance.sh

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

NETWORK="${NETWORK:-mainnet}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
WASM_DIR="${WASM_DIR:-target/wasm32v1-none/release/optimized}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-deployments}"
STATE_FILE="${STATE_FILE:-$DEPLOYMENTS_DIR/$NETWORK.state.env}"
MANIFEST_OUT="${MANIFEST_OUT:-$DEPLOYMENTS_DIR/$NETWORK.toml}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found"
}

require_cmd git
require_cmd cargo
require_cmd stellar

if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "need sha256sum or shasum for hashing"
fi

# --- clean-tree gate (non-negotiable for a recorded mainnet manifest) --------
dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  printf '%s\n' "$dirty" >&2
  die "working tree is not clean. Commit or stash before recording provenance."
fi
SOURCE_COMMIT="$(git rev-parse HEAD)"

# --- load deploy state / addresses -------------------------------------------
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  log "Loaded deploy state from $STATE_FILE"
else
  warn "no state file at $STATE_FILE; expecting addresses from the environment"
fi

: "${SY:?set SY (sy_wrapper contract id) via state file or env}"
: "${PT:?set PT (pt_token contract id) via state file or env}"
: "${YT:?set YT (yt_token contract id) via state file or env}"
: "${TK:?set TK (tokenizer contract id) via state file or env}"
: "${AMM:?set AMM (amm contract id) via state file or env}"
: "${UNDERLYING_ID:?set UNDERLYING_ID (underlying contract id) via state file or env}"
: "${DEPLOYER_ADDRESS:?set DEPLOYER_ADDRESS (deployer public key) via state file or env}"
: "${MATURITY:?set MATURITY (unix seconds) via state file or env}"

DEPLOYER_IDENTITY="${IDENTITY:-${DEPLOY_IDENTITY:-unknown}}"
SCALAR_ROOT="${SCALAR_ROOT:-}"
INITIAL_ANCHOR="${INITIAL_ANCHOR:-}"
FEE_BPS="${FEE_BPS:-}"
TWAP_WINDOW="${TWAP_WINDOW:-}"
YIELD_SOURCE="${YIELD_SOURCE:-unknown}"
BLEND_POOL="${BLEND_POOL:-}"
UNDERLYING_ASSET_OUT="${BLEND_USDC_ASSET:-${UNDERLYING_ASSET:-}}"
MARKET_ID="${MARKET_ID:-}"
YIELD_SOURCE_NAME="${YIELD_SOURCE_NAME:-}"
DEPLOYED_AT="${DEPLOY_FINISHED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# --- build provenance --------------------------------------------------------
SOURCE_REPO="$(git config --get remote.origin.url 2>/dev/null || true)"
if [[ -z "$SOURCE_REPO" ]]; then
  SOURCE_REPO="$(awk -F'"' '/^repository[[:space:]]*=/ {print $2; exit}' Cargo.toml)"
fi
# Normalise git@ SSH form to https for a link that anyone can open.
SOURCE_REPO="${SOURCE_REPO/git@github.com:/https://github.com/}"
SOURCE_REPO="${SOURCE_REPO%.git}"

TOOLCHAIN_CHANNEL="$(awk -F'"' '/^channel[[:space:]]*=/ {print $2; exit}' rust-toolchain.toml)"
RUSTC_VERSION="$(rustc --version 2>/dev/null || echo unknown)"
STELLAR_CLI_VERSION="$(stellar --version 2>/dev/null | head -1 || echo unknown)"
SOROBAN_SDK_VERSION="$(awk -F'"' '/soroban-sdk[[:space:]]*=/ {print $2; exit}' Cargo.toml)"

# --- hashes: local sha256 and on-chain read-back -----------------------------
declare -a KEYS=(sy_wrapper pt_token yt_token tokenizer amm)
declare -a CRATES=(sidereal_sy_wrapper sidereal_pt_token sidereal_yt_token sidereal_tokenizer sidereal_amm)
declare -a IDS=("$SY" "$PT" "$YT" "$TK" "$AMM")

declare -A WASM_HASH ONCHAIN_HASH
for i in "${!KEYS[@]}"; do
  key="${KEYS[$i]}"
  crate="${CRATES[$i]}"
  id="${IDS[$i]}"
  wasm="$WASM_DIR/$crate.wasm"
  [[ -f "$wasm" ]] || die "optimized artifact missing: $wasm (run scripts/build-optimized-wasm.sh)"
  WASM_HASH[$key]="$(sha256_of "$wasm")"
  log "Reading on-chain hash for $key ($id)"
  ONCHAIN_HASH[$key]="$(stellar contract info hash --id "$id" --network "$NETWORK" 2>/dev/null)" \
    || die "failed to read on-chain hash for $key ($id) on $NETWORK"
  if [[ "${WASM_HASH[$key]}" != "${ONCHAIN_HASH[$key]}" ]]; then
    die "hash mismatch for $key: local=${WASM_HASH[$key]} onchain=${ONCHAIN_HASH[$key]}"
  fi
done

# --- assert Blend custody ------------------------------------------------------
# The SY wrapper's admin rate setter (set_exchange_rate) is only disabled when a
# Blend pool is configured (config.pool is Some). An idle-mode wrapper on a real
# network would let a compromised admin key reprice the entire system, so a
# production manifest must never be recorded for one. `config` is a read-only
# view; --send=no simulates without submitting.
log "Asserting the SY wrapper is Blend-backed (admin rate knob dead)"
SY_CONFIG="$(stellar contract invoke --id "$SY" --network "$NETWORK" --send=no -- config 2>/dev/null)" \
  || die "failed to read SY wrapper config for $SY on $NETWORK"
if ! grep -q '"pool": *"C' <<<"$SY_CONFIG"; then
  die "SY wrapper $SY has no Blend pool configured (idle mock-custody mode): the admin rate setter is live, refusing to record a production manifest. Initialize with initialize_blend. Config read: $SY_CONFIG"
fi

# --- write manifest ----------------------------------------------------------
log "Writing $MANIFEST_OUT"
mkdir -p "$DEPLOYMENTS_DIR"
tmp="$(mktemp "$MANIFEST_OUT.tmp.XXXXXX")"
{
  cat <<EOF
# Generated by scripts/record-deploy-provenance.sh.
# Public deployment metadata only. Do not add private keys.
#
# Reproduce and verify:
#   scripts/verify-reproducible-build.sh --manifest $MANIFEST_OUT --commit $SOURCE_COMMIT

network = "$NETWORK"
network_passphrase = "$NETWORK_PASSPHRASE"
source_repo = "$SOURCE_REPO"
source_commit = "$SOURCE_COMMIT"
deployer_identity = "$DEPLOYER_IDENTITY"
deployer_public_key = "$DEPLOYER_ADDRESS"
deployed_at = "$DEPLOYED_AT"
maturity = $MATURITY
token_decimals = 7
yield_source = "$YIELD_SOURCE"
blend_pool = "$BLEND_POOL"
underlying_asset = "$UNDERLYING_ASSET_OUT"

[build]
rust_toolchain = "$TOOLCHAIN_CHANNEL"
rustc = "$RUSTC_VERSION"
stellar_cli = "$STELLAR_CLI_VERSION"
soroban_sdk = "$SOROBAN_SDK_VERSION"
wasm_target = "wasm32v1-none"
optimizer = "stellar contract build (bundled wasm-opt)"

[curve]
scalar_root = "$SCALAR_ROOT"
initial_anchor = "$INITIAL_ANCHOR"
fee_bps = ${FEE_BPS:-0}
twap_window = ${TWAP_WINDOW:-0}

[contracts]
underlying = "$UNDERLYING_ID"
sy_wrapper = "$SY"
pt_token = "$PT"
yt_token = "$YT"
tokenizer = "$TK"
amm = "$AMM"

[wasm_hashes]
sy_wrapper = "${WASM_HASH[sy_wrapper]}"
pt_token = "${WASM_HASH[pt_token]}"
yt_token = "${WASM_HASH[yt_token]}"
tokenizer = "${WASM_HASH[tokenizer]}"
amm = "${WASM_HASH[amm]}"

[onchain_hashes]
sy_wrapper = "${ONCHAIN_HASH[sy_wrapper]}"
pt_token = "${ONCHAIN_HASH[pt_token]}"
yt_token = "${ONCHAIN_HASH[yt_token]}"
tokenizer = "${ONCHAIN_HASH[tokenizer]}"
amm = "${ONCHAIN_HASH[amm]}"
EOF

  if [[ -n "$MARKET_ID" || -n "$YIELD_SOURCE_NAME" ]]; then
    cat <<EOF

[frontend]
env_file = "app/.env.local"
simulation_source = "$DEPLOYER_ADDRESS"
market_id = "$MARKET_ID"
yield_source_name = "$YIELD_SOURCE_NAME"
EOF
  fi
} > "$tmp"
mv "$tmp" "$MANIFEST_OUT"

log "Recorded provenance for $SOURCE_COMMIT"
log "Manifest: $MANIFEST_OUT"
warn "Review and commit $MANIFEST_OUT. Do not commit $STATE_FILE or app/.env.local."
