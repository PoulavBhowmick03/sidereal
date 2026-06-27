// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import { WAD } from "@sidereal/sdk";
import { amountError, formatTokenAmount, parseTokenAmount } from "@/lib/format";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { useMarket } from "@/lib/useMarket";
import { PositionCard } from "@/components/PositionCard";
import { AmountField } from "@/components/AmountField";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";

export default function MintPage() {
  const { cfg, client, address, phase, submit, submitSequence } = useSidereal();

  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState(true);
  const market = useMarket();
  const position = usePosition(address, phase.kind === "done" ? phase.hash : 0);

  // Preview the deposit and split using the contract's own math:
  //   SY minted on deposit  = amount * WAD / rate   (SY wrapper)
  //   PT/YT face on split   = SY * rate / WAD        (tokenizer, asset units)
  // PT and YT are each minted at the asset-unit face, which is ~the underlying
  // deposited (so 11 USDC -> ~11 PT and ~11 YT, not the SY-share count).
  const preview = useMemo(() => {
    if (!amount || market === null) return null;
    try {
      const amountBase = parseTokenAmount(amount, cfg.decimals);
      const syOut = (amountBase * WAD) / market.exchangeRate;
      const splitOut = (syOut * market.exchangeRate) / WAD;
      return { syOut, splitOut };
    } catch {
      return null;
    }
  }, [amount, market, cfg.decimals]);

  const amtError = amountError(amount, cfg.decimals);
  const canSubmit = address !== null && preview !== null && !amtError && phase.kind !== "working";

  async function onSubmit() {
    if (!address || preview === null) return;
    const underlyingAmount = parseTokenAmount(amount, cfg.decimals);
    if (!split) {
      await submit(() => client.buildDeposit({ marketId: cfg.marketId, from: address, underlyingAmount }));
      return;
    }
    // Soroban allows one host-function op per transaction, so deposit and split
    // are two signatures. Split exactly the SY this deposit mints; the split
    // builds only after the deposit confirms (submitSequence enforces order).
    const syMinted = preview.syOut;
    await submitSequence([
      {
        label: "Deposit",
        build: () => client.buildDeposit({ marketId: cfg.marketId, from: address, underlyingAmount }),
      },
      {
        label: "Split",
        build: () => client.buildSplit({ from: address, syAmount: syMinted }),
      },
    ]);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Mint</h1>
        <p className="text-neutral-600">
          Deposit USDC to receive SY, and optionally split it into equal amounts of PT and YT.
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="card space-y-4 p-5">
        <AmountField
          label="Amount (USDC)"
          value={amount}
          onChange={setAmount}
          decimals={cfg.decimals}
          error={amtError}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
            className="accent-neutral-900"
          />
          <span className="text-neutral-600">Split into PT + YT</span>
        </label>

        {preview ? (
          <div className="panel-subtle p-3 text-sm">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">You will receive</div>
            {split ? (
              <p className="tabular-nums">
                ~{formatTokenAmount(preview.splitOut, cfg.decimals)} PT and{" "}
                ~{formatTokenAmount(preview.splitOut, cfg.decimals)} YT
              </p>
            ) : (
              <p className="tabular-nums">~{formatTokenAmount(preview.syOut, cfg.decimals)} SY</p>
            )}
          </div>
        ) : market === null ? (
          <p className="text-xs text-neutral-500">
            Market not deployed yet. Connect a wallet and enter an amount to preview once it is live.
          </p>
        ) : null}

        <SubmitButton
          phase={phase}
          address={address}
          disabled={!canSubmit}
          onClick={onSubmit}
          connectLabel="Connect wallet to mint"
          idleLabel={split ? "Deposit, then split (2 signatures)" : "Deposit"}
        />

        <TxStatus phase={phase} context="sy" />
      </div>
    </div>
  );
}
