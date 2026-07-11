// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { BlendPosition } from "@sidereal/sdk";
import { appConfig } from "./config";
import { readBlendPosition } from "./sdk";

/**
 * Reads the connected wallet's existing deposit in the configured Blend
 * reserve. Returns null while loading, when no wallet is connected, for
 * non-Blend yield sources, and on an RPC error. `refreshKey` retriggers the
 * read after a transaction lands, mirroring usePosition.
 */
export function useBlendPosition(
  address: string | null,
  refreshKey: string | number = 0,
): BlendPosition | null {
  const [position, setPosition] = useState<BlendPosition | null>(null);

  useEffect(() => {
    const cfg = appConfig();
    const { kind, poolAddress, reserveAddress } = cfg.yieldSource;
    if (!address || kind !== "blend" || !poolAddress || !reserveAddress) {
      setPosition(null);
      return;
    }

    let cancelled = false;
    readBlendPosition(poolAddress, reserveAddress, address, cfg)
      .then((p) => !cancelled && setPosition(p))
      .catch(() => !cancelled && setPosition(null));
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  return position;
}
