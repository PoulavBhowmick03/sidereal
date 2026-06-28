// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appConfig,
  isDeployed,
  TESTNET_PASSPHRASE,
  TESTNET_RPC,
  TESTNET_SIMULATION_SOURCE,
} from "../lib/config";

const contractEnv = {
  NEXT_PUBLIC_SY_ADDRESS: "C_SY",
  NEXT_PUBLIC_PT_ADDRESS: "C_PT",
  NEXT_PUBLIC_YT_ADDRESS: "C_YT",
  NEXT_PUBLIC_TOKENIZER_ADDRESS: "C_TOKENIZER",
  NEXT_PUBLIC_MARKET_ADDRESS: "C_MARKET",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appConfig", () => {
  it("reads every public contract address from its static environment reference", () => {
    for (const [name, value] of Object.entries(contractEnv)) {
      vi.stubEnv(name, value);
    }

    const cfg = appConfig();

    expect(cfg.contracts).toEqual({
      sy: "C_SY",
      pt: "C_PT",
      yt: "C_YT",
      tokenizer: "C_TOKENIZER",
      market: "C_MARKET",
    });
    expect(isDeployed(cfg)).toBe(true);
  });

  it("uses testnet defaults and remains undeployed when addresses are empty", () => {
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_NETWORK_PASSPHRASE", "");
    vi.stubEnv("NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_MARKET_ID", "");
    vi.stubEnv("NEXT_PUBLIC_TOKEN_DECIMALS", "");
    for (const name of Object.keys(contractEnv)) {
      vi.stubEnv(name, "");
    }

    const cfg = appConfig();

    expect(cfg.rpcUrl).toBe(TESTNET_RPC);
    expect(cfg.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(cfg.simulationSourceAccount).toBe(TESTNET_SIMULATION_SOURCE);
    expect(cfg.marketId).toBe("blend-usdc-q3");
    expect(cfg.decimals).toBe(7);
    expect(isDeployed(cfg)).toBe(false);
  });
});
