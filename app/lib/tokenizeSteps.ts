// SPDX-License-Identifier: Apache-2.0

import {
  WAD,
  type Asset,
  type BlendPosition,
  type MarketState,
  type Position,
  type Quote,
  type SwapArgs,
  type TransactionEnvelope,
} from "@sidereal/sdk";
import type { YieldSourceConfig } from "./config";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "./slippage";

export type TokenizeBlendMode = "keep" | "fixed";

export interface TokenizeBlendStep {
  label: string;
  build: () => Promise<TransactionEnvelope>;
}

export interface TokenizeBlendClient {
  buildBlendWithdraw(args: {
    from: string;
    pool: string;
    asset: string;
    supplyAmount: bigint;
    collateralAmount: bigint;
  }): Promise<TransactionEnvelope>;
  getTokenBalance(tokenContract: string, holder: string): Promise<bigint>;
  buildDeposit(args: {
    marketId: string;
    from: string;
    underlyingAmount: bigint;
  }): Promise<TransactionEnvelope>;
  getPosition(holder: string, marketId: string): Promise<Position>;
  buildSplit(args: { from: string; syAmount: bigint }): Promise<TransactionEnvelope>;
  quoteSwap(args: SwapArgs): Promise<Quote>;
  buildSwap(args: SwapArgs): Promise<TransactionEnvelope>;
}

export function estimateBlendTokenizationFace(
  market: Pick<MarketState, "exchangeRate"> | null,
  position: Pick<BlendPosition, "underlyingValue"> | null,
): { faceAmount: bigint } {
  if (market === null || position === null || position.underlyingValue <= 0n) {
    return { faceAmount: 0n };
  }
  const syAmount = (position.underlyingValue * WAD) / market.exchangeRate;
  return { faceAmount: (syAmount * market.exchangeRate) / WAD };
}

export async function buildTokenizeBlendSteps({
  client,
  marketId,
  source,
  address,
  market,
  position,
  mode,
}: {
  client: TokenizeBlendClient;
  marketId: string;
  source: YieldSourceConfig;
  address: string;
  market: Pick<MarketState, "underlying" | "exchangeRate">;
  position: Pick<BlendPosition, "supplyValue" | "collateralValue" | "underlyingValue">;
  mode: TokenizeBlendMode;
}): Promise<TokenizeBlendStep[]> {
  if (source.kind !== "blend") {
    throw new Error("Blend tokenization requires a Blend yield source");
  }

  const migrateTarget = position.underlyingValue;
  let depositAmount = 0n;
  const initialYtBalance =
    mode === "fixed" ? (await client.getPosition(address, marketId)).ytBalance : 0n;

  const steps: TokenizeBlendStep[] = [
    {
      label: "Withdraw from Blend",
      build: () =>
        client.buildBlendWithdraw({
          from: address,
          pool: source.poolAddress,
          asset: source.reserveAddress,
          supplyAmount: position.supplyValue > 0n ? position.supplyValue + 1n : 0n,
          collateralAmount: position.collateralValue > 0n ? position.collateralValue + 1n : 0n,
        }),
    },
    {
      label: "Deposit",
      build: async () => {
        const balance = await client.getTokenBalance(market.underlying, address);
        depositAmount = balance < migrateTarget ? balance : migrateTarget;
        return client.buildDeposit({
          marketId,
          from: address,
          underlyingAmount: depositAmount,
        });
      },
    },
    {
      label: "Split",
      build: async () => {
        const computed = (depositAmount * WAD) / market.exchangeRate;
        const held = await client.getPosition(address, marketId);
        const syAmount = held.syBalance < computed ? held.syBalance : computed;
        return client.buildSplit({ from: address, syAmount });
      },
    },
  ];

  if (mode === "fixed") {
    steps.push({
      label: "Sell YT",
      build: async () => {
        const held = await client.getPosition(address, marketId);
        const amountIn = held.ytBalance - initialYtBalance;
        if (amountIn <= 0n) {
          throw new Error("no YT available to sell after split");
        }
        const quote = await client.quoteSwap({
          marketId,
          from: address,
          assetIn: "YT" as Asset,
          assetOut: "SY" as Asset,
          amountIn,
          minAmountOut: 0n,
        });
        return client.buildSwap({
          marketId,
          from: address,
          assetIn: "YT" as Asset,
          assetOut: "SY" as Asset,
          amountIn,
          minAmountOut: applySlippage(quote.amountOut, DEFAULT_SLIPPAGE_BPS),
        });
      },
    });
  }

  return steps;
}
