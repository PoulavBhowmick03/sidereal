// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  WAD,
  blendRateToBps,
  type BlendPosition,
  type BlendRates,
  type MarketState,
  type StellarYT,
} from "@sidereal/sdk";
import type { AppConfig } from "@/lib/config";
import type { TxPhase } from "@/lib/tx";
import { bpsToPercent, formatTokenAmount } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";

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
  if (
    source.kind !== "blend" ||
    market === null ||
    position === null ||
    position.underlyingValue <= 0n
  ) {
    return null;
  }

  async function onTokenize() {
    if (!address || market === null || position === null) return;
    const migrateTarget = position.underlyingValue;
    let depositAmount = 0n;

    await submitSequence([
      {
        label: "Withdraw from Blend",
        build: () =>
          client.buildBlendWithdraw({
            from: address,
            pool: source.poolAddress,
            asset: source.reserveAddress,
            // One stroop above each bucket's valuation: the pool ceil-converts
            // the request to bTokens and clamps to the balance, so this drains
            // the bucket completely instead of leaving rounding dust.
            supplyAmount: position.supplyValue > 0n ? position.supplyValue + 1n : 0n,
            collateralAmount: position.collateralValue > 0n ? position.collateralValue + 1n : 0n,
          }),
      },
      {
        label: "Deposit",
        build: async () => {
          // A Blend withdraw can return less than requested (rounding, or a
          // liquidity-capped pool), so size the deposit from what actually
          // arrived instead of the request.
          const balance = await client.getTokenBalance(market.underlying, address);
          depositAmount = balance < migrateTarget ? balance : migrateTarget;
          return client.buildDeposit({
            marketId: cfg.marketId,
            from: address,
            underlyingAmount: depositAmount,
          });
        },
      },
      {
        label: "Split",
        build: async () => {
          // Split exactly the SY this deposit minted, clamped to the real
          // balance in case the derived rate moved between preview and now.
          const computed = (depositAmount * WAD) / market.exchangeRate;
          const held = await client.getPosition(address, cfg.marketId);
          const syAmount = held.syBalance < computed ? held.syBalance : computed;
          return client.buildSplit({ from: address, syAmount });
        },
      },
    ]);
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
        (the wrapper supplies it straight back into the same pool, so it keeps earning the
        same rate), then split into PT and YT. Three signatures, one after another.
      </p>

      <ul className="space-y-1 text-xs text-ash">
        <li>
          1. Withdraw {formatTokenAmount(position.underlyingValue, cfg.decimals)} USDC from
          Blend{position.collateralValue > 0n ? " (includes posted collateral)" : ""}
        </li>
        <li>2. Deposit the withdrawn USDC for SY</li>
        <li>3. Split the SY into equal PT and YT</li>
      </ul>

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

      <SubmitButton
        phase={phase}
        address={address}
        disabled={address === null || phase.kind === "working"}
        onClick={() => void onTokenize()}
        connectLabel="Connect wallet to tokenize"
        idleLabel="Tokenize full position (3 signatures)"
      />
    </div>
  );
}
