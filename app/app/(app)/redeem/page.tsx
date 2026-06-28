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

export default function RedeemPage() {
  const { cfg, client, address, phase, submit } = useSidereal();

  const [amount, setAmount] = useState("");
  const [syAmount, setSyAmount] = useState("");
  const [activeAction, setActiveAction] = useState<"claim" | "redeem" | "unwrap" | null>(null);
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
    setActiveAction("redeem");
    const amt = parseTokenAmount(amount, cfg.decimals);
    await submit(() => client.buildRedeem({ marketId: cfg.marketId, from: address, amount: amt }));
  }

  async function onClaim() {
    if (!address) return;
    setActiveAction("claim");
    await submit(() => client.buildClaimYield({ marketId: cfg.marketId, from: address }));
  }

  async function onUnwrap() {
    if (!address) return;
    setActiveAction("unwrap");
    const amt = parseTokenAmount(syAmount, cfg.decimals);
    await submit(() =>
      client.buildRedeemSy({ marketId: cfg.marketId, from: address, syAmount: amt }),
    );
  }

  const amtError = amountError(amount, cfg.decimals, position ? maxRedeemable : undefined);
  const canSubmit = address !== null && amount !== "" && !amtError && phase.kind !== "working";
  const syError = amountError(
    syAmount,
    cfg.decimals,
    position ? position.syBalance : undefined,
  );
  const canUnwrap =
    address !== null && syAmount !== "" && !syError && phase.kind !== "working";
  const canClaim =
    address !== null &&
    position !== null &&
    position.claimableYield > 0n &&
    phase.kind !== "working";
  const underlyingPreview = useMemo(() => {
    if (!syAmount || market === null) return null;
    try {
      return (parseTokenAmount(syAmount, cfg.decimals) * market.exchangeRate) / WAD;
    } catch {
      return null;
    }
  }, [syAmount, market, cfg.decimals]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Redeem</h1>
        <p className="text-neutral-600">
          {matured
            ? "Maturity reached. Redeem PT for its principal in SY, then unwrap SY to the underlying."
            : "Before maturity, recombine equal amounts of PT and YT back into SY at any time."}
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Claim YT yield</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Claim the accrued yield shown in your position. The payout is received as SY.
          </p>
        </div>
        <SubmitButton
          phase={activeAction === "claim" ? phase : { kind: "idle" }}
          address={address}
          disabled={!canClaim}
          onClick={onClaim}
          connectLabel="Connect wallet to claim"
          idleLabel={
            position && position.claimableYield > 0n
              ? `Claim ${formatTokenAmount(position.claimableYield, cfg.decimals)} SY`
              : "No yield to claim"
          }
        />
        {activeAction === "claim" ? <TxStatus phase={phase} context="tokenizer" /> : null}
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">{matured ? "Redeem PT" : "Recombine PT + YT"}</h2>
        </div>
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
          phase={activeAction === "redeem" ? phase : { kind: "idle" }}
          address={address}
          disabled={!canSubmit}
          onClick={onSubmit}
          connectLabel="Connect wallet to redeem"
          idleLabel={matured ? "Redeem PT" : "Recombine to SY"}
        />

        {activeAction === "redeem" ? <TxStatus phase={phase} context="tokenizer" /> : null}
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Redeem SY to underlying</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Burn SY shares and withdraw their current value from the vault.
          </p>
        </div>

        <AmountField
          label="SY to redeem"
          value={syAmount}
          onChange={setSyAmount}
          decimals={cfg.decimals}
          error={syError}
          max={position?.syBalance ?? 0n}
        />

        {underlyingPreview !== null ? (
          <p className="panel-subtle p-3 text-sm tabular-nums">
            You will receive ~{formatTokenAmount(underlyingPreview, cfg.decimals)} underlying
          </p>
        ) : null}

        <SubmitButton
          phase={activeAction === "unwrap" ? phase : { kind: "idle" }}
          address={address}
          disabled={!canUnwrap}
          onClick={onUnwrap}
          connectLabel="Connect wallet to redeem SY"
          idleLabel="Redeem SY to underlying"
        />

        {activeAction === "unwrap" ? <TxStatus phase={phase} context="sy" /> : null}
      </div>
    </div>
  );
}
