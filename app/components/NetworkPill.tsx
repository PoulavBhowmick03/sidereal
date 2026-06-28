// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import { appConfig, TESTNET_PASSPHRASE } from "../lib/config";

// Always-on network indicator in the app header, derived from the configured
// network passphrase (truthful, not decorative). Stays monochrome: the "live"
// cue is a slow pulse on a paper-white dot, not a second accent color.
export function NetworkPill() {
  const label = useMemo(
    () => (appConfig().networkPassphrase === TESTNET_PASSPHRASE ? "Testnet" : "Network"),
    [],
  );

  return (
    <span className="hidden items-center gap-2 rounded-pill border border-white/20 px-3 py-1.5 text-[13px] uppercase tracking-[0.12em] text-smoke sm:inline-flex">
      <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-paper" />
      {label}
    </span>
  );
}
