// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import { WAD } from "@sidereal/sdk";
import {
  amountError,
  formatMaturityDate,
  formatTokenAmount,
  maturityStatus,
  parseTokenAmount,
} from "@/lib/format";
import {
  fetchBlendFaucetTransaction,
  fundWithFriendbot,
  submitClassicTransaction,
} from "@/lib/blendFaucet";
import { TESTNET_PASSPHRASE } from "@/lib/config";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { useWallet } from "@/lib/wallet";
import { useMarket } from "@/lib/useMarket";
import { useBlendRates } from "@/lib/useBlendRates";
import { PositionCard } from "@/components/PositionCard";
import { AmountField } from "@/components/AmountField";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";
import { ExplorerTxLink } from "@/components/ExplorerTxLink";
import { MaturityBadge } from "@/components/MaturityBadge";
import { YieldSourceCard } from "@/components/YieldSourceCard";
import { TokenizeBlendPanel } from "@/components/TokenizeBlendPanel";
import { YieldChoiceCard } from "@/components/YieldChoiceCard";
import { useBlendPosition } from "@/lib/useBlendPosition";

const MINT_MODES = [
  { id: "deposit", label: "Deposit SY" },
  { id: "split", label: "Deposit + split" },
] as const;

const BLEND_USDC_TRUSTLINE_ERROR =
  "trustline missing for Blend testnet USDC";

type FaucetPhase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; hash: string }
  | { kind: "error"; message: string };

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function walletTokenBalanceError(error: unknown, isBlendMarket: boolean): string {
  if (isBlendMarket) return BLEND_USDC_TRUSTLINE_ERROR;

  const text =
    error instanceof Error
      ? `${error.name} ${error.message} ${error.stack ?? ""}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const normalized = text.toLowerCase();
  if (
    normalized.includes("trustline") ||
    normalized.includes("contract, #13") ||
    normalized.includes("contract #13")
  ) {
    return BLEND_USDC_TRUSTLINE_ERROR;
  }
  return "unable to read wallet USDC balance";
}

export default function MintPage() {
  const { cfg, client, address, phase, submit, submitSequence } = useSidereal();
  const { signTransaction } = useWallet();

  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MINT_MODES)[number]["id"]>("deposit");
  const [underlyingBalance, setUnderlyingBalance] = useState<bigint | null>(null);
  const [underlyingBalanceError, setUnderlyingBalanceError] = useState<string | null>(null);
  const [faucetPhase, setFaucetPhase] = useState<FaucetPhase>({ kind: "idle" });
  const [faucetRefresh, setFaucetRefresh] = useState(0);
  const market = useMarket();
  const blendRates = useBlendRates();
  // The faucet lands outside the tx-flow phase, so fold its refresh counter
  // into the same key that already retriggers reads after a confirmed tx.
  const refreshKey = `${phase.kind === "done" ? phase.hash : 0}:${faucetRefresh}`;
  const position = usePosition(address, refreshKey);
  const blendPosition = useBlendPosition(address, refreshKey);
  const split = mode === "split";
  const isTestnet = cfg.networkPassphrase === TESTNET_PASSPHRASE;

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

  // A different wallet starts its own faucet story; drop the previous one's.
  useEffect(() => {
    setFaucetPhase({ kind: "idle" });
  }, [address]);

  useEffect(() => {
    if (!address || market === null) {
      setUnderlyingBalance(null);
      return;
    }

    let cancelled = false;
    setUnderlyingBalance(null);
    setUnderlyingBalanceError(null);
    client
      .getTokenBalance(market.underlying, address)
      .then((balance) => {
        if (!cancelled) setUnderlyingBalance(balance);
      })
      .catch((error) => {
        if (cancelled) return;
        setUnderlyingBalance(0n);
        setUnderlyingBalanceError(walletTokenBalanceError(error, cfg.yieldSource.kind === "blend"));
      });

    return () => {
      cancelled = true;
    };
  }, [address, client, market, cfg.yieldSource.kind, faucetRefresh]);

  const amtError =
    underlyingBalanceError ?? amountError(amount, cfg.decimals, underlyingBalance ?? undefined);
  const canSubmit = address !== null && preview !== null && !amtError && phase.kind !== "working";
  // The faucet dispenses the exact Blend testnet reserve asset, so it only
  // helps a Blend market on testnet, and only while the wallet is missing the
  // trustline or holds zero of the underlying.
  const showFaucet =
    isTestnet &&
    cfg.yieldSource.kind === "blend" &&
    address !== null &&
    market !== null &&
    (underlyingBalanceError === BLEND_USDC_TRUSTLINE_ERROR ||
      (underlyingBalanceError === null && underlyingBalance === 0n));

  async function onGetTestUsdc() {
    if (!address || !isTestnet || market === null) return;
    try {
      setFaucetPhase({ kind: "working", step: "Requesting faucet transaction" });
      let faucet = await fetchBlendFaucetTransaction(cfg.blendFaucetUrl, address);
      if (faucet.kind === "account_not_found") {
        // The G-account has never been funded, so the faucet cannot build a
        // transaction from it. Friendbot creates it, then the faucet retries.
        setFaucetPhase({ kind: "working", step: "Funding testnet account" });
        await fundWithFriendbot(cfg.friendbotUrl, address);
        setFaucetPhase({ kind: "working", step: "Retrying faucet" });
        for (let attempt = 0; attempt < 5 && faucet.kind === "account_not_found"; attempt += 1) {
          await wait(1_000);
          faucet = await fetchBlendFaucetTransaction(cfg.blendFaucetUrl, address);
        }
      }
      if (faucet.kind !== "transaction") {
        throw new Error(
          "The funded account is not visible to the Blend faucet yet. Try again shortly.",
        );
      }

      // The faucet returns a classic transaction sourced from the user's own
      // account: the wallet reviews and signs it, then Horizon submits it.
      setFaucetPhase({ kind: "working", step: "Awaiting signature" });
      const signedXdr = await signTransaction(faucet.xdr);
      setFaucetPhase({ kind: "working", step: "Submitting faucet transaction" });
      const hash = await submitClassicTransaction(signedXdr);

      // Horizon confirms inclusion, but the Soroban RPC that serves balance
      // reads can lag a ledger; poll briefly so the form unlocks on success.
      setFaucetPhase({ kind: "working", step: "Refreshing USDC balance" });
      const deadline = Date.now() + 20_000;
      let granted = 0n;
      while (granted === 0n && Date.now() < deadline) {
        await wait(1_000);
        granted = await client.getTokenBalance(market.underlying, address).catch(() => 0n);
      }
      setFaucetRefresh((key) => key + 1);
      setFaucetPhase({ kind: "done", hash });
    } catch (error) {
      setFaucetPhase({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
    <div className="space-y-12">
      <header className="space-y-3">
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">Mint</h1>
        <p className="max-w-xl text-smoke">
          Deposit USDC to receive SY, and optionally split it into equal amounts of PT and YT.
        </p>
        <MaturityBadge maturity={market?.maturity ?? null} />
        <section className="panel-subtle max-w-3xl space-y-3 p-5" aria-labelledby="funded-run-blocker">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="funded-run-blocker" className="label-data text-amber">
              Blocker 3: Funded manual run
            </h2>
            <span className="rounded-pill border border-white/15 px-2.5 py-1 text-[13px] uppercase tracking-[0.1em] text-smoke">
              Browser wallet
            </span>
          </div>
          <ol className="grid gap-2 text-xs leading-relaxed text-smoke sm:grid-cols-2">
            <li>
              <span className="text-paper">Prepare:</span> testnet wallet with the Blend USDC
              trustline, {cfg.yieldSource.reserveAsset || "USDC:GATALT...5V56"}.
            </li>
            <li>
              <span className="text-paper">Fund:</span> transfer reserve USDC from the
              sidereal-smoke identity instead of using Circle faucet USDC.
            </li>
            <li>
              <span className="text-paper">Walk:</span> run the demo checklist, supply on Blend,
              tokenize here, sell YT if pool depth allows, then check Portfolio.
            </li>
            <li>
              <span className="text-paper">Record:</span> transaction hashes in USER_FLOW section 9
              and REMAINING 3b before flipping this blocker to done.
            </li>
          </ol>
        </section>
      </header>

      <PositionCard position={position} decimals={cfg.decimals} />

      {cfg.yieldSource.kind === "blend" &&
      (blendPosition === null || blendPosition.underlyingValue <= 0n) ? (
        <YieldChoiceCard
          market={market}
          rates={blendRates}
          decimals={cfg.decimals}
          fixedHref="#mint-form"
          fixedCtaLabel="Use mint form"
        />
      ) : null}

      <TokenizeBlendPanel
        cfg={cfg}
        client={client}
        address={address}
        market={market}
        position={blendPosition}
        rates={blendRates}
        phase={phase}
        submitSequence={submitSequence}
      />

      <div id="mint-form" className="grid gap-10 lg:grid-cols-12">
        {/* Deposit form */}
        <div className="space-y-6 lg:col-span-7">
          <div className="card space-y-6 p-8">
            <AmountField
              label="Amount (USDC)"
              value={amount}
              onChange={setAmount}
              decimals={cfg.decimals}
              error={amtError}
              max={underlyingBalance ?? undefined}
              dataTour="mint-amount"
            />

            <p className="text-xs tabular-nums text-ash">
              {cfg.yieldSource.kind === "blend" ? "Wallet Blend USDC balance" : "Wallet USDC balance"}
              :{" "}
              {address ? (
                underlyingBalance === null ? (
                  <span aria-hidden className="skeleton w-12" />
                ) : (
                  underlyingBalanceError ?? formatTokenAmount(underlyingBalance, cfg.decimals)
                )
              ) : (
                "connect wallet"
              )}
            </p>
            {cfg.yieldSource.kind === "blend" ? (
              <p className="text-xs leading-relaxed text-ash">
                Expected asset: {cfg.yieldSource.reserveAsset || "Blend testnet USDC"} via{" "}
                {cfg.yieldSource.reserveAddress}. Circle faucet USDC on another issuer will not
                appear here.
              </p>
            ) : null}

            {showFaucet || faucetPhase.kind !== "idle" ? (
              <div className="space-y-3 border-t border-white/10 pt-5">
                <span className="label-data">Need test USDC?</span>
                <p className="text-xs leading-relaxed text-ash">
                  The Blend faucet prepares a transaction that adds the trustline and funds
                  this exact reserve asset. Your wallet reviews and signs it.
                </p>
                {showFaucet ? (
                  <button
                    type="button"
                    className="btn-solid"
                    disabled={faucetPhase.kind === "working"}
                    onClick={() => void onGetTestUsdc()}
                  >
                    {faucetPhase.kind === "working" ? `${faucetPhase.step}...` : "Get test USDC"}
                  </button>
                ) : null}
                {faucetPhase.kind === "done" ? (
                  <p className="text-sm font-medium text-paper">
                    Test USDC granted. Tx <ExplorerTxLink hash={faucetPhase.hash} />
                  </p>
                ) : null}
                {faucetPhase.kind === "error" ? (
                  <p className="text-sm text-red-400">{faucetPhase.message}</p>
                ) : null}
              </div>
            ) : null}

            <div className="border-t border-white/10 pt-5">
              <span className="label-data">Mint mode</span>
              <div className="mt-3 grid grid-cols-2 gap-px border border-white/10">
                {MINT_MODES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    aria-pressed={mode === option.id}
                    className={`px-3 py-2.5 text-[13px] uppercase tracking-[0.08em] transition ${
                      mode === option.id
                        ? "bg-white/[0.04] text-amber"
                        : "text-smoke hover:text-paper"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-ash">
                {split
                  ? "Deposits USDC to SY, then splits the new SY into PT and YT with a second signature."
                  : "Deposits USDC into SY only. You can split later from a separate action."}
              </p>
            </div>
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
            idleLabel={split ? "Deposit, then split (2 signatures)" : "Deposit SY"}
            dataTour="mint-submit"
          />

          <TxStatus phase={phase} context="sy" />
        </div>

        {/* Protocol parameters: real maturity data plus the token legend. */}
        <aside className="space-y-8 lg:col-span-5">
          <YieldSourceCard source={cfg.yieldSource} market={market} rates={blendRates} />

          <p className="label-data">Protocol parameters</p>

          <div className="card space-y-2 p-6">
            <p className="label-data">Maturity date</p>
            {market !== null ? (
              <>
                <p className="text-xl tabular-nums text-paper">{formatMaturityDate(market!.maturity)}</p>
                <p className="text-sm tabular-nums text-amber">{maturityStatus(market!.maturity)}</p>
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
