// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useState } from "react";
import type { TransactionEnvelope } from "@sidereal/sdk";

export type TxPhase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; hash: string }
  | { kind: "error"; error: unknown };

export interface TxSteps {
  build: () => Promise<TransactionEnvelope>;
  sign: (xdr: string) => Promise<string>;
  submit: (signedXdr: string) => Promise<{ hash: string }>;
}

/** A named step in a multi-signature sequence (e.g. deposit, then split). */
export interface TxSequenceStep extends TxSteps {
  label: string;
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
      setPhase({ kind: "error", error: err });
    }
  }, []);

  /**
   * Runs several transactions in order, each its own build -> sign -> submit
   * (one wallet signature apiece). A later step's `build` runs only after the
   * previous step has submitted and confirmed, so it can depend on that state
   * (e.g. split builds after the deposit it spends has landed). Used where a
   * single Soroban transaction cannot carry the work: a tx allows one
   * host-function op, so deposit + split must be two signatures.
   */
  const runSequence = useCallback(async (steps: TxSequenceStep[]) => {
    try {
      let hash = "";
      const total = steps.length;
      for (const [i, step] of steps.entries()) {
        const tag = total > 1 ? `${step.label} (${i + 1}/${total})` : step.label;
        setPhase({ kind: "working", step: `${tag}: building` });
        const env = await step.build();
        setPhase({ kind: "working", step: `${tag}: awaiting signature` });
        const signed = await step.sign(env.xdr);
        setPhase({ kind: "working", step: `${tag}: submitting` });
        ({ hash } = await step.submit(signed));
      }
      setPhase({ kind: "done", hash });
    } catch (err) {
      setPhase({ kind: "error", error: err });
    }
  }, []);

  return { phase, run, runSequence };
}
