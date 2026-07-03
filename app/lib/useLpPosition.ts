// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { LpPosition } from "@sidereal/sdk";
import { appConfig } from "./config";
import { makeClient } from "./sdk";

/**
 * Fetches the connected holder's AMM LP position. Pass a changing refresh key
 * after a confirmed add/remove transaction to refetch pool share and value.
 */
export function useLpPosition(address: string | null, refreshKey: unknown = 0): LpPosition | null {
  const [position, setPosition] = useState<LpPosition | null>(null);

  useEffect(() => {
    if (!address) {
      setPosition(null);
      return;
    }
    let cancelled = false;
    const cfg = appConfig();
    makeClient(cfg, address)
      .getLpPosition(address, cfg.marketId)
      .then((p) => !cancelled && setPosition(p))
      .catch(() => !cancelled && setPosition(null));
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  return position;
}
