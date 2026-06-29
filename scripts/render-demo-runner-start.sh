#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

IDENTITY="${DEPLOY_IDENTITY:-sidereal-smoke}"
NETWORK="${NETWORK:-testnet}"
PORT="${PORT:-10000}"

if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "Preparing Stellar testnet identity: $IDENTITY"
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund >/dev/null
fi

echo "Starting Sidereal demo runner on port $PORT"
exec pnpm --dir app exec next start -p "$PORT" -H 0.0.0.0
