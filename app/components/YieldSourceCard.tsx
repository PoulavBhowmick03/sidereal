// SPDX-License-Identifier: Apache-2.0

import { blendRateToBps, type BlendRates, type MarketState } from "@sidereal/sdk";
import type { YieldSourceConfig } from "@/lib/config";
import { bpsToPercent, formatTokenAmount, shortAddress } from "@/lib/format";
import { LiveValue } from "@/components/LiveValue";

function sourceStatus(source: YieldSourceConfig): { label: string; body: string; tone: "live" | "idle" } {
  if (source.kind === "blend") {
    return {
      label: "Real yield source",
      body: "Deposits are supplied into Blend. SY exchange rate is derived from the wrapper's Blend position.",
      tone: "live",
    };
  }
  if (source.kind === "circle") {
    return {
      label: "No external yield",
      body: "This market wraps Circle USDC directly. Tokenization works, but yield is not sourced from another protocol.",
      tone: "idle",
    };
  }
  return {
    label: "Simulated rate",
    body: "This market uses the mock rate path. It is useful for contract flows, not real protocol yield.",
    tone: "idle",
  };
}

export function YieldSourceCard({
  source,
  market,
  rates,
}: {
  source: YieldSourceConfig;
  market: MarketState | null;
  /** Live Blend reserve rates; omit or null while loading / for other kinds. */
  rates?: BlendRates | null;
}) {
  const status = sourceStatus(source);
  const pool = source.poolAddress || "n/a";
  const reserve = source.reserveAddress || market?.underlying || "n/a";

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-data">Yield source</p>
          <h2 className="mt-2 text-lg font-semibold text-paper">{source.name}</h2>
        </div>
        <span
          className={`rounded-pill border px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] ${
            status.tone === "live"
              ? "border-amber/30 bg-amber/10 text-amber"
              : "border-white/15 text-smoke"
          }`}
        >
          {status.label}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-smoke">{status.body}</p>

      <dl className="space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="label-data">SY rate</dt>
          <dd className="tabular-nums text-paper">
            {market ? `1 SY = ${formatTokenAmount(market.exchangeRate, 18, 6)} underlying` : "n/a"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="label-data">Underlying</dt>
          <dd className="tabular-nums text-paper" title={market?.underlying ?? reserve}>
            {shortAddress(market?.underlying ?? reserve)}
          </dd>
        </div>
        {source.kind === "blend" ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Supply APR (variable)</dt>
              <dd className="tabular-nums text-amber">
                <LiveValue
                  value={rates ? bpsToPercent(blendRateToBps(rates.supplyApr)) : ""}
                  loading={!rates}
                  className="w-12"
                />
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Pool utilization</dt>
              <dd className="tabular-nums text-paper">
                <LiveValue
                  value={rates ? bpsToPercent(blendRateToBps(rates.utilization)) : ""}
                  loading={!rates}
                  className="w-12"
                />
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Blend pool</dt>
              <dd className="tabular-nums text-paper" title={pool}>
                {shortAddress(pool)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Reserve asset</dt>
              <dd className="tabular-nums text-paper" title={reserve}>
                {shortAddress(reserve)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {source.docsUrl ? (
        <a
          href={source.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
        >
          Source docs
        </a>
      ) : null}
    </div>
  );
}
