// SPDX-License-Identifier: Apache-2.0

import { TESTNET_PASSPHRASE } from "./config";

const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const EXPLORER_BASE = "https://stellar.expert/explorer";

/**
 * Maps a Stellar network passphrase to the stellar.expert network segment.
 * Anything that is not the public network is treated as testnet, which matches
 * how this app is deployed (testnet by default, mainnet only if repointed).
 */
export function stellarExpertNetwork(networkPassphrase: string): "public" | "testnet" {
  if (networkPassphrase === PUBLIC_PASSPHRASE) return "public";
  // TESTNET_PASSPHRASE and any other value fall through to testnet.
  void TESTNET_PASSPHRASE;
  return "testnet";
}

/** Link to a transaction on stellar.expert for the given network. */
export function stellarExpertTxUrl(hash: string, networkPassphrase: string): string {
  return `${EXPLORER_BASE}/${stellarExpertNetwork(networkPassphrase)}/tx/${hash}`;
}

/** Link to an account on stellar.expert for the given network. */
export function stellarExpertAccountUrl(address: string, networkPassphrase: string): string {
  return `${EXPLORER_BASE}/${stellarExpertNetwork(networkPassphrase)}/account/${address}`;
}
