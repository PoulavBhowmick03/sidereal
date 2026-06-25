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
  const { cfg, client, address, phase, submit } = useSidereal();

  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState(true);
  const market = useMarket();
  const position = usePosition(address, phase.kind === "done" ? phase.hash : 0);

  // Preview SY out using the same formula the SY wrapper uses on deposit:
  // shares = amount * WAD / exchangeRate. PT and YT each equal the SY split.
  const preview = useMemo(() => {
    if (!amount || market === null) return null;
    try {
      const amountBase = parseTokenAmount(amount, cfg.decimals);
      const syOut = (amountBase * WAD) / market.exchangeRate;
      return { syOut, splitOut: syOut };
    } catch {
      return null;
    }
  }, [amount, market, cfg.decimals]);

  const amtError = amountError(amount, cfg.decimals);
  const canSubmit = address !== null && preview !== null && !amtError && phase.kind !== "working";

  async function onSubmit() {
    if (!address) return;
    const underlyingAmount = parseTokenAmount(amount, cfg.decimals);
    await submit(() =>
      client.buildMint({ marketId: cfg.marketId, from: address, underlyingAmount, split }),
    );
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
          idleLabel={split ? "Deposit and split" : "Deposit"}
        />

        <TxStatus phase={phase} context="sy" />
      </div>
    </div>
  );
}
