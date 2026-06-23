// SPDX-License-Identifier: Apache-2.0

import type { Asset, BPS_DENOMINATOR } from "./types.js";

/** The four swap entry points on the frozen Market trait. */
export type MarketMethod =
  | "swap_pt_for_sy"
  | "swap_sy_for_pt"
  | "swap_sy_for_yt"
  | "swap_yt_for_sy";

/**
 * Maps an (assetIn, assetOut) pair to the frozen Market trait method.
 *
 * The PT/SY pool only exposes these four routes; YT trades flash-route through
 * it (AGENTS.md section 3). SY<->SY, PT<->YT direct, and same-asset swaps are
 * not valid and throw.
 */
export function marketMethodFor(assetIn: Asset, assetOut: Asset): MarketMethod {
  const route = `${assetIn}->${assetOut}`;
  switch (route) {
    case "PT->SY":
      return "swap_pt_for_sy";
    case "SY->PT":
      return "swap_sy_for_pt";
    case "SY->YT":
      return "swap_sy_for_yt";
    case "YT->SY":
      return "swap_yt_for_sy";
    default:
      throw new Error(`unsupported swap route: ${route}`);
  }
}

/**
 * Price impact in basis points: how much worse the realized rate is than a
 * 1:1 reference, positive meaning the trader gives up value. Returned as an
 * integer bigint in bps. `amountIn` must be > 0.
 */
export function priceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  bpsDenominator: typeof BPS_DENOMINATOR,
): bigint {
  if (amountIn <= 0n) {
    throw new Error("amountIn must be positive to compute price impact");
  }
  return ((amountIn - amountOut) * bpsDenominator) / amountIn;
}

/** Seconds remaining until maturity, clamped at zero once matured. */
export function secondsToMaturity(maturity: number, nowSec: number): number {
  return Math.max(0, maturity - nowSec);
}
