// SPDX-License-Identifier: Apache-2.0

/**
 * Blend v2 pool types and rate math.
 *
 * The formulas mirror blend-capital/blend-contracts-v2 (main) exactly:
 *
 * - utilization: `pool/src/pool/reserve.rs` `Reserve::utilization`, 7-decimal
 *   fixed point, capped at 1.0, ceil-rounded.
 * - borrow rate: `pool/src/pool/interest.rs` `calc_accrual`, the three-slope
 *   curve over utilization with breakpoints at the reserve's target
 *   utilization and 0.95. `ir_mod` is the reactive rate modifier, 7 decimals
 *   in v2 (bounded to [0.1, 10] as `SCALAR_7 / 10` and `10 * SCALAR_7`).
 * - supplier share: `pool/src/pool/reserve.rs` `Reserve::accrue` credits
 *   suppliers the accrued loan interest minus the backstop take
 *   (`PoolConfig.bstop_rate`, 7 decimals), so the instantaneous supply rate is
 *   `borrow_rate * utilization * (1 - bstop_rate)`.
 *
 * All rates returned here are annualized APRs in Blend's 7-decimal fixed
 * point (10_000_000 = 100%). They are display estimates: the pool compounds
 * per accrual, so realized yield differs slightly.
 */

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

/** Blend's 7-decimal fixed-point scale (rates, utilization, config values). */
export const BLEND_SCALAR_7 = 10_000_000n;
/** Blend's 12-decimal fixed-point scale (b_rate / d_rate cumulative indexes). */
export const BLEND_SCALAR_12 = 1_000_000_000_000n;

/** Second utilization breakpoint of the rate curve (0.95 in 7 decimals). */
const UTIL_BREAKPOINT = 9_500_000n;

/**
 * Blend `RequestType` discriminants (pool/src/pool/actions.rs). A withdraw
 * request larger than the holder's balance is clamped to the full balance by
 * the pool, so passing a position's current valuation drains the bucket.
 */
export const BLEND_REQUEST_SUPPLY = 0;
export const BLEND_REQUEST_WITHDRAW = 1;
export const BLEND_REQUEST_SUPPLY_COLLATERAL = 2;
export const BLEND_REQUEST_WITHDRAW_COLLATERAL = 3;

/** Reserve configuration, decoded from `pool.get_reserve(asset).config`. */
export interface BlendReserveConfig {
  /** Reserve index in the pool's reserve list. */
  index: number;
  /** Underlying token decimals. */
  decimals: number;
  /** Target utilization of the rate curve (7 decimals). */
  util: bigint;
  /** Maximum allowed utilization (7 decimals). */
  maxUtil: bigint;
  /** Rate curve segments (7 decimals each). */
  rBase: bigint;
  rOne: bigint;
  rTwo: bigint;
  rThree: bigint;
}

/** Reserve state, decoded from `pool.get_reserve(asset).data`. */
export interface BlendReserveData {
  /** Cumulative supply interest index (12 decimals). */
  bRate: bigint;
  /** Total bTokens issued for this reserve. */
  bSupply: bigint;
  /** Cumulative borrow interest index (12 decimals). */
  dRate: bigint;
  /** Total dTokens issued for this reserve. */
  dSupply: bigint;
  /** Reactive interest-rate modifier (7 decimals, in [0.1, 10]). */
  irMod: bigint;
  /** Unix seconds of the last accrual. */
  lastTime: bigint;
}

/** A Blend reserve read: `pool.get_reserve(asset)`. */
export interface BlendReserve {
  asset: string;
  config: BlendReserveConfig;
  data: BlendReserveData;
}

/** Live rate snapshot of one Blend reserve, all 7-decimal fixed point. */
export interface BlendRates {
  /** Current utilization (7 decimals, 10_000_000 = 100%). */
  utilization: bigint;
  /** Annualized borrow APR at the current utilization (7 decimals). */
  borrowApr: bigint;
  /** Annualized supply APR: borrow APR net of backstop take, times utilization. */
  supplyApr: bigint;
  /** Total underlying supplied to the reserve, in base units. */
  totalSupplied: bigint;
  /** Total underlying borrowed from the reserve, in base units. */
  totalBorrowed: bigint;
}

/** `ceil(a * b / scalar)`, Blend's `fixed_mul_ceil` for non-negative values. */
function mulCeil(a: bigint, b: bigint, scalar: bigint): bigint {
  return (a * b + scalar - 1n) / scalar;
}

/** `ceil(a * scalar / b)`, Blend's `fixed_div_ceil` for non-negative values. */
function divCeil(a: bigint, b: bigint, scalar: bigint): bigint {
  return (a * scalar + b - 1n) / b;
}

/** Underlying value of a bToken balance: `b_tokens * b_rate / 1e12`, floored. */
export function blendAssetsFromBTokens(bTokens: bigint, bRate: bigint): bigint {
  return (bTokens * bRate) / BLEND_SCALAR_12;
}

/** Underlying owed for a dToken balance: `d_tokens * d_rate / 1e12`, floored. */
export function blendAssetsFromDTokens(dTokens: bigint, dRate: bigint): bigint {
  return (dTokens * dRate) / BLEND_SCALAR_12;
}

/**
 * Current reserve utilization (7 decimals). Mirrors `Reserve::utilization`:
 * zero when nothing is borrowed, capped at 1.0, ceil-rounded otherwise.
 */
export function blendUtilization(totalBorrowed: bigint, totalSupplied: bigint): bigint {
  if (totalBorrowed <= 0n) return 0n;
  if (totalBorrowed >= totalSupplied) return BLEND_SCALAR_7;
  return divCeil(totalBorrowed, totalSupplied, BLEND_SCALAR_7);
}

/**
 * Annualized borrow APR at `utilization`, mirroring `calc_accrual`'s
 * three-slope curve. Throws on a malformed config (zero target utilization),
 * exactly where the contract's fixed-point division would trap.
 */
export function blendBorrowApr(
  config: Pick<BlendReserveConfig, "util" | "rBase" | "rOne" | "rTwo" | "rThree">,
  utilization: bigint,
  irMod: bigint,
): bigint {
  if (utilization <= config.util) {
    const utilScalar = divCeil(utilization, config.util, BLEND_SCALAR_7);
    const baseRate = mulCeil(utilScalar, config.rOne, BLEND_SCALAR_7) + config.rBase;
    return mulCeil(baseRate, irMod, BLEND_SCALAR_7);
  }
  if (utilization <= UTIL_BREAKPOINT) {
    const utilScalar = divCeil(
      utilization - config.util,
      UTIL_BREAKPOINT - config.util,
      BLEND_SCALAR_7,
    );
    const baseRate =
      mulCeil(utilScalar, config.rTwo, BLEND_SCALAR_7) + config.rOne + config.rBase;
    return mulCeil(baseRate, irMod, BLEND_SCALAR_7);
  }
  const utilScalar = divCeil(
    utilization - UTIL_BREAKPOINT,
    BLEND_SCALAR_7 - UTIL_BREAKPOINT,
    BLEND_SCALAR_7,
  );
  const extraRate = mulCeil(utilScalar, config.rThree, BLEND_SCALAR_7);
  const intersection = mulCeil(
    irMod,
    config.rTwo + config.rOne + config.rBase,
    BLEND_SCALAR_7,
  );
  return extraRate + intersection;
}

/**
 * Annualized supply APR: the borrow interest flows to suppliers scaled by
 * utilization, minus the backstop take (`Reserve::accrue`). Floored, so the
 * estimate never overstates what suppliers receive.
 */
export function blendSupplyApr(
  borrowApr: bigint,
  utilization: bigint,
  bstopRate: bigint,
): bigint {
  const gross = (borrowApr * utilization) / BLEND_SCALAR_7;
  return (gross * (BLEND_SCALAR_7 - bstopRate)) / BLEND_SCALAR_7;
}

/** Composes a full rate snapshot from a decoded reserve and the pool's take. */
export function blendRates(reserve: BlendReserve, bstopRate: bigint): BlendRates {
  const totalSupplied = blendAssetsFromBTokens(reserve.data.bSupply, reserve.data.bRate);
  const totalBorrowed = blendAssetsFromDTokens(reserve.data.dSupply, reserve.data.dRate);
  const utilization = blendUtilization(totalBorrowed, totalSupplied);
  const borrowApr = blendBorrowApr(reserve.config, utilization, reserve.data.irMod);
  const supplyApr = blendSupplyApr(borrowApr, utilization, bstopRate);
  return { utilization, borrowApr, supplyApr, totalSupplied, totalBorrowed };
}

/** Converts a 7-decimal Blend rate to basis points (floored). */
export function blendRateToBps(rate: bigint): bigint {
  return rate / 1_000n;
}

/**
 * Encodes one Blend `Request` struct as a symbol-keyed ScVal map, the shape
 * `pool.submit` expects inside its request vector.
 */
export function encodeBlendRequest(
  asset: string,
  requestType: number,
  amount: bigint,
): xdr.ScVal {
  return nativeToScVal(
    { address: new Address(asset), amount, request_type: requestType },
    {
      type: {
        address: ["symbol"],
        amount: ["symbol", "i128"],
        request_type: ["symbol", "u32"],
      },
    },
  );
}

/**
 * A holder's raw token maps from `pool.get_positions(address)`, keyed by
 * reserve index. Blend splits deposits between liquid supply (RequestType
 * Supply) and posted collateral (RequestType SupplyCollateral); Blend's own
 * app supplies as collateral by default, so a typical lender's balance is in
 * `collateral`, not `supply`. Both earn the same b_rate interest.
 */
export interface BlendPositions {
  supply: ReadonlyMap<number, bigint>;
  collateral: ReadonlyMap<number, bigint>;
  liabilities: ReadonlyMap<number, bigint>;
}

/** A holder's position in one Blend reserve, valued at the current indexes. */
export interface BlendPosition {
  /** bTokens held as liquid supply (withdrawable with RequestType Withdraw). */
  supplyBTokens: bigint;
  /** bTokens posted as collateral (needs RequestType WithdrawCollateral). */
  collateralBTokens: bigint;
  /** Underlying value of the liquid supply bucket, base units. */
  supplyValue: bigint;
  /** Underlying value of the collateral bucket, base units. */
  collateralValue: bigint;
  /** Underlying value of both balances at the current b_rate, base units. */
  underlyingValue: bigint;
  /** Underlying owed on borrows against this reserve at the current d_rate. */
  borrowedValue: bigint;
}

/**
 * Decodes the plain object `scValToNative` produces for Blend's `Positions`
 * struct. Soroban `Map<u32, i128>` arrives as an object with stringified
 * numeric keys, so normalize into real maps.
 */
export function decodeBlendPositions(raw: {
  supply: Record<string, bigint>;
  collateral: Record<string, bigint>;
  liabilities: Record<string, bigint>;
}): BlendPositions {
  const toMap = (entries: Record<string, bigint>): Map<number, bigint> =>
    new Map(Object.entries(entries ?? {}).map(([k, v]) => [Number(k), BigInt(v)]));
  return {
    supply: toMap(raw.supply),
    collateral: toMap(raw.collateral),
    liabilities: toMap(raw.liabilities),
  };
}

/** Values a holder's balances in `reserve` at the current interest indexes. */
export function blendPositionFor(
  reserve: BlendReserve,
  positions: BlendPositions,
): BlendPosition {
  const index = reserve.config.index;
  const supplyBTokens = positions.supply.get(index) ?? 0n;
  const collateralBTokens = positions.collateral.get(index) ?? 0n;
  const dTokens = positions.liabilities.get(index) ?? 0n;
  const supplyValue = blendAssetsFromBTokens(supplyBTokens, reserve.data.bRate);
  const collateralValue = blendAssetsFromBTokens(collateralBTokens, reserve.data.bRate);
  return {
    supplyBTokens,
    collateralBTokens,
    supplyValue,
    collateralValue,
    underlyingValue: supplyValue + collateralValue,
    borrowedValue: blendAssetsFromDTokens(dTokens, reserve.data.dRate),
  };
}

/**
 * Decodes the plain object `scValToNative` produces for a Blend `Reserve`
 * struct (snake_case keys, u32 as number, i128 as bigint) into the typed
 * shape above. Field meanings are pinned by contracts/blend-adapter.
 */
export function decodeBlendReserve(raw: {
  asset: string;
  config: {
    index: number;
    decimals: number;
    util: number;
    max_util: number;
    r_base: number;
    r_one: number;
    r_two: number;
    r_three: number;
  };
  data: {
    b_rate: bigint;
    b_supply: bigint;
    d_rate: bigint;
    d_supply: bigint;
    ir_mod: bigint;
    last_time: bigint;
  };
}): BlendReserve {
  return {
    asset: raw.asset,
    config: {
      index: Number(raw.config.index),
      decimals: Number(raw.config.decimals),
      util: BigInt(raw.config.util),
      maxUtil: BigInt(raw.config.max_util),
      rBase: BigInt(raw.config.r_base),
      rOne: BigInt(raw.config.r_one),
      rTwo: BigInt(raw.config.r_two),
      rThree: BigInt(raw.config.r_three),
    },
    data: {
      bRate: BigInt(raw.data.b_rate),
      bSupply: BigInt(raw.data.b_supply),
      dRate: BigInt(raw.data.d_rate),
      dSupply: BigInt(raw.data.d_supply),
      irMod: BigInt(raw.data.ir_mod),
      lastTime: BigInt(raw.data.last_time),
    },
  };
}
