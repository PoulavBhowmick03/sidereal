// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  amountError,
  bpsToPercent,
  formatMaturityDate,
  formatTokenAmount,
  maturityStatus,
  parseTokenAmount,
} from "@/lib/format";
import { previewAddLiquidity, previewRemoveLiquidity } from "@/lib/lpPreview";
import { applySlippage, DEFAULT_SLIPPAGE_BPS, SLIPPAGE_OPTIONS } from "@/lib/slippage";
import { useBlendRates } from "@/lib/useBlendRates";
import { useLpPosition } from "@/lib/useLpPosition";
import { useMarketStatus } from "@/lib/useMarket";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { AmountField } from "@/components/AmountField";
import { MaturityBadge } from "@/components/MaturityBadge";
import { PositionCard } from "@/components/PositionCard";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";
import { YieldSourceCard } from "@/components/YieldSourceCard";
import { LiveValue } from "@/components/LiveValue";

const idlePhase = { kind: "idle" } as const;

export default function PoolPage() {
  const { cfg, client, address, phase, submit } = useSidereal();
  const [ptAmount, setPtAmount] = useState("");
  const [syAmount, setSyAmount] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [activeAction, setActiveAction] = useState<"add" | "remove" | null>(null);
  // One slippage setting for both LP actions, reusing the swap page's helper and
  // options rather than inventing a second slippage system.
  const [slippageBps, setSlippageBps] = useState<bigint>(DEFAULT_SLIPPAGE_BPS);

  const refreshKey = phase.kind === "done" ? phase.hash : 0;
  const { market, loading: marketLoading } = useMarketStatus(refreshKey);
  const blendRates = useBlendRates();
  const position = usePosition(address, refreshKey);
  const lpPosition = useLpPosition(address, refreshKey);
  const matured = market !== null && market.secondsToMaturity === 0;
  const poolSeeded = market !== null && market.totalLp > 0n && market.totalPt > 0n && market.totalSy > 0n;

  const addPreview = useMemo(() => {
    if (market === null || ptAmount === "" || syAmount === "") return null;
    try {
      return previewAddLiquidity({
        ptIn: parseTokenAmount(ptAmount, cfg.decimals),
        syIn: parseTokenAmount(syAmount, cfg.decimals),
        totalPt: market.totalPt,
        totalSy: market.totalSy,
        totalLp: market.totalLp,
      });
    } catch {
      return null;
    }
  }, [cfg.decimals, market, ptAmount, syAmount]);

  const removePreview = useMemo(() => {
    if (market === null || lpAmount === "") return null;
    try {
      return previewRemoveLiquidity({
        lpIn: parseTokenAmount(lpAmount, cfg.decimals),
        totalPt: market.totalPt,
        totalSy: market.totalSy,
        totalLp: market.totalLp,
      });
    } catch {
      return null;
    }
  }, [cfg.decimals, market, lpAmount]);

  // Slippage-adjusted minimum outputs the AMM enforces. The pool ratio can move
  // between this preview and execution, so we submit a floor derived from the
  // preview and the chosen tolerance; the contract reverts with SlippageExceeded
  // if the real output falls below it.
  const addMinLpOut = addPreview !== null ? applySlippage(addPreview.lpOut, slippageBps) : 0n;
  const removeMinPtOut = removePreview !== null ? applySlippage(removePreview.ptOut, slippageBps) : 0n;
  const removeMinSyOut = removePreview !== null ? applySlippage(removePreview.syOut, slippageBps) : 0n;

  const ptError = amountError(ptAmount, cfg.decimals, position?.ptBalance);
  const syError = amountError(syAmount, cfg.decimals, position?.syBalance);
  const lpFieldError = amountError(lpAmount, cfg.decimals, lpPosition?.lpBalance);
  const lpPoolError =
    removePreview !== null && market !== null && removePreview.lpIn >= market.totalLp
      ? "Amount would remove the entire pool."
      : null;
  const lpError = lpFieldError ?? lpPoolError;

  const canAdd =
    address !== null &&
    poolSeeded &&
    !matured &&
    addPreview !== null &&
    addPreview.reason === "ok" &&
    !ptError &&
    !syError &&
    phase.kind !== "working";
  const canRemove =
    address !== null &&
    removePreview !== null &&
    removePreview.reason === "ok" &&
    !lpError &&
    phase.kind !== "working";

  async function onAddLiquidity() {
    if (!address || addPreview === null) return;
    setActiveAction("add");
    await submit(() =>
      client.buildAddLiquidity({
        marketId: cfg.marketId,
        from: address,
        ptIn: parseTokenAmount(ptAmount, cfg.decimals),
        syIn: parseTokenAmount(syAmount, cfg.decimals),
        minLpOut: addMinLpOut,
      }),
    );
  }

  async function onRemoveLiquidity() {
    if (!address || removePreview === null) return;
    setActiveAction("remove");
    await submit(() =>
      client.buildRemoveLiquidity({
        marketId: cfg.marketId,
        from: address,
        lpIn: parseTokenAmount(lpAmount, cfg.decimals),
        minPtOut: removeMinPtOut,
        minSyOut: removeMinSyOut,
      }),
    );
  }

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">Pool</h1>
        <p className="max-w-xl text-smoke">
          Provide PT and SY to the AMM, earn trading fees, and remove your pro-rata assets
          before or after maturity.
        </p>
        <MaturityBadge maturity={market?.maturity ?? null} />
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      <div className="grid gap-10 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="card space-y-6 p-8">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="text-lg font-semibold text-paper">Add liquidity</h2>
                <p className="mt-1 text-xs text-ash">
                  Deposit proportional PT and SY. Any excess side remains in your wallet.
                </p>
              </div>
              <Link
                href="/mint"
                className="rounded-pill border border-white/15 px-3 py-1.5 text-[13px] uppercase tracking-[0.1em] text-smoke transition hover:border-paper hover:text-paper"
              >
                Get PT + SY
              </Link>
            </div>

            <AmountField
              label="PT amount"
              value={ptAmount}
              onChange={setPtAmount}
              decimals={cfg.decimals}
              error={ptError}
              max={position?.ptBalance}
            />
            <AmountField
              label="SY amount"
              value={syAmount}
              onChange={setSyAmount}
              decimals={cfg.decimals}
              error={syError}
              max={position?.syBalance}
            />

            {matured ? (
              <p className="panel-subtle px-4 py-3 text-[13px] text-amber">
                Add liquidity is closed after maturity. Removing LP remains open.
              </p>
            ) : !poolSeeded ? (
              <p className="panel-subtle px-4 py-3 text-[13px] text-ash">
                Pool needs initial operator seeding before user liquidity can quote.
              </p>
            ) : null}
          </div>

          {addPreview !== null ? (
            <dl className="panel-subtle space-y-2 p-5 text-sm">
              <PreviewRow
                label="LP minted"
                value={formatTokenAmount(addPreview.lpOut, cfg.decimals)}
                signal
              />
              <PreviewRow label="PT used" value={formatTokenAmount(addPreview.ptUsed, cfg.decimals)} />
              <PreviewRow label="SY used" value={formatTokenAmount(addPreview.syUsed, cfg.decimals)} />
              <PreviewRow label="PT left in wallet" value={formatTokenAmount(addPreview.ptUnused, cfg.decimals)} />
              <PreviewRow label="SY left in wallet" value={formatTokenAmount(addPreview.syUnused, cfg.decimals)} />
              <PreviewRow label="Limiting side" value={addPreview.limitingSide} />
              <PreviewRow label="New share" value={bpsToPercent(addPreview.shareBpsAfter)} signal />
              <SlippageControl slippageBps={slippageBps} onChange={setSlippageBps} />
              <PreviewRow
                label={`Min LP out (${slippageLabel(slippageBps)} slippage)`}
                value={formatTokenAmount(addMinLpOut, cfg.decimals)}
              />
            </dl>
          ) : null}

          <SubmitButton
            phase={activeAction === "add" ? phase : idlePhase}
            address={address}
            disabled={!canAdd}
            onClick={onAddLiquidity}
            connectLabel="Connect wallet to add liquidity"
            idleLabel="Add liquidity"
          />
          {activeAction === "add" ? <TxStatus phase={phase} context="amm" /> : null}

          <div className="card space-y-6 p-8">
            <div>
              <h2 className="text-lg font-semibold text-paper">Remove liquidity</h2>
              <p className="mt-1 text-xs text-ash">
                Burn LP shares and receive the current pro-rata PT and SY reserves.
              </p>
            </div>

            <AmountField
              label="LP amount"
              value={lpAmount}
              onChange={setLpAmount}
              decimals={cfg.decimals}
              error={lpError}
              max={lpPosition?.lpBalance}
            />
          </div>

          {removePreview !== null ? (
            <dl className="panel-subtle space-y-2 p-5 text-sm">
              <PreviewRow
                label="PT received"
                value={formatTokenAmount(removePreview.ptOut, cfg.decimals)}
                signal
              />
              <PreviewRow
                label="SY received"
                value={formatTokenAmount(removePreview.syOut, cfg.decimals)}
                signal
              />
              <PreviewRow label="Pool share burned" value={bpsToPercent(removePreview.shareBps)} />
              <SlippageControl slippageBps={slippageBps} onChange={setSlippageBps} />
              <PreviewRow
                label={`Min PT out (${slippageLabel(slippageBps)} slippage)`}
                value={formatTokenAmount(removeMinPtOut, cfg.decimals)}
              />
              <PreviewRow
                label={`Min SY out (${slippageLabel(slippageBps)} slippage)`}
                value={formatTokenAmount(removeMinSyOut, cfg.decimals)}
              />
            </dl>
          ) : null}

          <SubmitButton
            phase={activeAction === "remove" ? phase : idlePhase}
            address={address}
            disabled={!canRemove}
            onClick={onRemoveLiquidity}
            connectLabel="Connect wallet to remove liquidity"
            idleLabel="Remove liquidity"
          />
          {activeAction === "remove" ? <TxStatus phase={phase} context="amm" /> : null}
        </div>

        <aside className="space-y-8 lg:col-span-5">
          <YieldSourceCard source={cfg.yieldSource} market={market} rates={blendRates} />

          <p className="label-data">Pool status</p>
          <dl className="card space-y-px p-6">
            <Stat
              label="PT reserves"
              value={market ? formatTokenAmount(market.totalPt, cfg.decimals) : "n/a"}
              loading={marketLoading}
            />
            <Stat
              label="SY reserves"
              value={market ? formatTokenAmount(market.totalSy, cfg.decimals) : "n/a"}
              loading={marketLoading}
            />
            <Stat
              label="Total LP"
              value={market ? formatTokenAmount(market.totalLp, cfg.decimals) : "n/a"}
              loading={marketLoading}
            />
            <Stat label="Fee" value={market ? bpsToPercent(market.feeBps) : "n/a"} loading={marketLoading} />
            <Stat
              label="Implied APY"
              value={market ? bpsToPercent(market.impliedApyBps) : "n/a"}
              loading={marketLoading}
              signal
            />
            <Stat
              label="Maturity"
              value={market ? maturityStatus(market.maturity) : "n/a"}
              loading={marketLoading}
              signal
            />
            <Stat
              label="Maturity date"
              value={market ? formatMaturityDate(market.maturity) : "n/a"}
              loading={marketLoading}
            />
          </dl>

          <p className="label-data">Your LP position</p>
          <dl className="card space-y-px p-6">
            <Stat
              label="LP balance"
              value={lpPosition ? formatTokenAmount(lpPosition.lpBalance, cfg.decimals) : "0"}
            />
            <Stat label="Pool share" value={lpPosition ? bpsToPercent(lpPosition.shareBps) : "0.00%"} signal />
            <Stat
              label="PT value"
              value={lpPosition ? formatTokenAmount(lpPosition.ptValue, cfg.decimals) : "0"}
            />
            <Stat
              label="SY value"
              value={lpPosition ? formatTokenAmount(lpPosition.syValue, cfg.decimals) : "0"}
            />
          </dl>
        </aside>
      </div>
    </div>
  );
}

function slippageLabel(slippageBps: bigint): string {
  return SLIPPAGE_OPTIONS.find((o) => o.bps === slippageBps)?.label ?? `${slippageBps} bps`;
}

// Shared slippage selector for both LP actions. Bound to the page's single
// slippageBps state, so rendering it in both preview panels keeps one setting,
// not two. Mirrors the swap page's inline chip row.
function SlippageControl({
  slippageBps,
  onChange,
}: {
  slippageBps: bigint;
  onChange: (bps: bigint) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-white/10 py-2">
      <span className="text-ash">Slippage tolerance</span>
      <div className="flex gap-px border border-white/10">
        {SLIPPAGE_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.bps)}
            aria-pressed={slippageBps === opt.bps}
            className={`px-3 py-1.5 text-[13px] tabular-nums transition ${
              slippageBps === opt.bps
                ? "bg-amber/10 text-amber"
                : "text-smoke hover:text-paper"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  signal,
}: {
  label: string;
  value: string;
  signal?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-t border-white/10 py-2 first:border-t-0 first:pt-0">
      <dt className="text-ash">{label}</dt>
      <dd className={`tabular-nums ${signal ? "text-amber" : "text-paper"}`}>{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  signal,
  loading,
}: {
  label: string;
  value: string;
  signal?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-white/10 py-3 first:border-t-0 first:pt-0">
      <dt className="label-data">{label}</dt>
      <dd className={`text-sm tabular-nums ${signal ? "text-amber" : "text-paper"}`}>
        <LiveValue value={value} loading={loading} className="w-14" />
      </dd>
    </div>
  );
}
