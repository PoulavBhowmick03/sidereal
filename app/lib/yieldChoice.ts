// SPDX-License-Identifier: Apache-2.0

import { blendRateToBps, type BlendRates, type MarketState } from "@sidereal/sdk";
import { bpsToPercent, formatTokenAmount } from "./format";

export type YieldChoiceTone = "live" | "idle" | "warning";

export interface YieldChoiceDisplay {
  value: string;
  detail: string;
  tone: YieldChoiceTone;
}

export function fixedRateDisplay(
  market: Pick<MarketState, "impliedApyBps" | "totalPt" | "totalSy" | "twapWarmingUp"> | null,
  decimals: number,
): YieldChoiceDisplay {
  if (market === null) {
    return {
      value: "Loading",
      detail: "The fixed rate appears once the deployed AMM can be read.",
      tone: "idle",
    };
  }
  if (market.totalPt <= 0n || market.totalSy <= 0n) {
    return {
      value: "No liquidity yet",
      detail: "Seed the PT/SY pool before offering a fixed APY.",
      tone: "warning",
    };
  }
  if (market.twapWarmingUp) {
    return {
      value: "Warming up",
      detail: "The market price is filling its TWAP window before publishing a fixed APY.",
      tone: "warning",
    };
  }
  return {
    value: bpsToPercent(market.impliedApyBps),
    detail: `TWAP implied by ${formatTokenAmount(market.totalSy, decimals, 2)} SY in pool.`,
    tone: "live",
  };
}

export function variableRateDisplay(rates: BlendRates | null): YieldChoiceDisplay {
  if (rates === null) {
    return {
      value: "Loading",
      detail: "Reads the live Blend reserve supply APR.",
      tone: "idle",
    };
  }
  return {
    value: bpsToPercent(blendRateToBps(rates.supplyApr)),
    detail: "Current variable supply APR from the Blend reserve.",
    tone: "live",
  };
}
