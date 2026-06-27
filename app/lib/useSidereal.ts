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
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { address, signTransaction } = useWallet();
  const { phase, run } = useTxFlow();

  const submit = useCallback(
    (build: () => Promise<TransactionEnvelope>) =>
      run({ build, sign: signTransaction, submit: (signed) => client.submit(signed) }),
    [run, signTransaction, client],
  );

  return { cfg, client, address, phase, submit };
}
