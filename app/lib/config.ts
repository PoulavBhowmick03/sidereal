// SPDX-License-Identifier: Apache-2.0

import type { ContractAddresses } from "@sidereal/sdk";

/**
 * Public runtime configuration, sourced from NEXT_PUBLIC_* env vars. These are
 * all public values (RPC URL, network passphrase, deployed contract addresses).
 * No secrets or private keys live here, ever (AGENTS.md non-negotiable #5).
 */

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const TESTNET_RPC = "https://soroban-testnet.stellar.org";

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export interface AppConfig {
  rpcUrl: string;
  networkPassphrase: string;
  marketId: string;
  /** Base-unit decimals for SY/PT/YT (Stellar USDC is 7). Display only. */
  decimals: number;
  contracts: ContractAddresses;
}

export function appConfig(): AppConfig {
  return {
    rpcUrl: env("NEXT_PUBLIC_SOROBAN_RPC_URL", TESTNET_RPC),
    networkPassphrase: env("NEXT_PUBLIC_NETWORK_PASSPHRASE", TESTNET_PASSPHRASE),
    marketId: env("NEXT_PUBLIC_MARKET_ID", "blend-usdc-q3"),
    decimals: Number(env("NEXT_PUBLIC_TOKEN_DECIMALS", "7")),
    contracts: {
      sy: env("NEXT_PUBLIC_SY_ADDRESS"),
      pt: env("NEXT_PUBLIC_PT_ADDRESS"),
      yt: env("NEXT_PUBLIC_YT_ADDRESS"),
      tokenizer: env("NEXT_PUBLIC_TOKENIZER_ADDRESS"),
      market: env("NEXT_PUBLIC_MARKET_ADDRESS"),
    },
  };
}

/** True once every contract address is configured (i.e. the market is deployed). */
export function isDeployed(cfg: AppConfig): boolean {
  return Object.values(cfg.contracts).every((addr) => addr.length > 0);
}
