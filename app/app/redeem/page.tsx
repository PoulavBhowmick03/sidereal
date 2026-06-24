// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketState } from "@sidereal/sdk";
import { appConfig } from "../../lib/config";
import { makeClient, getMarketSafe } from "../../lib/sdk";
import { amountError, formatTokenAmount, parseTokenAmount } from "../../lib/format";
import { useWallet } from "../../lib/wallet";
import { useTxFlow } from "../../lib/tx";
import { describeError } from "../../lib/errors";
import { usePosition } from "../../lib/usePosition";
import { PositionCard } from "../../components/PositionCard";

export default function RedeemPage() {
  const cfg = useMemo(() => appConfig(), []);
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { address, signTransaction } = useWallet();
  const { phase, run } = useTxFlow();

  const [amount, setAmount] = useState("");
  const [market, setMarket] = useState<MarketState | null>(null);
  const position = usePosition(address, phase.kind === "done" ? phase.hash : 0);

  useEffect(() => {
    getMarketSafe(cfg).then(setMarket).catch(() => setMarket(null));
  }, [cfg]);

  const matured = market !== null && market.secondsToMaturity === 0;

  // Pre-maturity recombine needs equal PT and YT, so the max is the smaller of
  // the two. After maturity, only PT is redeemed.
  const maxRedeemable = position
    ? matured
      ? position.ptBalance
      : position.ptBalance < position.ytBalance
        ? position.ptBalance
        : position.ytBalance
    : 0n;

  async function onSubmit() {
    if (!address) return;
    const amt = parseTokenAmount(amount, cfg.decimals);
    await run({
      build: () => client.buildRedeem({ marketId: cfg.marketId, from: address, amount: amt }),
      sign: signTransaction,
      submit: (signed) => client.submit(signed),
    });
  }

  const amtError = amountError(amount, cfg.decimals, position ? maxRedeemable : undefined);
  const canSubmit = address !== null && amount !== "" && !amtError && phase.kind !== "working";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Redeem</h1>
        <p className="text-slate-300">
          {matured
            ? "Maturity reached. Redeem PT 1:1 for the underlying."
            : "Before maturity, recombine equal amounts of PT and YT back into SY at any time."}
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <label className="block text-sm">
          <span className="flex items-center justify-between text-slate-300">
            <span>{matured ? "PT to redeem" : "PT + YT to recombine"}</span>
            {maxRedeemable > 0n ? (
              <button
                type="button"
                onClick={() => setAmount(formatTokenAmount(maxRedeemable, cfg.decimals))}
                className="text-xs text-accent hover:underline"
              >
                Max {formatTokenAmount(maxRedeemable, cfg.decimals)}
              </button>
            ) : null}
          </span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink px-3 py-2 text-lg tabular-nums outline-none focus:border-accent"
          />
        </label>

        {amtError ? <p className="text-xs text-red-400">{amtError}</p> : null}

        <p className="text-xs text-slate-400">
          {matured
            ? "You will receive the equivalent SY, redeemable for the underlying."
            : "Recombine burns equal PT and YT and returns SY. Both balances must cover the amount."}
        </p>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-ink disabled:opacity-50"
        >
          {address === null
            ? "Connect wallet to redeem"
            : phase.kind === "working"
              ? `${phase.step}...`
              : matured
                ? "Redeem PT"
                : "Recombine to SY"}
        </button>

        {phase.kind === "done" ? (
          <p className="text-sm text-emerald-400">
            Confirmed. Tx <span className="font-mono">{phase.hash.slice(0, 10)}...</span>
          </p>
        ) : null}
        {phase.kind === "error" ? (
          <p className="text-sm text-red-400">{describeError(phase.error, "tokenizer")}</p>
        ) : null}
      </div>
    </div>
  );
}
