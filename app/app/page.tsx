// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { appConfig } from "../lib/config";
import { getMarketSafe } from "../lib/sdk";
import { bpsToPercent, daysToMaturity, formatTokenAmount } from "../lib/format";

// Pool stats are read at request time from the AMM via the SDK.
export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

export default async function HomePage() {
  const cfg = appConfig();
  const market = await getMarketSafe(cfg);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Fix or trade your Stellar yield.</h1>
        <p className="text-slate-300">
          Sidereal splits a yield-bearing asset into a Principal Token that redeems 1:1 at
          maturity and a Yield Token that streams the yield until then. Lock in a fixed rate by
          holding PT, or take a view on yield by holding YT. Everything trades through one
          time-decay AMM, priced by an internal TWAP rather than an external oracle.
        </p>
        <div className="flex gap-3 text-sm">
          <Link href="/mint" className="rounded-lg bg-accent px-4 py-2 font-medium text-ink">
            Mint
          </Link>
          <Link href="/trade" className="rounded-lg border border-white/15 px-4 py-2">
            Trade
          </Link>
          <a
            href="https://github.com/PoulavBhowmick03/sidereal"
            className="rounded-lg border border-white/15 px-4 py-2"
          >
            Docs
          </a>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Pool stats
        </h2>
        {market === null ? (
          <p className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">
            Market not deployed to testnet yet. Stats appear here once contract addresses are
            configured.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="SY in pool"
              value={formatTokenAmount(market.totalSy, cfg.decimals)}
              sub={`PT in pool: ${formatTokenAmount(market.totalPt, cfg.decimals)}`}
            />
            <Stat
              label="Implied APY (TWAP)"
              value={bpsToPercent(market.impliedApyBps)}
              sub={
                market.twapWarmingUp
                  ? "TWAP still stabilizing"
                  : `Spot: ${bpsToPercent(market.spotApyBps)}`
              }
            />
            <Stat label="Days to maturity" value={String(daysToMaturity(market.maturity))} />
          </div>
        )}
      </section>
    </div>
  );
}
