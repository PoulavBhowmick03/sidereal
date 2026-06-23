// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import { WAD, type MarketState } from "@sidereal/sdk";
import { appConfig } from "../../lib/config";
import { makeClient, getMarketSafe } from "../../lib/sdk";
import { formatTokenAmount, parseTokenAmount } from "../../lib/format";
import { useWallet } from "../../lib/wallet";
import { useTxFlow } from "../../lib/tx";

export default function MintPage() {
  const cfg = useMemo(() => appConfig(), []);
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { address, signTransaction } = useWallet();
  const { phase, run } = useTxFlow();

  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState(true);
  const [market, setMarket] = useState<MarketState | null>(null);

  useEffect(() => {
    getMarketSafe(cfg).then(setMarket).catch(() => setMarket(null));
  }, [cfg]);

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

  const canSubmit = address !== null && preview !== null && phase.kind !== "working";

  async function onSubmit() {
    if (!address) return;
    const underlyingAmount = parseTokenAmount(amount, cfg.decimals);
    await run({
      build: () => client.buildMint({ marketId: cfg.marketId, from: address, underlyingAmount, split }),
      sign: signTransaction,
      submit: (signed) => client.submit(signed),
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Mint</h1>
        <p className="text-slate-300">
          Deposit USDC to receive SY, and optionally split it into equal amounts of PT and YT.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <label className="block text-sm">
          <span className="text-slate-300">Amount (USDC)</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink px-3 py-2 text-lg tabular-nums outline-none focus:border-accent"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span className="text-slate-300">Split into PT + YT</span>
        </label>

        {preview ? (
          <div className="rounded-lg border border-white/10 bg-ink p-3 text-sm">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">You will receive</div>
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
          <p className="text-xs text-slate-400">
            Market not deployed yet. Connect a wallet and enter an amount to preview once it is live.
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-ink disabled:opacity-50"
        >
          {address === null
            ? "Connect wallet to mint"
            : phase.kind === "working"
              ? `${phase.step}...`
              : split
                ? "Deposit and split"
                : "Deposit"}
        </button>

        {phase.kind === "done" ? (
          <p className="text-sm text-emerald-400">
            Confirmed. Tx <span className="font-mono">{phase.hash.slice(0, 10)}...</span>
          </p>
        ) : null}
        {phase.kind === "error" ? <p className="text-sm text-red-400">{phase.message}</p> : null}
      </div>
    </div>
  );
}
