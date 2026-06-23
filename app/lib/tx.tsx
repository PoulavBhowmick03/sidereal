// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useState } from "react";
import type { TransactionEnvelope } from "@sidereal/sdk";

export type TxPhase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; hash: string }
  | { kind: "error"; message: string };

export interface TxSteps {
  build: () => Promise<TransactionEnvelope>;
  sign: (xdr: string) => Promise<string>;
  submit: (signedXdr: string) => Promise<{ hash: string }>;
}

/**
 * Drives the shared build -> sign -> submit lifecycle and exposes a phase the
 * UI can render. Keeps mint/trade/redeem consistent and DRY.
 */
export function useTxFlow() {
  const [phase, setPhase] = useState<TxPhase>({ kind: "idle" });

  const run = useCallback(async (steps: TxSteps) => {
    try {
      setPhase({ kind: "working", step: "Building transaction" });
      const env = await steps.build();
      setPhase({ kind: "working", step: "Awaiting signature" });
      const signed = await steps.sign(env.xdr);
      setPhase({ kind: "working", step: "Submitting" });
      const { hash } = await steps.submit(signed);
      setPhase({ kind: "done", hash });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  return { phase, run };
}
