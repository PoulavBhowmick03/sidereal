// SPDX-License-Identifier: Apache-2.0

/**
 * Display formatting helpers. Pure functions so they are unit-testable without
 * a browser or RPC. The protocol speaks in base units (bigint) and basis
 * points; the UI speaks in human decimals and percent.
 */

/** Formats a basis-point value as a percent string, e.g. 860n -> "8.60%". */
export function bpsToPercent(bps: bigint, fractionDigits = 2): string {
  const sign = bps < 0n ? "-" : "";
  const abs = bps < 0n ? -bps : bps;
  const whole = abs / 100n;
  const frac = abs % 100n;
  if (fractionDigits === 0) {
    return `${sign}${whole}%`;
  }
  const fracStr = frac.toString().padStart(2, "0").slice(0, fractionDigits).padEnd(fractionDigits, "0");
  return `${sign}${whole}.${fracStr}%`;
}

/**
 * Formats a token amount given in base units into a decimal string.
 * e.g. (1_234_567n, 6) -> "1.234567". Trailing zeros are trimmed but at least
 * one fractional digit is kept when there is a fractional part.
 */
export function formatTokenAmount(baseUnits: bigint, decimals: number, maxFractionDigits = 6): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;

  let fracStr = frac.toString().padStart(decimals, "0");
  if (maxFractionDigits < decimals) {
    fracStr = fracStr.slice(0, maxFractionDigits);
  }
  fracStr = fracStr.replace(/0+$/, "");

  const sign = negative ? "-" : "";
  return fracStr.length > 0 ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

/** Parses a human decimal string into base units. Throws on malformed input. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid amount: "${value}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(`too many decimals: max ${decimals}`);
  }
  const scaled = `${whole}${frac.padEnd(decimals, "0")}`;
  return BigInt(scaled);
}

/** Whole days between now and a Unix-second maturity, floored at zero. */
export function daysToMaturity(maturitySec: number, nowSec = Math.floor(Date.now() / 1000)): number {
  return Math.max(0, Math.floor((maturitySec - nowSec) / 86_400));
}
