// SPDX-License-Identifier: Apache-2.0

import { BPS_DENOMINATOR } from "@sidereal/sdk";

export type LiquiditySide = "balanced" | "PT" | "SY";

export interface AddLiquidityPreview {
  lpOut: bigint;
  ptUsed: bigint;
  syUsed: bigint;
  ptUnused: bigint;
  syUnused: bigint;
  limitingSide: LiquiditySide;
  shareBpsAfter: bigint;
  reason: "ok" | "empty-pool" | "invalid-input" | "insufficient-liquidity";
}

export interface RemoveLiquidityPreview {
  lpIn: bigint;
  ptOut: bigint;
  syOut: bigint;
  shareBps: bigint;
  reason: "ok" | "empty-pool" | "invalid-input" | "insufficient-liquidity";
}

export interface PoolInputs {
  totalPt: bigint;
  totalSy: bigint;
  totalLp: bigint;
}

function mulDivUp(lhs: bigint, rhs: bigint, denominator: bigint): bigint {
  const product = lhs * rhs;
  const quotient = product / denominator;
  return product % denominator === 0n ? quotient : quotient + 1n;
}

function zeroAddPreview(reason: AddLiquidityPreview["reason"]): AddLiquidityPreview {
  return {
    lpOut: 0n,
    ptUsed: 0n,
    syUsed: 0n,
    ptUnused: 0n,
    syUnused: 0n,
    limitingSide: "balanced",
    shareBpsAfter: 0n,
    reason,
  };
}

function zeroRemovePreview(
  lpIn: bigint,
  reason: RemoveLiquidityPreview["reason"],
): RemoveLiquidityPreview {
  return {
    lpIn,
    ptOut: 0n,
    syOut: 0n,
    shareBps: 0n,
    reason,
  };
}

export function previewAddLiquidity({
  ptIn,
  syIn,
  totalPt,
  totalSy,
  totalLp,
}: PoolInputs & { ptIn: bigint; syIn: bigint }): AddLiquidityPreview {
  if (ptIn <= 0n || syIn <= 0n) return zeroAddPreview("invalid-input");
  if (totalPt <= 0n || totalSy <= 0n || totalLp <= 0n) {
    return zeroAddPreview("empty-pool");
  }

  const lpByPt = (ptIn * totalLp) / totalPt;
  const lpBySy = (syIn * totalLp) / totalSy;
  const lpOut = lpByPt < lpBySy ? lpByPt : lpBySy;
  if (lpOut <= 0n) return zeroAddPreview("insufficient-liquidity");

  const ptUsed = mulDivUp(totalPt, lpOut, totalLp);
  const syUsed = mulDivUp(totalSy, lpOut, totalLp);
  const totalLpAfter = totalLp + lpOut;

  return {
    lpOut,
    ptUsed,
    syUsed,
    ptUnused: ptIn > ptUsed ? ptIn - ptUsed : 0n,
    syUnused: syIn > syUsed ? syIn - syUsed : 0n,
    limitingSide: lpByPt === lpBySy ? "balanced" : lpByPt < lpBySy ? "PT" : "SY",
    shareBpsAfter: totalLpAfter > 0n ? (lpOut * BPS_DENOMINATOR) / totalLpAfter : 0n,
    reason: "ok",
  };
}

export function previewRemoveLiquidity({
  lpIn,
  totalPt,
  totalSy,
  totalLp,
}: PoolInputs & { lpIn: bigint }): RemoveLiquidityPreview {
  if (lpIn <= 0n) return zeroRemovePreview(lpIn, "invalid-input");
  if (totalPt <= 0n || totalSy <= 0n || totalLp <= 0n) {
    return zeroRemovePreview(lpIn, "empty-pool");
  }

  const ptOut = (lpIn * totalPt) / totalLp;
  const syOut = (lpIn * totalSy) / totalLp;
  if (ptOut === 0n && syOut === 0n) {
    return zeroRemovePreview(lpIn, "insufficient-liquidity");
  }

  return {
    lpIn,
    ptOut,
    syOut,
    shareBps: (lpIn * BPS_DENOMINATOR) / totalLp,
    reason: "ok",
  };
}
