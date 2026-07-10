// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { blendRateToBps } from "@sidereal/sdk";
import { appConfig, networkLabel } from "@/lib/config";
import { readTokenBalance } from "@/lib/sdk";
import { useWallet } from "@/lib/wallet";
import { WalletButton } from "@/components/WalletButton";
import { usePosition } from "@/lib/usePosition";
import { useBlendPosition } from "@/lib/useBlendPosition";
import { useBlendRates } from "@/lib/useBlendRates";
import { bpsToPercent, formatTokenAmount } from "@/lib/format";

const REFRESH_MS = 15_000;

type StepState = "todo" | "done";

function StepChip({ state }: { state: StepState }) {
  return (
    <span
      className={`rounded-pill border px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] ${
        state === "done"
          ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-300"
          : "border-white/15 text-smoke"
      }`}
    >
      {state === "done" ? "Done" : "Waiting"}
    </span>
  );
}

/**
 * Wallet-signed Blend onboarding. Each step is verified live against the
 * configured network, so the checklist ticks itself as the viewer completes the
 * flow.
 */
export function BlendWalkthrough() {
  const cfg = useMemo(() => appConfig(), []);
  const { address } = useWallet();
  const isTestnet = cfg.network === "testnet";
  const networkName = networkLabel(cfg.networkPassphrase, "lower");

  // Reads refresh on a slow tick so the checklist advances while the viewer
  // works through the external steps (faucet, Blend app) in other tabs.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const blendPosition = useBlendPosition(address, tick);
  const rates = useBlendRates();
  const position = usePosition(address, tick);

  const reserve = cfg.yieldSource.reserveAddress;
  useEffect(() => {
    if (!address || !reserve) {
      setUsdcBalance(null);
      return;
    }
    let cancelled = false;
    readTokenBalance(reserve, address, cfg, address)
      .then((b) => !cancelled && setUsdcBalance(b))
      .catch(() => !cancelled && setUsdcBalance(null));
    return () => {
      cancelled = true;
    };
  }, [address, reserve, cfg, tick]);

  if (cfg.yieldSource.kind !== "blend") return null;

  const tokenized =
    position !== null && position.ptBalance > 0n && position.ytBalance > 0n;
  const supplied = (blendPosition?.underlyingValue ?? 0n) > 0n;
  const funded = (usdcBalance ?? 0n) > 0n;

  // Later signals imply earlier steps: after supplying, the wallet USDC may be
  // spent; after tokenizing, the Blend position is drained by design.
  const steps: {
    title: string;
    state: StepState;
    detail: string;
    live: string;
    action: React.ReactNode;
  }[] = [
    {
      title: "Connect a wallet",
      state: address ? "done" : "todo",
      detail:
        `Freighter, xBull, or Lobstr on Stellar ${networkName}. The walkthrough tracks this wallet's balances live.`,
      live: address ? `Connected: ${address.slice(0, 4)}...${address.slice(-4)}` : "Not connected",
      action: address ? null : <WalletButton />,
    },
    {
      title: isTestnet ? "Get Blend testnet USDC" : "Bring Circle USDC",
      state: funded || supplied || tokenized ? "done" : "todo",
      detail: isTestnet
        ? "Use Get test USDC on the mint page: one wallet signature adds the Blend reserve trustline and funds that exact asset. USDC on another issuer will not appear in this market."
        : "Fund the connected wallet with the configured Circle USDC reserve asset before supplying it on Blend. Sidereal only reads that exact asset for this market.",
      live:
        usdcBalance !== null
          ? `Wallet USDC: ${formatTokenAmount(usdcBalance, cfg.decimals)}`
          : `Expected: ${cfg.yieldSource.reserveAsset || cfg.yieldSource.reserveAddress}`,
      action: isTestnet ? (
        <Link href="/mint" className="inline-flex rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink">
          Get test USDC
        </Link>
      ) : null,
    },
    {
      title: "Supply USDC on Blend",
      state: supplied || tokenized ? "done" : "todo",
      detail: isTestnet
        ? "Lend the USDC in the Blend testnet app to become a real Blend yield holder. The protocol detects the position within seconds."
        : "Supply the USDC in the live Blend app to become a real Blend yield holder. The protocol detects the position within seconds.",
      live: supplied
        ? `Detected: ${formatTokenAmount(blendPosition!.underlyingValue, cfg.decimals)} USDC${
            rates ? ` earning ${bpsToPercent(blendRateToBps(rates.supplyApr))}` : ""
          }`
        : "No Blend deposit detected",
      action: (
        <a href={cfg.blendAppUrl || cfg.yieldSource.docsUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink">
          {isTestnet ? "Open Blend testnet" : "Open Blend"}
        </a>
      ),
    },
    {
      title: "Tokenize on the mint page",
      state: tokenized ? "done" : "todo",
      detail:
        "The mint page shows the detected deposit with a guided three-signature flow: withdraw from Blend, deposit into SY, split into PT and YT.",
      live: tokenized
        ? `Tokenized: ${formatTokenAmount(position!.ptBalance, cfg.decimals)} PT + ${formatTokenAmount(position!.ytBalance, cfg.decimals)} YT`
        : "No PT/YT held yet",
      action: (
        <Link href="/mint" className="inline-flex rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink">
          Go to mint
        </Link>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.state === "done").length;

  return (
    <section className="panel-subtle p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-data">Manual walkthrough: tokenize a real Blend deposit</p>
          <p className="mt-2 max-w-2xl text-sm text-smoke">
            Browser wallet signing stays manual. Each step verifies itself against the configured
            network as you complete it.
          </p>
        </div>
        <span className="font-mono text-sm tabular-nums text-paper">
          {doneCount}/{steps.length}
        </span>
      </div>

      <ol className="mt-5 grid gap-4 lg:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.title} className="border border-white/10 bg-carbon p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-paper">
                <span className="mr-2 font-mono text-ash">{index + 1}</span>
                <span>{step.title}</span>
              </p>
              <StepChip state={step.state} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-smoke">{step.detail}</p>
            <p className="mt-2 font-mono text-[12px] tabular-nums text-ash">{step.live}</p>
            {step.action ? <div className="mt-3">{step.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
