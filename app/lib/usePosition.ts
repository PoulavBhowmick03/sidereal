// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { Position } from "@sidereal/sdk";
import { appConfig } from "./config";
import { makeClient } from "./sdk";

/**
 * Fetches the connected holder's position. Pass a changing `refreshKey` (for
 * example the latest tx hash) to refetch after a confirmed action. Returns null
 * when disconnected or when the market is not deployed.
 */
export function usePosition(address: string | null, refreshKey: unknown = 0): Position | null {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!address) {
      setPosition(null);
      return;
    }
    let cancelled = false;
    const cfg = appConfig();
    makeClient(cfg)
      .getPosition(address, cfg.marketId)
      .then((p) => !cancelled && setPosition(p))
      .catch(() => !cancelled && setPosition(null));
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  return position;
}
