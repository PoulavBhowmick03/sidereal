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
  const label =
    address === null ? connectLabel : phase.kind === "working" ? `${phase.step}...` : idleLabel;

  return (
    <button type="button" disabled={disabled} onClick={onClick} className="btn-solid">
      {label}
    </button>
  );
}
