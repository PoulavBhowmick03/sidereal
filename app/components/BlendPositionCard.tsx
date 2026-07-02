// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { blendRateToBps, type BlendPosition, type BlendRates } from "@sidereal/sdk";
import type { YieldSourceConfig } from "@/lib/config";
import { bpsToPercent, formatTokenAmount } from "@/lib/format";

/**
 * Shows the connected wallet's existing deposit in the market's Blend pool:
 * the yield position a user already holds elsewhere, surfaced here so they can
 * bring it into the protocol. Renders nothing when there is no position, so
 * the page stays quiet for users without one.
 */
export function BlendPositionCard({
  source,
  position,
  rates,
  decimals,
  variant = "full",
}: {
  source: YieldSourceConfig;
  position: BlendPosition | null;
  rates: BlendRates | null;
  decimals: number;
  variant?: "full" | "banner";
}) {
  if (source.kind !== "blend" || position === null || position.underlyingValue <= 0n) {
    return null;
  }

  const variableRate = rates ? bpsToPercent(blendRateToBps(rates.supplyApr)) : "variable rate";
  const fullVariableRate = rates ? variableRate : "a variable rate";

  if (variant === "banner") {
    return (
      <div className="card flex flex-col gap-4 border-amber/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="label-data">Blend position detected</p>
          <p className="mt-1 text-sm leading-relaxed text-smoke">
            <span className="tabular-nums text-paper">
              {formatTokenAmount(position.underlyingValue, decimals)} USDC
            </span>{" "}
            supplied in {source.name}, earning{" "}
            <span className="tabular-nums text-amber">{fullVariableRate}</span>.
          </p>
        </div>
        <Link
          href="/mint"
          className="inline-flex shrink-0 text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
        >
          Tokenize
        </Link>
      </div>
    );
  }

  return (
    <div className="card space-y-4 border-amber/20 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-data">Your position in {source.name}</p>
          <p className="mt-2 text-3xl font-light tabular-nums text-paper">
            {formatTokenAmount(position.underlyingValue, decimals)}
            <span className="ml-2 text-xl text-graphite">USDC</span>
          </p>
        </div>
        <span className="rounded-pill border border-amber/30 bg-amber/10 px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] text-amber">
          Detected
        </span>
      </div>

      <p className="text-sm leading-relaxed text-smoke">
        This deposit is earning{" "}
        <span className="tabular-nums text-amber">{fullVariableRate}</span>{" "}
        in Blend right now. Tokenize it to lock the fixed side with PT, or sell the
        variable side as YT.
      </p>

      {position.borrowedValue > 0n ? (
        <p className="text-xs leading-relaxed text-ash">
          You also have {formatTokenAmount(position.borrowedValue, decimals)} USDC borrowed
          against this reserve. Collateral backing a loan cannot be withdrawn for
          tokenization until the loan is repaid.
        </p>
      ) : null}

      <Link
        href="/mint"
        className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
      >
        Tokenize this position →
      </Link>
    </div>
  );
}
