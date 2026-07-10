// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import { appConfig, networkLabel } from "../lib/config";

// Always-on network indicator in the app header, derived from the configured
// network passphrase (truthful, not decorative). The dot is a live signal, so
// it carries the accent plus the sanctioned signal bloom (glow-as-signal).
export function NetworkPill() {
  const label = useMemo(
    () => networkLabel(appConfig().networkPassphrase),
    [],
  );

  return (
    <span className="hidden items-center gap-2 rounded-pill border border-white/20 px-3 py-1.5 text-[13px] uppercase tracking-[0.12em] text-smoke sm:inline-flex">
      <span className="glow-signal-dot h-1.5 w-1.5 animate-pulse rounded-pill bg-amber" />
      {label}
    </span>
  );
}
