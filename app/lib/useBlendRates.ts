// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { BlendRates } from "@sidereal/sdk";
import { appConfig } from "./config";
import { makeClient } from "./sdk";

/**
 * Reads the configured Blend reserve's live rate curve once on mount. Returns
 * null while loading, for non-Blend yield sources, and on an RPC error, so the
 * yield-source card can render a placeholder instead of crashing. Mirrors
 * useMarket's cancellation pattern.
 */
export function useBlendRates(): BlendRates | null {
  const [rates, setRates] = useState<BlendRates | null>(null);

  useEffect(() => {
    const cfg = appConfig();
    const { kind, poolAddress, reserveAddress } = cfg.yieldSource;
    if (kind !== "blend" || !poolAddress || !reserveAddress) return;

    let cancelled = false;
    makeClient(cfg)
      .getBlendRates(poolAddress, reserveAddress)
      .then((r) => !cancelled && setRates(r))
      .catch(() => !cancelled && setRates(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return rates;
}
