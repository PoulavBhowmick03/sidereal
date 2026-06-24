// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  marketMethodFor,
  quoteMethodFor,
  priceImpactBps,
  secondsToMaturity,
  BPS_DENOMINATOR,
  type Asset,
} from "../src/index.js";

describe("marketMethodFor", () => {
  it("maps each valid route to its frozen Market method", () => {
    expect(marketMethodFor("PT", "SY")).toBe("swap_pt_for_sy");
    expect(marketMethodFor("SY", "PT")).toBe("swap_sy_for_pt");
    expect(marketMethodFor("SY", "YT")).toBe("swap_sy_for_yt");
    expect(marketMethodFor("YT", "SY")).toBe("swap_yt_for_sy");
  });

  it("rejects same-asset swaps", () => {
    expect(() => marketMethodFor("SY", "SY")).toThrow(/unsupported swap route/);
  });

  it("rejects routes the single PT/SY pool does not expose", () => {
    // PT<->YT direct and SY-less combinations are not valid against the pool.
    const invalid: [Asset, Asset][] = [
      ["PT", "YT"],
      ["YT", "PT"],
      ["PT", "PT"],
      ["YT", "YT"],
    ];
    for (const [a, b] of invalid) {
      expect(() => marketMethodFor(a, b)).toThrow(/unsupported swap route/);
    }
  });
});

describe("quoteMethodFor", () => {
  it("maps each valid route to its read-only quote accessor", () => {
    expect(quoteMethodFor("PT", "SY")).toBe("quote_pt_for_sy");
    expect(quoteMethodFor("SY", "PT")).toBe("quote_sy_for_pt");
    expect(quoteMethodFor("SY", "YT")).toBe("quote_sy_for_yt");
    expect(quoteMethodFor("YT", "SY")).toBe("quote_yt_for_sy");
  });

  it("rejects routes the pool does not expose", () => {
    const invalid: [Asset, Asset][] = [
      ["PT", "YT"],
      ["YT", "PT"],
      ["SY", "SY"],
    ];
    for (const [a, b] of invalid) {
      expect(() => quoteMethodFor(a, b)).toThrow(/unsupported swap route/);
    }
  });
});

describe("priceImpactBps", () => {
  it("is zero when output equals input notional", () => {
    expect(priceImpactBps(1000n, 1000n, BPS_DENOMINATOR)).toBe(0n);
  });

  it("is positive when the trader receives less than they put in", () => {
    // 1% worse: out is 99% of in -> 100 bps.
    expect(priceImpactBps(10_000n, 9_900n, BPS_DENOMINATOR)).toBe(100n);
  });

  it("is negative when the trader receives more (discounted PT buying)", () => {
    expect(priceImpactBps(10_000n, 10_100n, BPS_DENOMINATOR)).toBe(-100n);
  });

  it("throws on non-positive input to avoid divide-by-zero", () => {
    expect(() => priceImpactBps(0n, 0n, BPS_DENOMINATOR)).toThrow(/positive/);
    expect(() => priceImpactBps(-5n, 1n, BPS_DENOMINATOR)).toThrow(/positive/);
  });
});

describe("secondsToMaturity", () => {
  it("returns remaining seconds before maturity", () => {
    expect(secondsToMaturity(1_000, 400)).toBe(600);
  });

  it("clamps to zero at and after maturity", () => {
    expect(secondsToMaturity(1_000, 1_000)).toBe(0);
    expect(secondsToMaturity(1_000, 5_000)).toBe(0);
  });
});
