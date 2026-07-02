// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appConfig,
  isDeployed,
  TESTNET_BLEND_POOL,
  TESTNET_BLEND_USDC,
  TESTNET_BLEND_USDC_ASSET,
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

// The test runner may inherit a real deployment's env (check-frontend-testnet.sh
// exports app/.env.local), so fallback tests must clear these explicitly.
const yieldSourceEnvNames = [
  "NEXT_PUBLIC_YIELD_SOURCE_KIND",
  "NEXT_PUBLIC_YIELD_SOURCE_NAME",
  "NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS",
  "NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS",
  "NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ASSET",
  "NEXT_PUBLIC_YIELD_SOURCE_URL",
];

function stubYieldSourceEnv(overrides: Record<string, string> = {}): void {
  for (const name of yieldSourceEnvNames) {
    vi.stubEnv(name, overrides[name] ?? "");
  }
}

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
    stubYieldSourceEnv();
    for (const name of Object.keys(contractEnv)) {
      vi.stubEnv(name, "");
    }

    const cfg = appConfig();

    expect(cfg.rpcUrl).toBe(TESTNET_RPC);
    expect(cfg.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(cfg.simulationSourceAccount).toBe(TESTNET_SIMULATION_SOURCE);
    expect(cfg.marketId).toBe("blend-usdc-q3");
    expect(cfg.decimals).toBe(7);
    expect(cfg.yieldSource.kind).toBe("mock");
    expect(isDeployed(cfg)).toBe(false);
  });

  it("reads Blend yield-source metadata from static environment references", () => {
    stubYieldSourceEnv({
      NEXT_PUBLIC_YIELD_SOURCE_KIND: "blend",
      NEXT_PUBLIC_YIELD_SOURCE_NAME: "Blend test market",
      NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS: TESTNET_BLEND_POOL,
      NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS: TESTNET_BLEND_USDC,
      NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ASSET: TESTNET_BLEND_USDC_ASSET,
      NEXT_PUBLIC_YIELD_SOURCE_URL: "https://docs.blend.capital/",
    });

    const cfg = appConfig();

    expect(cfg.yieldSource).toEqual({
      kind: "blend",
      name: "Blend test market",
      poolAddress: TESTNET_BLEND_POOL,
      reserveAddress: TESTNET_BLEND_USDC,
      reserveAsset: TESTNET_BLEND_USDC_ASSET,
      docsUrl: "https://docs.blend.capital/",
    });
  });

  it("falls back to mock metadata for invalid yield-source kind values", () => {
    stubYieldSourceEnv({ NEXT_PUBLIC_YIELD_SOURCE_KIND: "unknown" });

    const cfg = appConfig();

    expect(cfg.yieldSource.kind).toBe("mock");
    expect(cfg.yieldSource.name).toBe("Simulated testnet rate");
  });
});
