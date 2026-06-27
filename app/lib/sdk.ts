// SPDX-License-Identifier: Apache-2.0

import { StellarYT, type MarketState } from "@sidereal/sdk";
import { appConfig, isDeployed, type AppConfig } from "./config";

/** Builds a StellarYT client from the current public app config. */
export function makeClient(
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): StellarYT {
  return new StellarYT({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    simulationSourceAccount,
    contracts: cfg.contracts,
  });
}

/**
 * Reads market state, returning null instead of throwing when the market is not
 * yet deployed or the RPC read fails. Lets pages render a placeholder rather
 * than crashing during the testnet build-out.
 */
export async function getMarketSafe(cfg: AppConfig = appConfig()): Promise<MarketState | null> {
  if (!isDeployed(cfg)) {
    return null;
  }
  try {
    return await makeClient(cfg).getMarket(cfg.marketId);
  } catch {
    return null;
  }
}
