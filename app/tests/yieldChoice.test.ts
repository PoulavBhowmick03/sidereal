// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fixedRateDisplay, variableRateDisplay } from "../lib/yieldChoice";

describe("fixedRateDisplay", () => {
  it("does not fake a zero rate before the market loads", () => {
    expect(fixedRateDisplay(null, 7)).toMatchObject({
      value: "Loading",
      tone: "idle",
    });
  });

  it("reports unseeded pools as no liquidity", () => {
    expect(
      fixedRateDisplay(
        {
          impliedApyBps: 0n,
          totalPt: 0n,
          totalSy: 0n,
          twapWarmingUp: false,
        },
        7,
      ),
    ).toMatchObject({
      value: "No liquidity yet",
      tone: "warning",
    });
  });

  it("reports TWAP warmup before showing the fixed APY", () => {
    expect(
      fixedRateDisplay(
        {
          impliedApyBps: 720n,
          totalPt: 1_000_000n,
          totalSy: 1_000_000n,
          twapWarmingUp: true,
        },
        7,
      ),
    ).toMatchObject({
      value: "Warming up",
      tone: "warning",
    });
  });

  it("shows the AMM implied APY once liquidity and TWAP are ready", () => {
    expect(
      fixedRateDisplay(
        {
          impliedApyBps: 720n,
          totalPt: 1_000_000n,
          totalSy: 5_000_000n,
          twapWarmingUp: false,
        },
        7,
      ),
    ).toMatchObject({
      value: "7.20%",
      detail: "TWAP implied by 0.5 SY in pool.",
      tone: "live",
    });
  });
});

describe("variableRateDisplay", () => {
  it("waits for Blend rates", () => {
    expect(variableRateDisplay(null)).toMatchObject({
      value: "Loading",
      tone: "idle",
    });
  });
});
