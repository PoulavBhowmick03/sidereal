// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { MarketState } from "@sidereal/sdk";
import { getMarketSafe } from "./sdk";

/**
 * Reads market state once on mount, tracking whether the fetch has settled.
 * `market` is null while loading, when the market is not deployed, or on an
 * RPC error; `loading` distinguishes the first case so pages can show a
 * skeleton instead of an "n/a" that only becomes truthful once settled.
 * Mirrors usePosition's cancellation pattern.
 */
export function useMarketStatus(refreshKey: unknown = 0): {
  market: MarketState | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ market: MarketState | null; loading: boolean }>({
    market: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    getMarketSafe()
      .then((m) => !cancelled && setState({ market: m, loading: false }))
      .catch(() => !cancelled && setState({ market: null, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}

/** Market state only, for pages that do not need the loading flag. */
export function useMarket(refreshKey: unknown = 0): MarketState | null {
  return useMarketStatus(refreshKey).market;
}
