// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { Asset, Quote } from "@sidereal/sdk";
import { amountError, bpsToPercent, formatTokenAmount, parseTokenAmount } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { PositionCard } from "@/components/PositionCard";
import { AmountField } from "@/components/AmountField";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";

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
  const { cfg, client, address, phase, submit } = useSidereal();

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

  const amtError = amountError(amount, cfg.decimals, position ? balanceIn : undefined);
  const canSubmit = address !== null && quote !== null && !amtError && phase.kind !== "working";

  async function onSubmit() {
    if (!address || !quote) return;
    const amountIn = parseTokenAmount(amount, cfg.decimals);
    const minAmountOut = applySlippage(quote.amountOut);
    await submit(() =>
      client.buildSwap({
        marketId: cfg.marketId,
        from: address,
        assetIn: direction.assetIn,
        assetOut: direction.assetOut,
        amountIn,
        minAmountOut,
      }),
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Trade</h1>
        <p className="text-neutral-600">
          Swap between PT, YT, and SY through the time-decay AMM. Quotes show expected output,
          price impact, and the implied APY so you can see if you are buying at a premium or
          discount.
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDirectionId(d.id)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                d.id === directionId
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-black/15 text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {direction.assetIn === "YT" || direction.assetOut === "YT" ? (
          <p className="panel-subtle px-3 py-2 text-xs text-neutral-600">
            YT routes flash through the pool and depend on cross-contract
            settlement that is not live on chain yet. Quotes are indicative; the
            swap may not settle. PT and SY swaps are complete.
          </p>
        ) : null}

        <AmountField
          label={`Amount in (${direction.assetIn})`}
          value={amount}
          onChange={setAmount}
          decimals={cfg.decimals}
          error={amtError}
          max={balanceIn}
        />

        {quote ? (
          <dl className="panel-subtle space-y-1 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Expected out ({direction.assetOut})</dt>
              <dd className="tabular-nums">{formatTokenAmount(quote.amountOut, cfg.decimals)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Price impact</dt>
              <dd className="tabular-nums">{bpsToPercent(quote.priceImpactBps)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Implied APY (TWAP)</dt>
              <dd className="tabular-nums">{bpsToPercent(quote.impliedApyBps)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Min received (0.5% slippage)</dt>
              <dd className="tabular-nums">{formatTokenAmount(applySlippage(quote.amountOut), cfg.decimals)}</dd>
            </div>
          </dl>
        ) : quoteError ? (
          <p className="text-xs text-neutral-500">Quote unavailable: {describeError(quoteError, "amm")}</p>
        ) : null}

        <SubmitButton
          phase={phase}
          address={address}
          disabled={!canSubmit}
          onClick={onSubmit}
          connectLabel="Connect wallet to trade"
          idleLabel={direction.label}
        />

        <TxStatus phase={phase} context="amm" />
      </div>
    </div>
  );
}
