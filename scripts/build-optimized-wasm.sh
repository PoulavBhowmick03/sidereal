#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Build deployable Sidereal contract Wasm artifacts.
#
# This script uses Stellar's optimized Soroban build path and writes upload-ready
# artifacts into a separate directory so deploy scripts never upload debug-only
# sections.

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

OPT_WASM_DIR="${OPT_WASM_DIR:-target/wasm32v1-none/release/optimized}"
AMM_SIZE_TARGET_DIR="${AMM_SIZE_TARGET_DIR:-target/amm-size-release}"

contracts=(
  sidereal_sy_wrapper
  sidereal_pt_token
  sidereal_yt_token
  sidereal_tokenizer
  sidereal_amm
)

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found"
}

require_cmd cargo
require_cmd stellar

log "Building optimized deploy artifacts into $OPT_WASM_DIR"
stellar contract build --locked --out-dir "$OPT_WASM_DIR"

if [[ "${SKIP_AMM_SIZE_PROFILE:-0}" != "1" ]]; then
  log "Building AMM size-profile candidate"
  amm_candidate_dir="$(mktemp -d "$OPT_WASM_DIR/amm-size-candidate.XXXXXX")"
  CARGO_TARGET_DIR="$AMM_SIZE_TARGET_DIR" \
  CARGO_BUILD_RUSTFLAGS="-C opt-level=z -C codegen-units=1 -C panic=abort -C strip=symbols" \
    stellar contract build --locked --package sidereal-amm --out-dir "$amm_candidate_dir"
  amm_candidate="$amm_candidate_dir/sidereal_amm.wasm"

  current_size="$(wc -c < "$OPT_WASM_DIR/sidereal_amm.wasm" | tr -d ' ')"
  candidate_size="$(wc -c < "$amm_candidate" | tr -d ' ')"
  if (( candidate_size < current_size )); then
    mv "$amm_candidate" "$OPT_WASM_DIR/sidereal_amm.wasm"
    log "Selected AMM size-profile artifact: $candidate_size bytes, was $current_size"
  else
    log "Kept standard AMM artifact: $current_size bytes, candidate was $candidate_size"
  fi
  rm -rf "$amm_candidate_dir"
fi

if [[ "${SKIP_WASM_FLOAT_CHECK:-0}" != "1" ]]; then
  require_cmd wasm-objdump
  bash scripts/check-wasm-floats.sh \
    "$OPT_WASM_DIR/sidereal_sy_wrapper.wasm" \
    "$OPT_WASM_DIR/sidereal_pt_token.wasm" \
    "$OPT_WASM_DIR/sidereal_yt_token.wasm" \
    "$OPT_WASM_DIR/sidereal_tokenizer.wasm" \
    "$OPT_WASM_DIR/sidereal_amm.wasm"
fi

log "Deployable Wasm sizes"
for contract in "${contracts[@]}"; do
  bytes="$(wc -c < "$OPT_WASM_DIR/$contract.wasm" | tr -d ' ')"
  printf '%s %s bytes\n' "$contract" "$bytes"
done
