// SPDX-License-Identifier: Apache-2.0

export const SLIPPAGE_OPTIONS = [
  { bps: 10n, label: "0.1%" },
  { bps: 50n, label: "0.5%" },
  { bps: 100n, label: "1.0%" },
] as const;

export const DEFAULT_SLIPPAGE_BPS = 50n;

export function applySlippage(amountOut: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps > 10_000n) {
    throw new Error("slippage bps must be between 0 and 10000");
  }
  return (amountOut * (10_000n - slippageBps)) / 10_000n;
}
