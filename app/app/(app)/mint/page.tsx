// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import { WAD } from "@sidereal/sdk";
import { amountError, daysToMaturity, formatTokenAmount, parseTokenAmount } from "@/lib/format";
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

  const maturityDate =
    market !== null
      ? new Date(market.maturity * 1000).toLocaleDateString("en-US", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">Mint</h1>
        <p className="max-w-xl text-smoke">
          Deposit USDC to receive SY, and optionally split it into equal amounts of PT and YT.
        </p>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Deposit form */}
        <div className="space-y-6 lg:col-span-7">
          <div className="card space-y-6 p-8">
            <AmountField
              label="Amount (USDC)"
              value={amount}
              onChange={setAmount}
              decimals={cfg.decimals}
              error={amtError}
            />

            <label className="flex cursor-pointer items-center justify-between border-t border-white/10 pt-5">
              <span className="text-sm text-paper">Split into PT + YT</span>
              <span className="relative inline-flex">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => setSplit(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="h-6 w-11 rounded-pill bg-white/15 transition peer-checked:bg-amber" />
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-pill bg-paper transition peer-checked:translate-x-5 peer-checked:bg-ink" />
              </span>
            </label>
          </div>

          {preview ? (
            <div className="panel-subtle space-y-3 p-5 text-sm">
              <div className="label-data">Receipt preview</div>
              <div className="flex justify-between">
                <span className="text-ash">You will receive (approx.)</span>
                <span className="tabular-nums text-paper">
                  ~{formatTokenAmount(preview.syOut, cfg.decimals)} SY
                </span>
              </div>
              {split ? (
                <>
                  <div className="flex justify-between border-t border-white/10 pt-3">
                    <span className="text-ash">↳ Split into PT</span>
                    <span className="tabular-nums text-paper">
                      {formatTokenAmount(preview.splitOut, cfg.decimals)} PT
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ash">↳ Split into YT</span>
                    <span className="tabular-nums text-paper">
                      {formatTokenAmount(preview.splitOut, cfg.decimals)} YT
                    </span>
                  </div>
                </>
              ) : null}
              {market !== null ? (
                <div className="flex justify-between border-t border-white/10 pt-3">
                  <span className="text-ash">Exchange rate</span>
                  <span className="tabular-nums text-paper">
                    1 SY = {formatTokenAmount(market.exchangeRate, 18, 4)} USDC
                  </span>
                </div>
              ) : null}
            </div>
          ) : market === null ? (
            <p className="text-xs text-ash">
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

        {/* Protocol parameters: real maturity data plus the token legend. */}
        <aside className="space-y-8 lg:col-span-5">
          <p className="label-data">Protocol parameters</p>

          <div className="card space-y-2 p-6">
            <p className="label-data">Maturity date</p>
            {maturityDate !== null ? (
              <>
                <p className="text-xl tabular-nums text-paper">{maturityDate}</p>
                <p className="text-sm tabular-nums text-amber">
                  {daysToMaturity(market!.maturity)} days remaining
                </p>
              </>
            ) : (
              <p className="text-sm text-ash">Not deployed yet</p>
            )}
          </div>

          <div className="card space-y-5 p-6">
            <p className="label-data">Token definitions</p>
            <dl className="space-y-4">
              {[
                {
                  name: "SY (Standardized Yield)",
                  tag: "Wrapped",
                  body: "Yield-bearing version of the underlying asset.",
                },
                {
                  name: "PT (Principal Token)",
                  tag: "Fixed",
                  body: "Redeemable for 1 underlying asset at maturity.",
                },
                {
                  name: "YT (Yield Token)",
                  tag: "Variable",
                  body: "Receives all yield generated by the underlying SY.",
                },
              ].map((d) => (
                <div key={d.name}>
                  <dt className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-paper">{d.name}</span>
                    <span className="rounded-pill border border-white/15 px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] text-smoke">
                      {d.tag}
                    </span>
                  </dt>
                  <dd className="mt-1 text-sm text-smoke">{d.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
