// SPDX-License-Identifier: Apache-2.0

/**
 * Domain types for the sidereal SDK.
 *
 * These mirror the frozen on-chain interfaces in
 * `contracts/shared/types/src/lib.rs` (the `Market` and `StandardizedYield`
 * traits). Numeric on-chain values are `i128`; we surface them as `bigint` to
 * avoid precision loss. Human-readable derivations (APY as a percent) are
 * provided alongside the raw values, never in place of them.
 */

/** Fixed-point scale used by the protocol for ratios (18 decimals, "WAD"). */
export const WAD = 1_000_000_000_000_000_000n;

/** Basis-point denominator (1 bps = 1/10_000). */
export const BPS_DENOMINATOR = 10_000n;

/** The three fungible legs a user can hold or trade. */
export type Asset = "SY" | "PT" | "YT";

/** Resolved contract addresses for one market deployment. */
export interface ContractAddresses {
  /** Standardized Yield wrapper (one per underlying). */
  sy: string;
  /** Principal Token. */
  pt: string;
  /** Yield Token. */
  yt: string;
  /** Tokenizer that mints/redeems PT+YT from SY. */
  tokenizer: string;
  /** Time-decay AMM (the PT/SY market). */
  market: string;
}

export interface StellarYTOptions {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org. */
  rpcUrl: string;
  /** Network passphrase, e.g. "Test SDF Network ; September 2015". */
  networkPassphrase: string;
  /** Funded G-account used only as the source for read simulations. */
  simulationSourceAccount: string;
  /** Deployed contract addresses for the target market. */
  contracts: ContractAddresses;
}

/** Snapshot of one market's on-chain state. */
export interface MarketState {
  marketId: string;
  /** Underlying asset address backing the SY. */
  underlying: string;
  /** SY per underlying, 18-decimal fixed point (the SY exchange rate). */
  exchangeRate: bigint;
  /** Internal TWAP implied APY, in basis points (what integrators should read). */
  impliedApyBps: bigint;
  /** Spot implied APY, in basis points (single-block, manipulable; display-only). */
  spotApyBps: bigint;
  /** True while the TWAP window is still filling; gate "rate stabilizing" UX. */
  twapWarmingUp: boolean;
  /** Maturity as a Unix timestamp in seconds. */
  maturity: number;
  /** Seconds remaining until maturity (0 once matured). */
  secondsToMaturity: number;
  /** Total PT reserves in the pool. */
  totalPt: bigint;
  /** Total SY reserves in the pool. */
  totalSy: bigint;
}

export interface SwapArgs {
  marketId: string;
  /** Account initiating the swap. */
  from: string;
  /** Leg being sold. */
  assetIn: Asset;
  /** Leg being bought. */
  assetOut: Asset;
  /** Amount of `assetIn` to sell, in token base units. */
  amountIn: bigint;
  /** Minimum acceptable `assetOut`, in token base units (slippage guard). */
  minAmountOut: bigint;
}

export interface Quote {
  assetIn: Asset;
  assetOut: Asset;
  amountIn: bigint;
  /** Expected output from simulation, in token base units. */
  amountOut: bigint;
  /** Price impact in basis points (positive = worse for the trader). */
  priceImpactBps: bigint;
  /** Implied APY after the swap, in basis points. */
  impliedApyBps: bigint;
}

export interface Position {
  holder: string;
  marketId: string;
  syBalance: bigint;
  ptBalance: bigint;
  ytBalance: bigint;
  /** Yield claimable by this holder right now, in SY base units. */
  claimableYield: bigint;
  /** LP tokens held by this holder in the AMM, in base units. */
  lpBalance: bigint;
}

export interface MintArgs {
  marketId: string;
  from: string;
  /** Underlying amount to deposit, in token base units. */
  underlyingAmount: bigint;
}

export interface SplitArgs {
  from: string;
  /**
   * SY shares to split into PT + YT, in base units. The tokenizer mints
   * `syAmount * rate / WAD` of each (asset-unit face). Deposit and split cannot
   * share a transaction (Soroban allows one host-function op per tx), so the UI
   * deposits first, then splits the exact SY the deposit minted.
   */
  syAmount: bigint;
}

export interface RedeemArgs {
  marketId: string;
  from: string;
  /**
   * Before maturity: recombine `amount` PT + `amount` YT back into SY principal.
   * At/after maturity: redeem `amount` PT for its principal in SY
   * (`amount * WAD / maturity_rate`), capped pro-rata under insolvency.
   */
  amount: bigint;
}

export interface ClaimArgs {
  marketId: string;
  from: string;
}

export interface AddLiquidityArgs {
  marketId: string;
  from: string;
  /** PT to deposit into the pool, in base units. */
  ptIn: bigint;
  /** SY to deposit into the pool, in base units. */
  syIn: bigint;
}

export interface RemoveLiquidityArgs {
  marketId: string;
  from: string;
  /** LP tokens to burn, in base units. */
  lpIn: bigint;
}

/** A built, unsigned Soroban transaction the caller hands to a wallet. */
export interface TransactionEnvelope {
  /** Base64 XDR of the unsigned transaction envelope. */
  xdr: string;
  /** Network passphrase the transaction was built for. */
  networkPassphrase: string;
}
