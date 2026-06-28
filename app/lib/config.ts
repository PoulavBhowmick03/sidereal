// SPDX-License-Identifier: Apache-2.0

import type { ContractAddresses } from "@sidereal/sdk";

/**
 * Public runtime configuration, sourced from NEXT_PUBLIC_* env vars. These are
 * all public values (RPC URL, network passphrase, deployed contract addresses).
 * No secrets or private keys live here, ever (AGENTS.md non-negotiable #5).
 */

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const TESTNET_SIMULATION_SOURCE =
  "GBGHELMOABS7WCYOMJTWQRGQ6VZYLYXXMLE7JJAHJ6I4WW7FMJSDERN3";

function publicEnv(value: string | undefined, fallback = ""): string {
  return value === undefined || value === "" ? fallback : value;
}

export interface AppConfig {
  rpcUrl: string;
  networkPassphrase: string;
  /** Public funded G-account used only to source unconnected read simulations. */
  simulationSourceAccount: string;
  marketId: string;
  /** Base-unit decimals for SY/PT/YT (Stellar USDC is 7). Display only. */
  decimals: number;
  contracts: ContractAddresses;
}

export function appConfig(): AppConfig {
  return {
    // Keep every NEXT_PUBLIC_* access static. Next.js only inlines direct
    // property references into browser bundles; process.env[name] is not
    // replaced at build time.
    rpcUrl: publicEnv(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL, TESTNET_RPC),
    networkPassphrase: publicEnv(
      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
      TESTNET_PASSPHRASE,
    ),
    simulationSourceAccount: publicEnv(
      process.env.NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS,
      TESTNET_SIMULATION_SOURCE,
    ),
    marketId: publicEnv(process.env.NEXT_PUBLIC_MARKET_ID, "blend-usdc-q3"),
    decimals: Number(publicEnv(process.env.NEXT_PUBLIC_TOKEN_DECIMALS, "7")),
    contracts: {
      sy: publicEnv(process.env.NEXT_PUBLIC_SY_ADDRESS),
      pt: publicEnv(process.env.NEXT_PUBLIC_PT_ADDRESS),
      yt: publicEnv(process.env.NEXT_PUBLIC_YT_ADDRESS),
      tokenizer: publicEnv(process.env.NEXT_PUBLIC_TOKENIZER_ADDRESS),
      market: publicEnv(process.env.NEXT_PUBLIC_MARKET_ADDRESS),
    },
  };
}

/** True once every contract address is configured (i.e. the market is deployed). */
export function isDeployed(cfg: AppConfig): boolean {
  return Object.values(cfg.contracts).every((addr) => addr.length > 0);
}
