// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketState, Position } from "@sidereal/sdk";
import { appConfig } from "../../lib/config";
import { makeClient, getMarketSafe } from "../../lib/sdk";
import { formatTokenAmount, parseTokenAmount } from "../../lib/format";
import { useWallet } from "../../lib/wallet";
import { useTxFlow } from "../../lib/tx";
import { describeError } from "../../lib/errors";

export default function RedeemPage() {
  const cfg = useMemo(() => appConfig(), []);
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { address, signTransaction } = useWallet();
  const { phase, run } = useTxFlow();

  const [amount, setAmount] = useState("");
  const [market, setMarket] = useState<MarketState | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    getMarketSafe(cfg).then(setMarket).catch(() => setMarket(null));
  }, [cfg]);

  useEffect(() => {
    if (!address) {
      setPosition(null);
      return;
    }
    let cancelled = false;
    client
      .getPosition(address, cfg.marketId)
      .then((p) => !cancelled && setPosition(p))
      .catch(() => !cancelled && setPosition(null));
    return () => {
      cancelled = true;
    };
  }, [address, client, cfg.marketId]);

  const matured = market !== null && market.secondsToMaturity === 0;

  async function onSubmit() {
    if (!address) return;
    const amt = parseTokenAmount(amount, cfg.decimals);
    await run({
      build: () => client.buildRedeem({ marketId: cfg.marketId, from: address, amount: amt }),
      sign: signTransaction,
      submit: (signed) => client.submit(signed),
    });
  }

  const canSubmit = address !== null && amount !== "" && phase.kind !== "working";

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

      {position ? (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-panel p-3">
            <dt className="text-xs uppercase text-slate-400">PT</dt>
            <dd className="tabular-nums">{formatTokenAmount(position.ptBalance, cfg.decimals)}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-panel p-3">
            <dt className="text-xs uppercase text-slate-400">YT</dt>
            <dd className="tabular-nums">{formatTokenAmount(position.ytBalance, cfg.decimals)}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-panel p-3">
            <dt className="text-xs uppercase text-slate-400">Claimable yield</dt>
            <dd className="tabular-nums">{formatTokenAmount(position.claimableYield, cfg.decimals)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <label className="block text-sm">
          <span className="text-slate-300">
            {matured ? "PT to redeem" : "PT + YT to recombine"}
          </span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink px-3 py-2 text-lg tabular-nums outline-none focus:border-accent"
          />
        </label>

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
