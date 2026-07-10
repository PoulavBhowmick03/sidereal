// SPDX-License-Identifier: Apache-2.0

import type { ContractAddresses } from "@sidereal/sdk";

/**
 * Public runtime configuration, sourced from NEXT_PUBLIC_* env vars. These are
 * all public values (RPC URL, network passphrase, deployed contract addresses).
 * No secrets or private keys live here.
 */

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";
export const TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const MAINNET_RPC = "https://soroban-rpc.mainnet.stellar.gateway.fm";
export const MAINNET_RPC_FALLBACK = "https://mainnet.sorobanrpc.com";
export const MAINNET_RPC_ONFINALITY = "https://stellar.api.onfinality.io/public";
export const MAINNET_RPC_LIGHTSAIL = "https://rpc.lightsail.network/";
export const MAINNET_RPC_ANKR = "https://rpc.ankr.com/stellar_soroban";
export const MAINNET_RPC_FALLBACKS = [
  MAINNET_RPC_FALLBACK,
  MAINNET_RPC_ONFINALITY,
  MAINNET_RPC_LIGHTSAIL,
  MAINNET_RPC_ANKR,
] as const;
// Same-origin proxy (app/app/api/faucet/route.ts). The Blend faucet only
// allows the blend.capital origin via CORS, so the browser cannot call it
// directly; the proxy relays the request server-side.
export const DEFAULT_BLEND_FAUCET_URL = "/api/faucet";
export const DEFAULT_FRIENDBOT_URL = "https://friendbot.stellar.org";
export const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const MAINNET_HORIZON_URL = "https://horizon.stellar.org";
export const TESTNET_SIMULATION_SOURCE =
  "GBGHELMOABS7WCYOMJTWQRGQ6VZYLYXXMLE7JJAHJ6I4WW7FMJSDERN3";
export const MAINNET_SIMULATION_SOURCE =
  "GDQX3RT7YJYPKCB3Z2BG3EYBRBI62DWGGZYW54U6KLVRYVUYIUUVYRG3";
export const TESTNET_BLEND_POOL =
  "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF";
export const TESTNET_BLEND_USDC =
  "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU";
export const TESTNET_BLEND_USDC_ASSET =
  "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
export const MAINNET_BLEND_POOL =
  "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";
export const MAINNET_BLEND_USDC =
  "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
export const MAINNET_BLEND_USDC_ASSET =
  "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const TESTNET_BLEND_APP_URL = "https://testnet.blend.capital";
export const MAINNET_BLEND_APP_URL = "https://blend.capital";

export type AppNetwork = "testnet" | "public" | "custom";

interface BlendNetworkDefaults {
  poolAddress: string;
  reserveAddress: string;
  reserveAsset: string;
  rpcUrl: string;
  simulationSourceAccount: string;
  horizonUrl: string;
  blendAppUrl: string;
}

function publicEnv(value: string | undefined, fallback = ""): string {
  return value === undefined || value === "" ? fallback : value;
}

function publicEnvList(...values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (value ?? "").split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export interface AppConfig {
  network: AppNetwork;
  rpcUrl: string;
  rpcFallbackUrls: string[];
  networkPassphrase: string;
  /** Public funded G-account used only to source unconnected read simulations. */
  simulationSourceAccount: string;
  /** Blend testnet faucet endpoint (same-origin proxy by default). */
  blendFaucetUrl: string;
  /** Public Stellar testnet account-funding endpoint. */
  friendbotUrl: string;
  /** Horizon endpoint for classic transaction submission. */
  horizonUrl: string;
  /** Blend app URL for the configured network. */
  blendAppUrl: string;
  marketId: string;
  /** Base-unit decimals for SY/PT/YT (Stellar USDC is 7). Display only. */
  decimals: number;
  yieldSource: YieldSourceConfig;
  contracts: ContractAddresses;
}

export type YieldSourceKind = "mock" | "circle" | "blend";

export interface YieldSourceConfig {
  kind: YieldSourceKind;
  name: string;
  poolAddress: string;
  reserveAddress: string;
  reserveAsset: string;
  docsUrl: string;
}

function yieldSourceKind(value: string): YieldSourceKind {
  return value === "mock" || value === "circle" || value === "blend" ? value : "mock";
}

export function stellarNetworkKey(networkPassphrase: string): AppNetwork {
  if (networkPassphrase === TESTNET_PASSPHRASE) return "testnet";
  if (networkPassphrase === PUBLIC_PASSPHRASE) return "public";
  return "custom";
}

export function networkLabel(
  networkPassphrase: string,
  casing: "title" | "lower" = "title",
): string {
  const base =
    stellarNetworkKey(networkPassphrase) === "testnet"
      ? "testnet"
      : stellarNetworkKey(networkPassphrase) === "public"
        ? "mainnet"
        : "configured network";
  return casing === "lower" ? base : base.replace(/\b\w/g, (char) => char.toUpperCase());
}

function blendDefaultsFor(network: AppNetwork): BlendNetworkDefaults {
  switch (network) {
    case "public":
      return {
        poolAddress: MAINNET_BLEND_POOL,
        reserveAddress: MAINNET_BLEND_USDC,
        reserveAsset: MAINNET_BLEND_USDC_ASSET,
        rpcUrl: MAINNET_RPC,
        simulationSourceAccount: MAINNET_SIMULATION_SOURCE,
        horizonUrl: MAINNET_HORIZON_URL,
        blendAppUrl: MAINNET_BLEND_APP_URL,
      };
    case "testnet":
      return {
        poolAddress: TESTNET_BLEND_POOL,
        reserveAddress: TESTNET_BLEND_USDC,
        reserveAsset: TESTNET_BLEND_USDC_ASSET,
        rpcUrl: TESTNET_RPC,
        simulationSourceAccount: TESTNET_SIMULATION_SOURCE,
        horizonUrl: TESTNET_HORIZON_URL,
        blendAppUrl: TESTNET_BLEND_APP_URL,
      };
    case "custom":
      return {
        poolAddress: "",
        reserveAddress: "",
        reserveAsset: "",
        rpcUrl: "",
        simulationSourceAccount: "",
        horizonUrl: "",
        blendAppUrl: "",
      };
  }
}

export function appConfig(): AppConfig {
  const networkPassphrase = publicEnv(
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    TESTNET_PASSPHRASE,
  );
  const network = stellarNetworkKey(networkPassphrase);
  const blendDefaults = blendDefaultsFor(network);
  const yieldKind = yieldSourceKind(publicEnv(process.env.NEXT_PUBLIC_YIELD_SOURCE_KIND, "mock"));
  const testnetToolsEnabled = network === "testnet";
  const defaultRpcUrl =
    network === "public" ? MAINNET_RPC : network === "testnet" ? TESTNET_RPC : "";
  const defaultRpcFallbackUrls = network === "public" ? [...MAINNET_RPC_FALLBACKS] : [];
  const configuredRpcFallbackUrls = publicEnvList(
    process.env.NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URL,
    process.env.NEXT_PUBLIC_SOROBAN_RPC_FALLBACK_URLS,
  );
  const defaultSimulationSource =
    network === "public"
      ? MAINNET_SIMULATION_SOURCE
      : network === "testnet"
        ? TESTNET_SIMULATION_SOURCE
        : "";
  const defaultHorizonUrl =
    network === "public" ? MAINNET_HORIZON_URL : network === "testnet" ? TESTNET_HORIZON_URL : "";

  return {
    // Keep every NEXT_PUBLIC_* access static. Next.js only inlines direct
    // property references into browser bundles; process.env[name] is not
    // replaced at build time.
    network,
    rpcUrl: publicEnv(
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
      blendDefaults.rpcUrl || defaultRpcUrl,
    ),
    rpcFallbackUrls:
      configuredRpcFallbackUrls.length > 0 ? configuredRpcFallbackUrls : defaultRpcFallbackUrls,
    networkPassphrase,
    simulationSourceAccount: publicEnv(
      process.env.NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS,
      blendDefaults.simulationSourceAccount || defaultSimulationSource,
    ),
    blendFaucetUrl: testnetToolsEnabled
      ? publicEnv(process.env.NEXT_PUBLIC_BLEND_FAUCET_URL, DEFAULT_BLEND_FAUCET_URL)
      : "",
    friendbotUrl: testnetToolsEnabled
      ? publicEnv(process.env.NEXT_PUBLIC_FRIENDBOT_URL, DEFAULT_FRIENDBOT_URL)
      : "",
    horizonUrl: publicEnv(
      process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
      blendDefaults.horizonUrl || defaultHorizonUrl,
    ),
    blendAppUrl:
      yieldKind === "blend"
        ? publicEnv(process.env.NEXT_PUBLIC_BLEND_APP_URL, blendDefaults.blendAppUrl)
        : "",
    marketId: publicEnv(process.env.NEXT_PUBLIC_MARKET_ID, "blend-usdc-q3"),
    decimals: Number(publicEnv(process.env.NEXT_PUBLIC_TOKEN_DECIMALS, "7")),
    yieldSource: {
      kind: yieldKind,
      name: publicEnv(
        process.env.NEXT_PUBLIC_YIELD_SOURCE_NAME,
        yieldKind === "blend" ? "Blend FixedV2 USDC pool" : yieldKind === "circle" ? "Circle USDC" : "Simulated rate",
      ),
      poolAddress: publicEnv(
        process.env.NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS,
        yieldKind === "blend" ? blendDefaults.poolAddress : "",
      ),
      reserveAddress: publicEnv(
        process.env.NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS,
        yieldKind === "blend" ? blendDefaults.reserveAddress : "",
      ),
      reserveAsset: publicEnv(
        process.env.NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ASSET,
        yieldKind === "blend" ? blendDefaults.reserveAsset : "",
      ),
      docsUrl: publicEnv(
        process.env.NEXT_PUBLIC_YIELD_SOURCE_URL,
        yieldKind === "blend" ? "https://docs.blend.capital/" : "",
      ),
    },
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
