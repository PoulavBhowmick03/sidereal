// SPDX-License-Identifier: Apache-2.0

export default function TradePage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Trade</h1>
      <p className="text-slate-300">
        Swap between PT, YT, and SY through the time-decay AMM. Every quote shows expected output,
        price impact, and the implied APY in basis points alongside the underlying APY, so you can
        see whether you are buying at a premium or a discount.
      </p>
      <p className="text-sm text-slate-400">Swap form and live quotes land in the next iteration.</p>
    </div>
  );
}
