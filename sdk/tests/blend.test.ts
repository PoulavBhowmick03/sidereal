// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  BLEND_SCALAR_7,
  BLEND_SCALAR_12,
  blendAssetsFromBTokens,
  blendBorrowApr,
  blendRates,
  blendRateToBps,
  blendSupplyApr,
  blendUtilization,
  decodeBlendReserve,
  type BlendReserve,
} from "../src/blend.js";

// A rate curve with target utilization 70%, matching the live testnet USDC
// reserve's shape: r_base 0.05%, r_one 3%, r_two 10%, r_three 100%.
const CURVE = {
  util: 7_000_000n,
  rBase: 5_000n,
  rOne: 300_000n,
  rTwo: 1_000_000n,
  rThree: 10_000_000n,
};

describe("blendUtilization", () => {
  it("is zero when nothing is borrowed", () => {
    expect(blendUtilization(0n, 1_000_0000000n)).toBe(0n);
  });

  it("caps at 100% when borrows reach supply", () => {
    expect(blendUtilization(5n, 5n)).toBe(BLEND_SCALAR_7);
    expect(blendUtilization(6n, 5n)).toBe(BLEND_SCALAR_7);
  });

  it("rounds up like the contract's fixed_div_ceil", () => {
    // 1/3 in 7 decimals is 3333333.33..., the contract ceils to 3333334.
    expect(blendUtilization(1n, 3n)).toBe(3_333_334n);
  });
});

describe("blendBorrowApr", () => {
  it("charges r_base * ir_mod at zero utilization", () => {
    expect(blendBorrowApr(CURVE, 0n, BLEND_SCALAR_7)).toBe(CURVE.rBase);
  });

  it("reaches r_base + r_one at the target utilization (first slope)", () => {
    expect(blendBorrowApr(CURVE, CURVE.util, BLEND_SCALAR_7)).toBe(
      CURVE.rBase + CURVE.rOne,
    );
  });

  it("reaches r_base + r_one + r_two at the 95% breakpoint (second slope)", () => {
    expect(blendBorrowApr(CURVE, 9_500_000n, BLEND_SCALAR_7)).toBe(
      CURVE.rBase + CURVE.rOne + CURVE.rTwo,
    );
  });

  it("adds the un-modified r_three slope above 95% (third slope)", () => {
    // At 100% utilization: full r_three on top of the ir_mod-scaled intersection.
    const irMod = 5_000_000n; // 0.5
    const intersection = ((CURVE.rBase + CURVE.rOne + CURVE.rTwo) * irMod) / BLEND_SCALAR_7;
    expect(blendBorrowApr(CURVE, BLEND_SCALAR_7, irMod)).toBe(
      CURVE.rThree + intersection,
    );
  });

  it("scales the first two slopes by ir_mod", () => {
    const full = blendBorrowApr(CURVE, CURVE.util, BLEND_SCALAR_7);
    const halved = blendBorrowApr(CURVE, CURVE.util, BLEND_SCALAR_7 / 2n);
    expect(halved).toBe(full / 2n);
  });
});

describe("blendSupplyApr", () => {
  it("scales the borrow rate by utilization and the backstop take", () => {
    // 10% borrow APR, 50% utilization, 10% backstop take => 4.5% supply APR.
    expect(blendSupplyApr(1_000_000n, 5_000_000n, 1_000_000n)).toBe(450_000n);
  });

  it("is zero when nothing is borrowed", () => {
    expect(blendSupplyApr(1_000_000n, 0n, 1_000_000n)).toBe(0n);
  });
});

describe("blendRates on live testnet data", () => {
  // Regression fixture read from the live Blend v2 testnet pool
  // CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF (USDC reserve,
  // get_reserve + get_config, 2026-07-01). ir_mod sits at its 0.1 lower bound.
  const reserve: BlendReserve = {
    asset: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
    config: { index: 3, decimals: 7, maxUtil: 9_500_000n, ...CURVE },
    data: {
      bRate: 1_055_792_546_636n,
      bSupply: 918_962_949_296n,
      dRate: 1_069_016_199_234n,
      dSupply: 353_662_869_121n,
      irMod: 1_000_000n,
      lastTime: 1_782_948_325n,
    },
  };
  const bstopRate = 1_000_000n; // pool get_config bstop_rate, 10%

  it("reproduces the hand-computed snapshot", () => {
    const rates = blendRates(reserve, bstopRate);
    expect(rates.totalSupplied).toBe(970_234_232_501n); // ~97,023 USDC
    expect(rates.totalBorrowed).toBe(378_071_336_157n); // ~37,807 USDC
    expect(rates.utilization).toBe(3_896_702n); // ~38.97%
    expect(rates.borrowApr).toBe(17_201n); // ~0.17% APR
    expect(rates.supplyApr).toBe(6_031n); // ~0.06% APR
  });

  it("converts to basis points for display", () => {
    expect(blendRateToBps(6_031n)).toBe(6n);
    expect(blendRateToBps(BLEND_SCALAR_7)).toBe(10_000n);
  });
});

describe("decodeBlendReserve", () => {
  it("maps the scValToNative shape to typed camelCase fields", () => {
    const decoded = decodeBlendReserve({
      asset: "C_ASSET",
      config: {
        index: 3,
        decimals: 7,
        util: 7_000_000,
        max_util: 9_500_000,
        r_base: 5_000,
        r_one: 300_000,
        r_two: 1_000_000,
        r_three: 10_000_000,
      },
      data: {
        b_rate: 1_055_792_546_636n,
        b_supply: 918_962_949_296n,
        d_rate: 1_069_016_199_234n,
        d_supply: 353_662_869_121n,
        ir_mod: 1_000_000n,
        last_time: 1_782_948_325n,
      },
    });

    expect(decoded.asset).toBe("C_ASSET");
    expect(decoded.config.util).toBe(7_000_000n);
    expect(decoded.config.rThree).toBe(10_000_000n);
    expect(decoded.data.bRate).toBe(1_055_792_546_636n);
    expect(decoded.data.irMod).toBe(1_000_000n);
  });
});

describe("blendAssetsFromBTokens", () => {
  it("floors like the contract's to_asset_from_b_token", () => {
    expect(blendAssetsFromBTokens(100_0000000n, BLEND_SCALAR_12)).toBe(100_0000000n);
    expect(blendAssetsFromBTokens(100_0000000n, 1_100_000_000_000n)).toBe(110_0000000n);
    expect(blendAssetsFromBTokens(1n, 1_999_999_999_999n)).toBe(1n);
  });
});
