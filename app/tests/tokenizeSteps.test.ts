// SPDX-License-Identifier: Apache-2.0

import type { Position, Quote, TransactionEnvelope } from "@sidereal/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildTokenizeBlendSteps,
  estimateBlendTokenizationFace,
  type TokenizeBlendClient,
} from "../lib/tokenizeSteps";

const WAD = 1_000_000_000_000_000_000n;
const address = "GUSER";
const marketId = "blend-usdc-q3";
const source = {
  kind: "blend" as const,
  name: "Blend v2 USDC pool",
  poolAddress: "CPOOL",
  reserveAddress: "CUSDC",
  reserveAsset: "USDC:GISSUER",
  docsUrl: "https://testnet.blend.capital",
};
const market = {
  underlying: "CUSDC",
  exchangeRate: 2n * WAD,
};
const position = {
  supplyValue: 100n,
  collateralValue: 50n,
  underlyingValue: 140n,
};

function env(label: string): TransactionEnvelope {
  return { xdr: `${label}-xdr`, networkPassphrase: "Test SDF Network ; September 2015" };
}

function sdkPosition(overrides: Partial<Position>): Position {
  return {
    holder: address,
    marketId,
    syBalance: 0n,
    ptBalance: 0n,
    ytBalance: 0n,
    claimableYield: 0n,
    lpBalance: 0n,
    ...overrides,
  };
}

function quote(overrides: Partial<Quote>): Quote {
  return {
    assetIn: "YT",
    assetOut: "SY",
    amountIn: 0n,
    amountOut: 0n,
    priceImpactBps: 0n,
    impliedApyBps: 0n,
    ...overrides,
  };
}

function clientMock(overrides: Partial<TokenizeBlendClient> = {}): TokenizeBlendClient {
  return {
    buildBlendWithdraw: vi.fn(async () => env("withdraw")),
    getTokenBalance: vi.fn(async () => 100n),
    buildDeposit: vi.fn(async () => env("deposit")),
    getPosition: vi.fn(async () => sdkPosition({ syBalance: 50n })),
    buildSplit: vi.fn(async () => env("split")),
    quoteSwap: vi.fn(async () => quote({ amountOut: 10_000n })),
    buildSwap: vi.fn(async () => env("swap")),
    ...overrides,
  };
}

describe("estimateBlendTokenizationFace", () => {
  it("returns zero until both market and position are available", () => {
    expect(estimateBlendTokenizationFace(null, null)).toEqual({ faceAmount: 0n });
  });

  it("estimates the asset-unit PT and YT face amount", () => {
    expect(
      estimateBlendTokenizationFace({ exchangeRate: 2n * WAD }, { underlyingValue: 101n }),
    ).toEqual({ faceAmount: 100n });
  });
});

describe("buildTokenizeBlendSteps", () => {
  it("builds the three-step keep flow and clamps the deposit to wallet balance", async () => {
    const client = clientMock();

    const steps = await buildTokenizeBlendSteps({
      client,
      marketId,
      source,
      address,
      market,
      position,
      mode: "keep",
    });

    expect(steps.map((step) => step.label)).toEqual(["Withdraw from Blend", "Deposit", "Split"]);
    await steps[0]!.build();
    await steps[1]!.build();
    await steps[2]!.build();

    expect(client.buildBlendWithdraw).toHaveBeenCalledWith({
      from: address,
      pool: source.poolAddress,
      asset: source.reserveAddress,
      supplyAmount: 101n,
      collateralAmount: 51n,
    });
    expect(client.buildDeposit).toHaveBeenCalledWith({
      marketId,
      from: address,
      underlyingAmount: 100n,
    });
    expect(client.buildSplit).toHaveBeenCalledWith({ from: address, syAmount: 50n });
  });

  it("sells only the newly minted YT in fixed mode", async () => {
    const client = clientMock({
      getTokenBalance: vi.fn(async () => 140n),
      getPosition: vi
        .fn()
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ syBalance: 70n, ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ syBalance: 0n, ytBalance: 175n })),
    });

    const steps = await buildTokenizeBlendSteps({
      client,
      marketId,
      source,
      address,
      market,
      position,
      mode: "fixed",
    });

    expect(steps.map((step) => step.label)).toEqual([
      "Withdraw from Blend",
      "Deposit",
      "Split",
      "Sell YT",
    ]);
    await steps[1]!.build();
    await steps[2]!.build();
    await steps[3]!.build();

    expect(client.quoteSwap).toHaveBeenCalledWith({
      marketId,
      from: address,
      assetIn: "YT",
      assetOut: "SY",
      amountIn: 75n,
      minAmountOut: 0n,
    });
    expect(client.buildSwap).toHaveBeenCalledWith({
      marketId,
      from: address,
      assetIn: "YT",
      assetOut: "SY",
      amountIn: 75n,
      minAmountOut: 9_950n,
    });
  });

  it("rejects fixed mode when the split produced no new YT", async () => {
    const client = clientMock({
      getPosition: vi
        .fn()
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n })),
    });

    const steps = await buildTokenizeBlendSteps({
      client,
      marketId,
      source,
      address,
      market,
      position,
      mode: "fixed",
    });

    await expect(steps[3]!.build()).rejects.toThrow(/no YT available to sell after split/);
    expect(client.quoteSwap).not.toHaveBeenCalled();
    expect(client.buildSwap).not.toHaveBeenCalled();
  });
});
