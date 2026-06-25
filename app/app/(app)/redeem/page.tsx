// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { amountError, parseTokenAmount } from "@/lib/format";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { useMarket } from "@/lib/useMarket";
import { PositionCard } from "@/components/PositionCard";
import { AmountField } from "@/components/AmountField";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";

export default function RedeemPage() {
  const { cfg, client, address, phase, submit } = useSidereal();

  const [amount, setAmount] = useState("");
  const market = useMarket();
  const position = usePosition(address, phase.kind === "done" ? phase.hash : 0);

  const matured = market !== null && market.secondsToMaturity === 0;

  // Pre-maturity recombine needs equal PT and YT, so the max is the smaller of
  // the two. After maturity, only PT is redeemed.
  const maxRedeemable = position
    ? matured
      ? position.ptBalance
      : position.ptBalance < position.ytBalance
        ? position.ptBalance
        : position.ytBalance
    : 0n;

  async function onSubmit() {
    if (!address) return;
    const amt = parseTokenAmount(amount, cfg.decimals);
    await submit(() => client.buildRedeem({ marketId: cfg.marketId, from: address, amount: amt }));
  }

  const amtError = amountError(amount, cfg.decimals, position ? maxRedeemable : undefined);
  const canSubmit = address !== null && amount !== "" && !amtError && phase.kind !== "working";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Redeem</h1>
        <p className="text-neutral-600">
          {matured
            ? "Maturity reached. Redeem PT 1:1 for the underlying."
            : "Before maturity, recombine equal amounts of PT and YT back into SY at any time."}
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="card space-y-4 p-5">
        <AmountField
          label={matured ? "PT to redeem" : "PT + YT to recombine"}
          value={amount}
          onChange={setAmount}
          decimals={cfg.decimals}
          error={amtError}
          max={maxRedeemable}
        />

        <p className="text-xs text-neutral-500">
          {matured
            ? "You will receive the equivalent SY, redeemable for the underlying."
            : "Recombine burns equal PT and YT and returns SY. Both balances must cover the amount."}
        </p>

        <SubmitButton
          phase={phase}
          address={address}
          disabled={!canSubmit}
          onClick={onSubmit}
          connectLabel="Connect wallet to redeem"
          idleLabel={matured ? "Redeem PT" : "Recombine to SY"}
        />

        <TxStatus phase={phase} context="tokenizer" />
      </div>
    </div>
  );
}
