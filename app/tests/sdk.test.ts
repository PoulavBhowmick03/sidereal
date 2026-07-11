// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_PASSPHRASE, type AppConfig } from "../lib/config";

const { constructorArgs, getPositionMock, getTokenBalanceMock } = vi.hoisted(() => ({
  constructorArgs: [] as Array<Record<string, unknown>>,
  getPositionMock: vi.fn(),
  getTokenBalanceMock: vi.fn(),
}));

vi.mock("@sidereal/sdk", () => {
  class MockStellarYT {
    constructor(args: Record<string, unknown>) {
      constructorArgs.push(args);
    }

    getPosition(holder: string, marketId: string) {
      return getPositionMock(holder, marketId);
    }

    getTokenBalance(tokenContract: string, holder: string) {
      return getTokenBalanceMock(tokenContract, holder);
    }
  }

  return { StellarYT: MockStellarYT };
});

import { readPosition, readTokenBalance } from "../lib/sdk";

const cfg: AppConfig = {
  network: "public",
  rpcUrl: "https://primary-rpc.example",
  rpcFallbackUrls: ["https://fallback-rpc.example"],
  networkPassphrase: PUBLIC_PASSPHRASE,
  simulationSourceAccount: "GSIMULATIONACCOUNT00000000000000000000000000000000000000000",
  blendFaucetUrl: "",
  friendbotUrl: "",
  horizonUrl: "https://horizon.stellar.org",
  blendAppUrl: "https://blend.capital",
  marketId: "blend-usdc-q3",
  decimals: 7,
  yieldSource: {
    kind: "blend",
    name: "Blend FixedV2 USDC pool",
    poolAddress: "CPOOL",
    reserveAddress: "CRESERVE",
    reserveAsset: "USDC:GISSUER",
    docsUrl: "https://docs.blend.capital/",
  },
  contracts: {
    sy: "CSY",
    pt: "CPT",
    yt: "CYT",
    tokenizer: "CTOKENIZER",
    market: "CMARKET",
  },
};

afterEach(() => {
  constructorArgs.length = 0;
  getPositionMock.mockReset();
  getTokenBalanceMock.mockReset();
});

describe("readPosition", () => {
  it("retries a timeout and keeps the configured fallback URLs on the client", async () => {
    const expected = {
      holder: "GUSER",
      marketId: cfg.marketId,
      syBalance: 1n,
      ptBalance: 2n,
      ytBalance: 3n,
      claimableYield: 4n,
      lpBalance: 5n,
    };
    getPositionMock
      .mockRejectedValueOnce(new Error("fetch failed: timeout from primary rpc"))
      .mockResolvedValueOnce(expected);

    await expect(readPosition("GUSER", cfg.marketId, cfg, "GUSER")).resolves.toEqual(expected);

    expect(getPositionMock).toHaveBeenCalledTimes(2);
    expect(getPositionMock).toHaveBeenNthCalledWith(1, "GUSER", cfg.marketId);
    expect(getPositionMock).toHaveBeenNthCalledWith(2, "GUSER", cfg.marketId);
    expect(constructorArgs).toEqual([
      expect.objectContaining({
        rpcUrl: cfg.rpcUrl,
        rpcFallbackUrls: cfg.rpcFallbackUrls,
        networkPassphrase: cfg.networkPassphrase,
        simulationSourceAccount: "GUSER",
        contracts: cfg.contracts,
      }),
    ]);
  });

  it("defaults the simulation source to the configured funded account, not the holder", async () => {
    // A holder-scoped read must not use the holder's own address to build the
    // Soroban simulation envelope: a brand-new wallet that has never received
    // XLM has no on-chain account yet, so RPC's getAccount() throws "Account
    // not found" before the actual balance/position query is even attempted.
    // The simulation source only pays a phantom simulation fee and is never
    // read by the contract call itself (holder is always passed as an
    // explicit parameter), so it must be a stable, always-funded account
    // decoupled from whichever wallet is being queried.
    getPositionMock.mockResolvedValueOnce({
      holder: "GUSER",
      marketId: cfg.marketId,
      syBalance: 1n,
      ptBalance: 2n,
      ytBalance: 3n,
      claimableYield: 4n,
      lpBalance: 5n,
    });

    await readPosition("GUSER", cfg.marketId, cfg);

    expect(constructorArgs).toEqual([
      expect.objectContaining({ simulationSourceAccount: cfg.simulationSourceAccount }),
    ]);
  });
});

describe("readTokenBalance", () => {
  it("defaults the simulation source to the configured funded account, not the holder", async () => {
    // Regression test for the mint-page bug: a freshly connected mainnet
    // wallet with no on-chain account yet could not read its own USDC
    // balance, because the simulation source account defaulted to the
    // (nonexistent) holder address. See readPosition's equivalent test above
    // for the full mechanism.
    getTokenBalanceMock.mockResolvedValueOnce(0n);

    await readTokenBalance("CUSDC", "GBRANDNEWWALLET", cfg);

    expect(constructorArgs).toEqual([
      expect.objectContaining({ simulationSourceAccount: cfg.simulationSourceAccount }),
    ]);
  });
});
