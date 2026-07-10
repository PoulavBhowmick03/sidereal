// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_PASSPHRASE, type AppConfig } from "../lib/config";

const { constructorArgs, getPositionMock } = vi.hoisted(() => ({
  constructorArgs: [] as Array<Record<string, unknown>>,
  getPositionMock: vi.fn(),
}));

vi.mock("@sidereal/sdk", () => {
  class MockStellarYT {
    constructor(args: Record<string, unknown>) {
      constructorArgs.push(args);
    }

    getPosition(holder: string, marketId: string) {
      return getPositionMock(holder, marketId);
    }
  }

  return { StellarYT: MockStellarYT };
});

import { readPosition } from "../lib/sdk";

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
});
