// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { MarketState } from "@sidereal/sdk";
import { getMarketSafe } from "./sdk";

/**
 * Reads market state once on mount. Returns null while loading, when the market
 * is not deployed, or on an RPC error, so pages can render a placeholder rather
 * than crash. Mirrors usePosition's cancellation pattern.
 */
export function useMarket(): MarketState | null {
  const [market, setMarket] = useState<MarketState | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMarketSafe()
      .then((m) => !cancelled && setMarket(m))
      .catch(() => !cancelled && setMarket(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return market;
}
