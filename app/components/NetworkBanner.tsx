// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import { appConfig, TESTNET_PASSPHRASE } from "../lib/config";
import { useWallet } from "../lib/wallet";

/** Warns when the connected wallet is on a different network than the app. */
export function NetworkBanner() {
  const { networkMismatch } = useWallet();
  const expected = useMemo(
    () => (appConfig().networkPassphrase === TESTNET_PASSPHRASE ? "testnet" : "the configured network"),
    [],
  );
  if (!networkMismatch) return null;

  return (
    <div className="border-b border-white/10 bg-carbon">
      <p className="mx-auto max-w-[1280px] px-6 py-2.5 text-xs font-medium text-amber">
        Your wallet is on a different network. Switch it to {expected} to sign transactions for this
        market.
      </p>
    </div>
  );
}
