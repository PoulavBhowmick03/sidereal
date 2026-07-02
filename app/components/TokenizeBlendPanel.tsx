// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  blendRateToBps,
  type BlendPosition,
  type BlendRates,
  type MarketState,
  type Quote,
  type StellarYT,
} from "@sidereal/sdk";
import type { AppConfig } from "@/lib/config";
import type { TxPhase } from "@/lib/tx";
import { bpsToPercent, formatTokenAmount } from "@/lib/format";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "@/lib/slippage";
import {
  buildTokenizeBlendSteps,
  estimateBlendTokenizationFace,
  type TokenizeBlendMode,
} from "@/lib/tokenizeSteps";
import { SubmitButton } from "@/components/SubmitButton";
import { YieldChoiceCard } from "@/components/YieldChoiceCard";

const TOKENIZE_MODES = [
  { id: "keep", label: "Keep PT + YT" },
  { id: "fixed", label: "Lock fixed rate" },
] as const;

/**
 * Guided migration of an existing Blend deposit into the market. Blend
 * bTokens are not transferable, so the position moves as three ordered
 * signatures: withdraw from Blend, deposit the USDC into SY (the wrapper
 * supplies it straight back into the same pool), split the SY into PT and YT.
 * Renders nothing when there is no detected position.
 */
export function TokenizeBlendPanel({
  cfg,
  client,
  address,
  market,
  position,
  rates,
  phase,
  submitSequence,
}: {
  cfg: AppConfig;
  client: StellarYT;
  address: string | null;
  market: MarketState | null;
  position: BlendPosition | null;
  rates: BlendRates | null;
  phase: TxPhase;
  submitSequence: (
    steps: { label: string; build: () => Promise<{ xdr: string; networkPassphrase: string }> }[],
  ) => Promise<unknown>;
}) {
  const source = cfg.yieldSource;
  const [mode, setMode] = useState<TokenizeBlendMode>("keep");
  const [saleQuote, setSaleQuote] = useState<Quote | null>(null);
  const [saleQuoteUnavailable, setSaleQuoteUnavailable] = useState(false);
  const estimated = useMemo(
    () => estimateBlendTokenizationFace(market, position),
    [market, position],
  );
  const isEligible =
    source.kind === "blend" &&
    market !== null &&
    position !== null &&
    position.underlyingValue > 0n;
  const ytSaleFailed = phase.kind === "error" && phase.step === "Sell YT";

  useEffect(() => {
    if (mode !== "fixed" || market === null || estimated.faceAmount <= 0n) {
      setSaleQuote(null);
      setSaleQuoteUnavailable(false);
      return;
    }

    let cancelled = false;
    setSaleQuote(null);
    setSaleQuoteUnavailable(false);
    client
      .quoteSwap({
        marketId: cfg.marketId,
        from: address ?? cfg.simulationSourceAccount,
        assetIn: "YT",
        assetOut: "SY",
        amountIn: estimated.faceAmount,
        minAmountOut: 0n,
      })
      .then((quote) => {
        if (!cancelled) setSaleQuote(quote);
      })
      .catch(() => {
        if (!cancelled) setSaleQuoteUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [address, cfg.marketId, cfg.simulationSourceAccount, client, estimated.faceAmount, market, mode]);

  if (
    !isEligible ||
    market === null ||
    position === null ||
    source.kind !== "blend"
  ) {
    return null;
  }

  async function onTokenize() {
    if (!address || market === null || position === null || source.kind !== "blend") return;
    const steps = await buildTokenizeBlendSteps({
      client,
      marketId: cfg.marketId,
      source,
      address,
      market,
      position,
      mode,
    });
    await submitSequence(steps);
  }

  return (
    <div className="card space-y-5 border-amber/20 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-data">Tokenize your Blend deposit</p>
          <p className="mt-2 text-3xl font-light tabular-nums text-paper">
            {formatTokenAmount(position.underlyingValue, cfg.decimals)}
            <span className="ml-2 text-xl text-graphite">USDC detected in {source.name}</span>
          </p>
        </div>
        <span className="rounded-pill border border-amber/30 bg-amber/10 px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] text-amber">
          {rates ? `earning ${bpsToPercent(blendRateToBps(rates.supplyApr))}` : "variable rate"}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-smoke">
        Move it into the market in one guided flow: withdraw from Blend, deposit into SY
        (the wrapper supplies it straight back into the same pool), then split into PT and
        YT. Choose whether to keep both legs or sell the YT immediately to lock the fixed
        side.
      </p>

      <div className="border-t border-white/10 pt-5">
        <span className="label-data">Tokenization goal</span>
        <div className="mt-3 grid grid-cols-2 gap-px border border-white/10">
          {TOKENIZE_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={mode === option.id}
              className={`px-3 py-2.5 text-[13px] uppercase tracking-[0.08em] transition ${
                mode === option.id ? "bg-white/[0.04] text-amber" : "text-smoke hover:text-paper"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-1 text-xs text-ash">
        <li>
          1. Withdraw {formatTokenAmount(position.underlyingValue, cfg.decimals)} USDC from
          Blend{position.collateralValue > 0n ? " (includes posted collateral)" : ""}
        </li>
        <li>2. Deposit the withdrawn USDC for SY</li>
        <li>3. Split the SY into equal PT and YT</li>
        {mode === "fixed" ? <li>4. Sell the newly minted YT for SY with slippage protection</li> : null}
      </ul>

      <YieldChoiceCard
        market={market}
        rates={rates}
        decimals={cfg.decimals}
        fixedHref="#mint-form"
        fixedCtaLabel="Use this panel"
      />

      <div className="panel-subtle space-y-2 p-4 text-sm">
        <p className="label-data">Receipt preview</p>
        <div className="flex justify-between gap-4">
          <span className="text-ash">PT kept to maturity</span>
          <span className="tabular-nums text-paper">
            ~{formatTokenAmount(estimated.faceAmount, cfg.decimals)} PT
          </span>
        </div>
        {mode === "keep" ? (
          <div className="flex justify-between gap-4">
            <span className="text-ash">YT kept variable</span>
            <span className="tabular-nums text-paper">
              ~{formatTokenAmount(estimated.faceAmount, cfg.decimals)} YT
            </span>
          </div>
        ) : saleQuote ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-ash">YT sold for SY</span>
              <span className="tabular-nums text-paper">
                ~{formatTokenAmount(saleQuote.amountOut, cfg.decimals)} SY
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ash">Minimum SY received</span>
              <span className="tabular-nums text-paper">
                {formatTokenAmount(applySlippage(saleQuote.amountOut, DEFAULT_SLIPPAGE_BPS), cfg.decimals)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-ash">
            {saleQuoteUnavailable
              ? "YT sale quote unavailable. Keep PT + YT, or retry after pool liquidity improves."
              : "Loading the YT sale quote."}
          </p>
        )}
      </div>

      {position.borrowedValue > 0n ? (
        <p className="text-xs leading-relaxed text-ash">
          You have {formatTokenAmount(position.borrowedValue, cfg.decimals)} USDC borrowed
          against this reserve. Blend rejects a collateral withdraw that would leave the
          loan under-collateralized; repay first if the withdraw step fails.
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-ash">
        A Blend withdraw can return less than requested when pool liquidity is tight. The
        deposit step sizes itself from what actually arrives, so the flow never over-commits.
      </p>

      {ytSaleFailed ? (
        <p className="panel-subtle px-4 py-3 text-xs leading-relaxed text-amber">
          The optional YT sale failed after tokenization. Your Blend position is already
          tokenized, so you should now hold PT and YT. Open Trade and choose Sell YT once
          liquidity is available or the quote has settled.
        </p>
      ) : null}

      <SubmitButton
        phase={phase}
        address={address}
        disabled={address === null || phase.kind === "working"}
        onClick={() => void onTokenize()}
        connectLabel="Connect wallet to tokenize"
        idleLabel={
          mode === "fixed"
            ? "Tokenize and lock fixed rate (4 signatures)"
            : "Tokenize full position (3 signatures)"
        }
      />
    </div>
  );
}
