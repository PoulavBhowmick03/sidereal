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
        className="rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] tabular-nums text-paper transition hover:bg-paper hover:text-ink"
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
      className="rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      {connecting ? "Connecting..." : "Connect wallet"}
    </button>
  );
}
