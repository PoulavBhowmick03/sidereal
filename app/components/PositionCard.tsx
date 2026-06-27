// SPDX-License-Identifier: Apache-2.0

"use client";

import type { Position } from "@sidereal/sdk";
import { formatTokenAmount } from "../lib/format";

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-subtle p-3">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Compact view of a holder's SY/PT/YT balances and claimable yield. */
export function PositionCard({
  position,
  decimals,
}: {
  position: Position | null;
  decimals: number;
}) {
  if (!position) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <Cell label="SY" value={formatTokenAmount(position.syBalance, decimals)} />
      <Cell label="PT" value={formatTokenAmount(position.ptBalance, decimals)} />
      <Cell label="YT" value={formatTokenAmount(position.ytBalance, decimals)} />
      <Cell label="Claimable" value={formatTokenAmount(position.claimableYield, decimals)} />
    </dl>
  );
}
