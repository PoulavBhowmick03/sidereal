// SPDX-License-Identifier: Apache-2.0

"use client";

import { formatTokenAmount } from "../lib/format";

/**
 * Labelled decimal amount input with an optional Max shortcut and an inline
 * error. Shared by the mint, trade, and redeem forms. `max` (base units), when
 * given and positive, renders a Max button that fills in the formatted balance.
 */
export function AmountField({
  label,
  value,
  onChange,
  decimals,
  error,
  max,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  decimals: number;
  error?: string | null;
  max?: bigint;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className="label-data">{label}</span>
        {max !== undefined && max > 0n ? (
          <button
            type="button"
            onClick={() => onChange(formatTokenAmount(max, decimals))}
            className="rounded-pill border border-white/20 px-2.5 py-1 text-[13px] uppercase tracking-[0.1em] text-smoke transition hover:border-paper hover:text-paper"
          >
            Max {formatTokenAmount(max, decimals)}
          </button>
        ) : null}
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.0"
        className="field"
      />
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </label>
  );
}
