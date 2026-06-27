// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useMemo } from "react";
import type { TransactionEnvelope } from "@sidereal/sdk";
import { appConfig } from "./config";
import { makeClient } from "./sdk";
import { useWallet } from "./wallet";
import { useTxFlow } from "./tx";

/**
 * One hook for the boilerplate every action page shares: the public app config,
 * an SDK client, the connected wallet, and a `submit` runner that wires the
 * build -> sign -> submit lifecycle (lib/tx). A page only supplies the build
 * step; signing and submission are filled in here, keeping mint/trade/redeem DRY.
 */
export function useSidereal() {
  const cfg = useMemo(() => appConfig(), []);
  const { address, signTransaction } = useWallet();
  const client = useMemo(
    () => makeClient(cfg, address ?? cfg.simulationSourceAccount),
    [cfg, address],
  );
  const { phase, run, runSequence } = useTxFlow();

  const submit = useCallback(
    (build: () => Promise<TransactionEnvelope>) =>
      run({ build, sign: signTransaction, submit: (signed) => client.submit(signed) }),
    [run, signTransaction, client],
  );

  /**
   * Submits an ordered list of build steps as separate signed transactions
   * (one signature each). A later step builds only after the prior one has
   * confirmed, so it can depend on that on-chain state. Used for deposit ->
   * split, which cannot share a single Soroban transaction.
   */
  const submitSequence = useCallback(
    (steps: { label: string; build: () => Promise<TransactionEnvelope> }[]) =>
      runSequence(
        steps.map((s) => ({
          label: s.label,
          build: s.build,
          sign: signTransaction,
          submit: (signed: string) => client.submit(signed),
        })),
      ),
    [runSequence, signTransaction, client],
  );

  return { cfg, client, address, phase, submit, submitSequence };
}
