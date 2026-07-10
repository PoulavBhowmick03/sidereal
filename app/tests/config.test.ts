// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appConfig,
  DEFAULT_BLEND_FAUCET_URL,
  DEFAULT_FRIENDBOT_URL,
  isDeployed,
  MAINNET_BLEND_POOL,
  MAINNET_BLEND_USDC,
  MAINNET_BLEND_USDC_ASSET,
  MAINNET_HORIZON_URL,
  MAINNET_RPC,
  MAINNET_RPC_FALLBACK,
  MAINNET_RPC_FALLBACKS,
  MAINNET_SIMULATION_SOURCE,
  PUBLIC_PASSPHRASE,
  TESTNET_BLEND_POOL,
  TESTNET_BLEND_USDC,
  TESTNET_BLEND_USDC_ASSET,
  TESTNET_HORIZON_URL,
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
    vi.stubEnv("NEXT_PUBLIC_BLEND_FAUCET_URL", "https://faucet.example/getAssets");
    vi.stubEnv("NEXT_PUBLIC_FRIENDBOT_URL", "https://friendbot.example");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_HORIZON_URL", "https://horizon.example");
    vi.stubEnv("NEXT_PUBLIC_BLEND_APP_URL", "https://blend.example");

    const cfg = appConfig();

    expect(cfg.contracts).toEqual({
      sy: "C_SY",
      pt: "C_PT",
      yt: "C_YT",
      tokenizer: "C_TOKENIZER",
      market: "C_MARKET",
    });
    expect(cfg.blendFaucetUrl).toBe("https://faucet.example/getAssets");
    expect(cfg.friendbotUrl).toBe("https://friendbot.example");
    expect(cfg.horizonUrl).toBe("https://horizon.example");
    expect(cfg.blendAppUrl).toBe("");
    expect(isDeployed(cfg)).toBe(true);
  });

  it("uses testnet defaults and remains undeployed when addresses are empty", () => {
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URLS", "");
    vi.stubEnv("NEXT_PUBLIC_NETWORK_PASSPHRASE", "");
    vi.stubEnv("NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_BLEND_FAUCET_URL", "");
    vi.stubEnv("NEXT_PUBLIC_FRIENDBOT_URL", "");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_HORIZON_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BLEND_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_MARKET_ID", "");
    vi.stubEnv("NEXT_PUBLIC_TOKEN_DECIMALS", "");
    stubYieldSourceEnv();
    for (const name of Object.keys(contractEnv)) {
      vi.stubEnv(name, "");
    }

    const cfg = appConfig();

    expect(cfg.network).toBe("testnet");
    expect(cfg.rpcUrl).toBe(TESTNET_RPC);
    expect(cfg.rpcFallbackUrls).toEqual([]);
    expect(cfg.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(cfg.simulationSourceAccount).toBe(TESTNET_SIMULATION_SOURCE);
    expect(cfg.blendFaucetUrl).toBe(DEFAULT_BLEND_FAUCET_URL);
    expect(cfg.friendbotUrl).toBe(DEFAULT_FRIENDBOT_URL);
    expect(cfg.horizonUrl).toBe(TESTNET_HORIZON_URL);
    expect(cfg.blendAppUrl).toBe("");
    expect(cfg.marketId).toBe("blend-usdc-q3");
    expect(cfg.decimals).toBe(7);
    expect(cfg.yieldSource.kind).toBe("mock");
    expect(isDeployed(cfg)).toBe(false);
  });

  it("derives mainnet Blend defaults from the configured public network", () => {
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URLS", "");
    vi.stubEnv("NEXT_PUBLIC_NETWORK_PASSPHRASE", PUBLIC_PASSPHRASE);
    vi.stubEnv("NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_BLEND_FAUCET_URL", "https://faucet.example/getAssets");
    vi.stubEnv("NEXT_PUBLIC_FRIENDBOT_URL", "https://friendbot.example");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_HORIZON_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BLEND_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_MARKET_ID", "");
    vi.stubEnv("NEXT_PUBLIC_TOKEN_DECIMALS", "");
    stubYieldSourceEnv({ NEXT_PUBLIC_YIELD_SOURCE_KIND: "blend" });
    for (const name of Object.keys(contractEnv)) {
      vi.stubEnv(name, "");
    }

    const cfg = appConfig();

    expect(cfg.network).toBe("public");
    expect(cfg.rpcUrl).toBe(MAINNET_RPC);
    expect(cfg.rpcFallbackUrls).toEqual(MAINNET_RPC_FALLBACKS);
    expect(cfg.networkPassphrase).toBe(PUBLIC_PASSPHRASE);
    expect(cfg.simulationSourceAccount).toBe(MAINNET_SIMULATION_SOURCE);
    expect(cfg.blendFaucetUrl).toBe("");
    expect(cfg.friendbotUrl).toBe("");
    expect(cfg.horizonUrl).toBe(MAINNET_HORIZON_URL);
    expect(cfg.blendAppUrl).toBe("https://blend.capital");
    expect(cfg.yieldSource).toEqual({
      kind: "blend",
      name: "Blend FixedV2 USDC pool",
      poolAddress: MAINNET_BLEND_POOL,
      reserveAddress: MAINNET_BLEND_USDC,
      reserveAsset: MAINNET_BLEND_USDC_ASSET,
      docsUrl: "https://docs.blend.capital/",
    });
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

  it("parses multiple RPC fallbacks from the public env surface", () => {
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URL", MAINNET_RPC_FALLBACK);
    vi.stubEnv(
      "NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URLS",
      "https://stellar.api.onfinality.io/public, https://rpc.ankr.com/stellar_soroban",
    );

    const cfg = appConfig();

    expect(cfg.rpcFallbackUrls).toEqual([
      MAINNET_RPC_FALLBACK,
      "https://stellar.api.onfinality.io/public",
      "https://rpc.ankr.com/stellar_soroban",
    ]);
  });

  it("falls back to mock metadata for invalid yield-source kind values", () => {
    stubYieldSourceEnv({ NEXT_PUBLIC_YIELD_SOURCE_KIND: "unknown" });

    const cfg = appConfig();

    expect(cfg.yieldSource.kind).toBe("mock");
    expect(cfg.yieldSource.name).toBe("Simulated rate");
  });
});
