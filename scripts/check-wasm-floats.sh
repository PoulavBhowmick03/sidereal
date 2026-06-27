#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if ! command -v wasm-objdump >/dev/null 2>&1; then
  echo "error: wasm-objdump is required (install wabt)" >&2
  exit 2
fi

if [[ "$#" -eq 0 ]]; then
  echo "error: pass at least one contract Wasm artifact" >&2
  exit 2
fi

status=0
for wasm in "$@"; do
  if [[ ! -f "$wasm" ]]; then
    echo "error: Wasm artifact not found: $wasm" >&2
    status=1
    continue
  fi

  float_ops="$(wasm-objdump -d "$wasm" | awk '
    /(^|[[:space:]])f(32|64)\./ {
      count++
      if (count <= 20) print
    }
    END {
      if (count > 20) print "... and " count - 20 " more float opcodes"
    }
  ')"
  if [[ -n "$float_ops" ]]; then
    echo "error: floating-point opcodes found in $wasm" >&2
    printf '%s\n' "$float_ops" >&2
    status=1
  else
    echo "ok: no floating-point opcodes in $wasm"
  fi
done

exit "$status"
