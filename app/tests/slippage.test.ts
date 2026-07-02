// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "../lib/slippage";

describe("applySlippage", () => {
  it("applies the default 0.5 percent guard", () => {
    expect(applySlippage(1_000_000n, DEFAULT_SLIPPAGE_BPS)).toBe(995_000n);
  });

  it("floors fractional base units", () => {
    expect(applySlippage(101n, 50n)).toBe(100n);
  });

  it("rejects invalid bps", () => {
    expect(() => applySlippage(1_000n, -1n)).toThrow(/between 0 and 10000/);
    expect(() => applySlippage(1_000n, 10_001n)).toThrow(/between 0 and 10000/);
  });
});
