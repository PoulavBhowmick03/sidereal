// SPDX-License-Identifier: Apache-2.0

"use client";

import { useWallet } from "../lib/wallet";

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        type="button"
        onClick={disconnect}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-sm tabular-nums transition hover:border-neutral-900"
        title={address}
      >
        {shorten(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60"
    >
      {connecting ? "Connecting..." : "Connect wallet"}
    </button>
  );
}
