// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import type { Asset, Quote } from "@sidereal/sdk";
import { appConfig } from "../../lib/config";
import { makeClient } from "../../lib/sdk";
import { bpsToPercent, formatTokenAmount, parseTokenAmount } from "../../lib/format";
import { useWallet } from "../../lib/wallet";
import { useTxFlow } from "../../lib/tx";
import { describeError } from "../../lib/errors";
import { usePosition } from "../../lib/usePosition";
import { PositionCard } from "../../components/PositionCard";

// Only the four routes the single PT/SY pool exposes (YT via flash route).
const DIRECTIONS = [
  { id: "buy-pt", label: "Buy PT", assetIn: "SY", assetOut: "PT" },
  { id: "sell-pt", label: "Sell PT", assetIn: "PT", assetOut: "SY" },
  { id: "buy-yt", label: "Buy YT", assetIn: "SY", assetOut: "YT" },
  { id: "sell-yt", label: "Sell YT", assetIn: "YT", assetOut: "SY" },
] as const satisfies ReadonlyArray<{ id: string; label: string; assetIn: Asset; assetOut: Asset }>;

const SLIPPAGE_BPS = 50n; // 0.5% default tolerance.

function applySlippage(amountOut: bigint): bigint {
  return (amountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
}

export default function TradePage() {
  const cfg = useMemo(() => appConfig(), []);
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { address, signTransaction } = useWallet();
  const { phase, run } = useTxFlow();

  const [directionId, setDirectionId] = useState<(typeof DIRECTIONS)[number]["id"]>("buy-pt");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);

  const direction = DIRECTIONS.find((d) => d.id === directionId) ?? DIRECTIONS[0];
  const position = usePosition(address, phase.kind === "done" ? phase.hash : 0);

  const balanceIn = position
    ? direction.assetIn === "SY"
      ? position.syBalance
      : direction.assetIn === "PT"
        ? position.ptBalance
        : position.ytBalance
    : 0n;

  // Debounced live quote whenever the route or amount changes.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!amount || !address) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const amountIn = parseTokenAmount(amount, cfg.decimals);
        const q = await client.quoteSwap({
          marketId: cfg.marketId,
          from: address,
          assetIn: direction.assetIn,
          assetOut: direction.assetOut,
          amountIn,
          minAmountOut: 0n,
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) setQuoteError(err);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [amount, address, direction.assetIn, direction.assetOut, cfg, client]);

  const canSubmit = address !== null && quote !== null && phase.kind !== "working";

  async function onSubmit() {
    if (!address || !quote) return;
    const amountIn = parseTokenAmount(amount, cfg.decimals);
    const minAmountOut = applySlippage(quote.amountOut);
    await run({
      build: () =>
        client.buildSwap({
          marketId: cfg.marketId,
          from: address,
          assetIn: direction.assetIn,
          assetOut: direction.assetOut,
          amountIn,
          minAmountOut,
        }),
      sign: signTransaction,
      submit: (signed) => client.submit(signed),
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Trade</h1>
        <p className="text-slate-300">
          Swap between PT, YT, and SY through the time-decay AMM. Quotes show expected output,
          price impact, and the implied APY so you can see if you are buying at a premium or
          discount.
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDirectionId(d.id)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                d.id === directionId
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-white/15 text-slate-300"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <label className="block text-sm">
          <span className="flex items-center justify-between text-slate-300">
            <span>Amount in ({direction.assetIn})</span>
            {balanceIn > 0n ? (
              <button
                type="button"
                onClick={() => setAmount(formatTokenAmount(balanceIn, cfg.decimals))}
                className="text-xs text-accent hover:underline"
              >
                Max {formatTokenAmount(balanceIn, cfg.decimals)}
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

        {quote ? (
          <dl className="space-y-1 rounded-lg border border-white/10 bg-ink p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">Expected out ({direction.assetOut})</dt>
              <dd className="tabular-nums">{formatTokenAmount(quote.amountOut, cfg.decimals)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Price impact</dt>
              <dd className="tabular-nums">{bpsToPercent(quote.priceImpactBps)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Implied APY (TWAP)</dt>
              <dd className="tabular-nums">{bpsToPercent(quote.impliedApyBps)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Min received (0.5% slippage)</dt>
              <dd className="tabular-nums">{formatTokenAmount(applySlippage(quote.amountOut), cfg.decimals)}</dd>
            </div>
          </dl>
        ) : quoteError ? (
          <p className="text-xs text-amber-400">Quote unavailable: {describeError(quoteError, "amm")}</p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-ink disabled:opacity-50"
        >
          {address === null
            ? "Connect wallet to trade"
            : phase.kind === "working"
              ? `${phase.step}...`
              : direction.label}
        </button>

        {phase.kind === "done" ? (
          <p className="text-sm text-emerald-400">
            Confirmed. Tx <span className="font-mono">{phase.hash.slice(0, 10)}...</span>
          </p>
        ) : null}
        {phase.kind === "error" ? (
          <p className="text-sm text-red-400">{describeError(phase.error, "amm")}</p>
        ) : null}
      </div>
    </div>
  );
}
