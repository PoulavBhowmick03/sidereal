// SPDX-License-Identifier: Apache-2.0

import {
  StellarYT,
  type BlendPosition,
  type BlendRates,
  type LpPosition,
  type MarketState,
  type Position,
  type Quote,
  type SwapArgs,
} from "@sidereal/sdk";
import { appConfig, isDeployed, type AppConfig } from "./config";

const READ_RETRY_DELAYS_MS = [0, 400, 1_200, 3_000] as const;

/** Builds a StellarYT client from the current public app config. */
export function makeClient(
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): StellarYT {
  return new StellarYT({
    rpcUrl: cfg.rpcUrl,
    rpcFallbackUrls: cfg.rpcFallbackUrls,
    networkPassphrase: cfg.networkPassphrase,
    simulationSourceAccount,
    contracts: cfg.contracts,
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableReadError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message} ${error.stack ?? ""}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const normalized = text.toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch failed") ||
    normalized.includes("networkerror") ||
    normalized.includes("network error") ||
    normalized.includes("socket hang up") ||
    normalized.includes("429") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("tryagainlater")
  );
}

async function withReadClient<T>(
  cfg: AppConfig,
  simulationSourceAccount: string,
  reader: (client: StellarYT) => Promise<T>,
): Promise<T> {
  const client = makeClient(cfg, simulationSourceAccount);
  let lastError: unknown = new Error("No Soroban RPC URL configured");

  for (let attempt = 0; attempt < READ_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await reader(client);
    } catch (error) {
      lastError = error;
      if (!retryableReadError(error) || attempt === READ_RETRY_DELAYS_MS.length - 1) {
        break;
      }
      await sleep(READ_RETRY_DELAYS_MS[attempt + 1] ?? 0);
    }
  }

  throw lastError;
}

/**
 * Reads market state, returning null instead of throwing when the market is not
 * yet deployed or the RPC read fails. Lets pages render a fallback state during
 * temporary mainnet RPC instability as well as undeployed local profiles.
 */
export async function getMarketSafe(cfg: AppConfig = appConfig()): Promise<MarketState | null> {
  if (!isDeployed(cfg)) {
    return null;
  }
  try {
    return await withReadClient(cfg, cfg.simulationSourceAccount, (client) =>
      client.getMarket(cfg.marketId),
    );
  } catch {
    return null;
  }
}

export function readPosition(
  holder: string,
  marketId: string,
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): Promise<Position> {
  return withReadClient(cfg, simulationSourceAccount, (client) =>
    client.getPosition(holder, marketId),
  );
}

export function readLpPosition(
  holder: string,
  marketId: string,
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): Promise<LpPosition> {
  return withReadClient(cfg, simulationSourceAccount, (client) =>
    client.getLpPosition(holder, marketId),
  );
}

export function readTokenBalance(
  tokenContract: string,
  holder: string,
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): Promise<bigint> {
  return withReadClient(cfg, simulationSourceAccount, (client) =>
    client.getTokenBalance(tokenContract, holder),
  );
}

export function readBlendRates(
  pool: string,
  asset: string,
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): Promise<BlendRates> {
  return withReadClient(cfg, simulationSourceAccount, (client) =>
    client.getBlendRates(pool, asset),
  );
}

export function readBlendPosition(
  pool: string,
  asset: string,
  holder: string,
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): Promise<BlendPosition> {
  return withReadClient(cfg, simulationSourceAccount, (client) =>
    client.getBlendPosition(pool, asset, holder),
  );
}

export function readQuote(
  args: SwapArgs,
  cfg: AppConfig = appConfig(),
  simulationSourceAccount = cfg.simulationSourceAccount,
): Promise<Quote> {
  return withReadClient(cfg, simulationSourceAccount, (client) => client.quoteSwap(args));
}
