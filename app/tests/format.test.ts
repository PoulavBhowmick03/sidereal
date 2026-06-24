// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  bpsToPercent,
  formatTokenAmount,
  parseTokenAmount,
  amountError,
  daysToMaturity,
} from "../lib/format";

describe("bpsToPercent", () => {
  it("formats basis points as a percent with two decimals", () => {
    expect(bpsToPercent(860n)).toBe("8.60%");
    expect(bpsToPercent(12_345n)).toBe("123.45%");
    expect(bpsToPercent(8n)).toBe("0.08%");
    expect(bpsToPercent(0n)).toBe("0.00%");
  });

  it("handles negative basis points", () => {
    expect(bpsToPercent(-100n)).toBe("-1.00%");
  });

  it("respects fractionDigits = 0", () => {
    expect(bpsToPercent(860n, 0)).toBe("8%");
  });
});

describe("formatTokenAmount", () => {
  it("scales base units by decimals and trims trailing zeros", () => {
    expect(formatTokenAmount(1_234_567n, 6)).toBe("1.234567");
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatTokenAmount(1_000_000n, 6)).toBe("1");
    expect(formatTokenAmount(0n, 7)).toBe("0");
  });

  it("truncates to maxFractionDigits", () => {
    expect(formatTokenAmount(1_234_567n, 6, 2)).toBe("1.23");
  });

  it("formats negatives", () => {
    expect(formatTokenAmount(-1_500_000n, 6)).toBe("-1.5");
  });
});

describe("parseTokenAmount", () => {
  it("parses a decimal string into base units", () => {
    expect(parseTokenAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseTokenAmount("1", 6)).toBe(1_000_000n);
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
  });

  it("rejects malformed input", () => {
    expect(() => parseTokenAmount("abc", 6)).toThrow(/invalid amount/);
    expect(() => parseTokenAmount("", 6)).toThrow(/invalid amount/);
    expect(() => parseTokenAmount("1.2.3", 6)).toThrow(/invalid amount/);
  });

  it("rejects more decimals than the token supports", () => {
    expect(() => parseTokenAmount("1.2345678", 6)).toThrow(/too many decimals/);
  });

  it("round-trips with formatTokenAmount", () => {
    const base = parseTokenAmount("123.456789", 7);
    expect(formatTokenAmount(base, 7)).toBe("123.456789");
  });
});

describe("amountError", () => {
  it("treats empty input as no error (action stays disabled)", () => {
    expect(amountError("", 7)).toBeNull();
    expect(amountError("   ", 7)).toBeNull();
  });

  it("rejects malformed and non-positive amounts", () => {
    expect(amountError("abc", 7)).toMatch(/invalid amount/);
    expect(amountError("1.23456789", 7)).toMatch(/too many decimals/);
    expect(amountError("0", 7)).toMatch(/greater than zero/);
  });

  it("flags amounts over the available balance", () => {
    const max = 5_0000000n; // 5.0 at 7 decimals
    expect(amountError("5", 7, max)).toBeNull();
    expect(amountError("5.0000001", 7, max)).toMatch(/exceeds your balance/);
  });

  it("ignores the balance check when no max is given", () => {
    expect(amountError("1000000", 7)).toBeNull();
  });
});

describe("daysToMaturity", () => {
  it("returns whole days remaining", () => {
    const now = 1_000_000_000;
    expect(daysToMaturity(now + 10 * 86_400, now)).toBe(10);
    expect(daysToMaturity(now + 86_400 + 3600, now)).toBe(1);
  });

  it("clamps to zero at or after maturity", () => {
    const now = 1_000_000_000;
    expect(daysToMaturity(now, now)).toBe(0);
    expect(daysToMaturity(now - 86_400, now)).toBe(0);
  });
});
