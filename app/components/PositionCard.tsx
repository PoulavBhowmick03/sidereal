// SPDX-License-Identifier: Apache-2.0

"use client";

import type { Position } from "@sidereal/sdk";
import { formatTokenAmount } from "../lib/format";

function Cell({ label, value, signal }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className="border-t border-white/10 px-1 pt-4">
      <dt className="label-data">{label}</dt>
      <dd
        className={`mt-3 text-3xl font-light tabular-nums ${signal ? "text-amber" : "text-paper"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Compact view of a holder's SY/PT/YT balances and claimable yield. Always
 *  rendered, even when disconnected: the bar shows zeroed placeholders so the
 *  app shell reads as a real surface before a wallet connects. The claimable
 *  yield is the one live/risk value, so it carries the amber accent. */
export function PositionCard({
  position,
  decimals,
}: {
  position: Position | null;
  decimals: number;
}) {
  const fmt = (v: bigint) => formatTokenAmount(position ? v : 0n, decimals);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
      <Cell label="SY balance" value={fmt(position?.syBalance ?? 0n)} />
      <Cell label="PT balance" value={fmt(position?.ptBalance ?? 0n)} />
      <Cell label="YT balance" value={fmt(position?.ytBalance ?? 0n)} />
      <Cell label="Claimable yield" value={fmt(position?.claimableYield ?? 0n)} signal />
    </dl>
  );
}
