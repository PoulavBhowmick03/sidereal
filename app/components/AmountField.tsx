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
    <label className="block text-sm">
      <span className="flex items-center justify-between text-neutral-600">
        <span>{label}</span>
        {max !== undefined && max > 0n ? (
          <button
            type="button"
            onClick={() => onChange(formatTokenAmount(max, decimals))}
            className="text-xs text-neutral-900 hover:underline"
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
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </label>
  );
}
