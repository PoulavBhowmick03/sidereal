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

# The workspace [profile.release] carries the size settings (opt-level=z,
# lto, codegen-units=1, panic=abort, strip), so one uniform build covers every
# contract; stellar-cli additionally runs wasm-opt (--optimize defaults to on).
log "Building optimized deploy artifacts into $OPT_WASM_DIR"
stellar contract build --locked --out-dir "$OPT_WASM_DIR"

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
