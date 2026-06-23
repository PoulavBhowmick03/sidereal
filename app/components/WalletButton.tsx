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
        className="rounded-lg border border-white/15 px-3 py-1.5 text-sm tabular-nums hover:border-accent"
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
      className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
    >
      {connecting ? "Connecting..." : "Connect wallet"}
    </button>
  );
}
