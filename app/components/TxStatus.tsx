// SPDX-License-Identifier: Apache-2.0

"use client";

import { describeError, type ErrorContext } from "../lib/errors";
import type { TxPhase } from "../lib/tx";

/**
 * Renders the confirmed/error tail of an action form from the tx phase. The
 * `context` selects the right per-contract error messages (lib/errors).
 */
export function TxStatus({ phase, context }: { phase: TxPhase; context: ErrorContext }) {
  if (phase.kind === "done") {
    return (
      <p className="text-sm font-medium text-paper">
        Confirmed. Tx <span className="font-mono text-smoke">{phase.hash.slice(0, 10)}...</span>
      </p>
    );
  }
  if (phase.kind === "error") {
    return <p className="text-sm text-red-400">{describeError(phase.error, context)}</p>;
  }
  return null;
}
