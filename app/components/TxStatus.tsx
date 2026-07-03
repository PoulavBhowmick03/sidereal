// SPDX-License-Identifier: Apache-2.0

"use client";

import { appConfig } from "../lib/config";
import { describeError, type ErrorContext } from "../lib/errors";
import { stellarExpertTxUrl } from "../lib/explorer";
import type { TxPhase } from "../lib/tx";

/**
 * Renders the confirmed/error tail of an action form from the tx phase. The
 * `context` selects the right per-contract error messages (lib/errors).
 */
export function TxStatus({ phase, context }: { phase: TxPhase; context: ErrorContext }) {
  if (phase.kind === "done") {
    const href = stellarExpertTxUrl(phase.hash, appConfig().networkPassphrase);
    return (
      <p className="text-sm font-medium text-paper">
        Confirmed. Tx{" "}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-smoke underline decoration-white/30 underline-offset-4 transition hover:text-paper"
        >
          {phase.hash.slice(0, 10)}...
        </a>
      </p>
    );
  }
  if (phase.kind === "error") {
    return <p className="text-sm text-red-400">{describeError(phase.error, context)}</p>;
  }
  return null;
}
