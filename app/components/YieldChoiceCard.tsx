// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import type { BlendRates, MarketState } from "@sidereal/sdk";
import { fixedRateDisplay, variableRateDisplay, type YieldChoiceTone } from "@/lib/yieldChoice";

function toneClass(tone: YieldChoiceTone): string {
  if (tone === "live") return "border-amber/30 bg-amber/10 text-amber";
  if (tone === "warning") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
  return "border-white/15 bg-white/[0.03] text-smoke";
}

export function YieldChoiceCard({
  market,
  rates,
  decimals,
  fixedHref = "/mint",
  fixedCtaLabel = "Tokenize into PT",
}: {
  market: MarketState | null;
  rates: BlendRates | null;
  decimals: number;
  fixedHref?: string;
  fixedCtaLabel?: string;
}) {
  const fixed = fixedRateDisplay(market, decimals);
  const variable = variableRateDisplay(rates);

  return (
    <div className="card space-y-5 p-6">
      <div>
        <p className="label-data">Choose your yield exposure</p>
        <h2 className="mt-2 text-lg font-semibold text-paper">Fixed PT or variable YT</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel-subtle flex min-h-48 flex-col justify-between gap-5 p-5">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-paper">Lock a fixed rate with PT</h3>
              <span className={`rounded-pill border px-2 py-0.5 text-[13px] ${toneClass(fixed.tone)}`}>
                {fixed.value}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-smoke">
              Tokenize USDC into PT and YT, then sell the YT. The PT discount is
              the fixed yield you keep to maturity.
            </p>
            <p className="text-xs leading-relaxed text-ash">{fixed.detail}</p>
          </div>
          <Link
            href={fixedHref}
            className="inline-flex text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
          >
            {fixedCtaLabel}
          </Link>
        </section>

        <section className="panel-subtle flex min-h-48 flex-col justify-between gap-5 p-5">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-paper">Stay variable or buy YT</h3>
              <span className={`rounded-pill border px-2 py-0.5 text-[13px] ${toneClass(variable.tone)}`}>
                {variable.value}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-smoke">
              Keep the YT to receive future yield, or buy more YT if you want
              leveraged exposure to Blend supply rates.
            </p>
            <p className="text-xs leading-relaxed text-ash">{variable.detail}</p>
          </div>
          <Link
            href="/trade#buy-yt"
            className="inline-flex text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
          >
            Buy YT
          </Link>
        </section>
      </div>
    </div>
  );
}
