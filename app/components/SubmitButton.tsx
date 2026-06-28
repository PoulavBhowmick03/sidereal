// SPDX-License-Identifier: Apache-2.0

"use client";

import type { TxPhase } from "../lib/tx";

/**
 * Full-width action button whose label tracks the wallet and tx state: it
 * prompts to connect when disconnected, shows the in-flight step while working,
 * and otherwise shows the idle label. Shared by every action form.
 */
export function SubmitButton({
  phase,
  address,
  idleLabel,
  connectLabel,
  disabled,
  onClick,
}: {
  phase: TxPhase;
  address: string | null;
  idleLabel: string;
  connectLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const working = address !== null && phase.kind === "working";
  const label =
    address === null ? connectLabel : working ? `${phase.step}...` : idleLabel;

  return (
    <button type="button" disabled={disabled} onClick={onClick} className="btn-solid">
      {working ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-pill border border-ink/40 border-t-ink"
        />
      ) : null}
      {label}
    </button>
  );
}
