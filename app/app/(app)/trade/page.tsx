// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { Asset, Quote } from "@sidereal/sdk";
import { amountError, bpsToPercent, formatTokenAmount, parseTokenAmount } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { useMarket } from "@/lib/useMarket";
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

// Selectable slippage tolerance. 0.5% stays the default, matching the prior
// fixed behavior; the chips only change the local min-received guard.
const SLIPPAGE_OPTIONS = [
  { bps: 10n, label: "0.1%" },
  { bps: 50n, label: "0.5%" },
  { bps: 100n, label: "1.0%" },
] as const;
const DEFAULT_SLIPPAGE_BPS = 50n;

// Above this price impact a PT/SY swap is almost certainly draining the pool to
// the point where the AMM rejects it (the implied rate would cross zero and the
// contract reverts with ExchangeRateBelowOne). Block the submit and tell the
// trader to size down rather than letting them sign a transaction that reverts.
const MAX_PRICE_IMPACT_BPS = 2_000n; // 20%

function applySlippage(amountOut: bigint, slippageBps: bigint): bigint {
  return (amountOut * (10_000n - slippageBps)) / 10_000n;
}

export default function TradePage() {
  const { cfg, client, address, phase, submit } = useSidereal();

  const [directionId, setDirectionId] = useState<(typeof DIRECTIONS)[number]["id"]>("buy-pt");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [slippageBps, setSlippageBps] = useState<bigint>(DEFAULT_SLIPPAGE_BPS);

  const direction = DIRECTIONS.find((d) => d.id === directionId) ?? DIRECTIONS[0];
  const market = useMarket();
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
  const priceImpactGuardApplies = direction.assetIn !== "YT" && direction.assetOut !== "YT";
  const priceImpactTooHigh =
    priceImpactGuardApplies && quote !== null && quote.priceImpactBps > MAX_PRICE_IMPACT_BPS;
  const canSubmit =
    address !== null &&
    quote !== null &&
    !amtError &&
    !priceImpactTooHigh &&
    phase.kind !== "working";

  async function onSubmit() {
    if (!address || !quote) return;
    const amountIn = parseTokenAmount(amount, cfg.decimals);
    const minAmountOut = applySlippage(quote.amountOut, slippageBps);
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

  const maturityDate =
    market !== null
      ? new Date(market.maturity * 1000).toLocaleDateString("en-US", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">Trade</h1>
        <p className="max-w-xl text-smoke">
          Swap between PT, YT, and SY through the time-decay AMM. Quotes show expected output,
          price impact, and the implied APY so you can see if you are buying at a premium or
          discount.
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Market status rail: live, read-only signals from the AMM. */}
        <aside className="space-y-5 lg:col-span-4">
          <div className="flex items-center justify-between">
            <p className="label-data">Market status</p>
            <span className="flex items-center gap-2 text-[13px] text-smoke">
              <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-paper" />
              Live feed
            </span>
          </div>
          <dl className="space-y-px">
            <Stat label="Reserves (SY)" value={market ? formatTokenAmount(market.totalSy, cfg.decimals) : "n/a"} />
            <Stat
              label="Implied APY (TWAP)"
              value={market ? bpsToPercent(market.impliedApyBps) : "n/a"}
              signal
            />
            <Stat label="Spot APY" value={market ? bpsToPercent(market.spotApyBps) : "n/a"} />
            <Stat label="Maturity" value={maturityDate ?? "n/a"} />
          </dl>
        </aside>

        {/* Swap form */}
        <div className="space-y-6 lg:col-span-8">
          <div className="card space-y-6 p-8">
            <div className="grid grid-cols-2 gap-px border border-white/10 sm:grid-cols-4">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDirectionId(d.id)}
                  className={`px-3 py-2.5 text-[13px] uppercase tracking-[0.08em] transition ${
                    d.id === directionId
                      ? "bg-white/[0.04] text-amber"
                      : "text-smoke hover:text-paper"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {direction.assetIn === "YT" || direction.assetOut === "YT" ? (
              <p className="panel-subtle px-4 py-3 text-xs text-smoke">
                YT trades flash-route through the pool: in one transaction the AMM
                splits or recombines via the tokenizer, so buying YT is leveraged.
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

            {/* Direction arrow + read-only expected-out, mirroring the swap card. */}
            <div className="flex items-center justify-center">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center border border-white/15 text-smoke"
              >
                ↓
              </span>
            </div>
            <div className="border-t border-white/10 pt-5">
              <span className="label-data">Expected out ({direction.assetOut})</span>
              <p className="mt-2 text-3xl font-light tabular-nums text-paper">
                {quote ? formatTokenAmount(quote.amountOut, cfg.decimals) : "0.0"}
              </p>
            </div>

            {/* Slippage tolerance: 0.5% default, chips swap the local guard. The
                selected chip is a permitted amber location (active signal). */}
            <div className="flex items-center justify-between border-t border-white/10 pt-5">
              <span className="label-data">Slippage tolerance</span>
              <div className="flex gap-px border border-white/10">
                {SLIPPAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSlippageBps(opt.bps)}
                    aria-pressed={slippageBps === opt.bps}
                    className={`px-3 py-1.5 text-[13px] tabular-nums transition ${
                      slippageBps === opt.bps
                        ? "bg-amber/10 text-amber"
                        : "text-smoke hover:text-paper"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {quote ? (
            <dl className="panel-subtle space-y-2 p-5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ash">Expected out ({direction.assetOut})</dt>
                <dd className="tabular-nums text-paper">{formatTokenAmount(quote.amountOut, cfg.decimals)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ash">Price impact</dt>
                <dd className="tabular-nums text-paper">{bpsToPercent(quote.priceImpactBps)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ash">Implied APY (TWAP)</dt>
                <dd className="tabular-nums text-amber">{bpsToPercent(quote.impliedApyBps)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ash">
                  Min received ({SLIPPAGE_OPTIONS.find((o) => o.bps === slippageBps)?.label} slippage)
                </dt>
                <dd className="tabular-nums text-paper">
                  {formatTokenAmount(applySlippage(quote.amountOut, slippageBps), cfg.decimals)}
                </dd>
              </div>
            </dl>
          ) : quoteError ? (
            <p className="text-[13px] text-ash">Quote unavailable: {describeError(quoteError, "amm")}</p>
          ) : null}

          {priceImpactTooHigh ? (
            <p className="panel-subtle px-4 py-3 text-[13px] text-amber">
              Price impact is too high for the current pool depth, so this swap would be rejected
              on-chain. Reduce the amount and try again.
            </p>
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
    </div>
  );
}

function Stat({ label, value, signal }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 py-3">
      <dt className="label-data">{label}</dt>
      <dd className={`text-sm tabular-nums ${signal ? "text-amber" : "text-paper"}`}>{value}</dd>
    </div>
  );
}
