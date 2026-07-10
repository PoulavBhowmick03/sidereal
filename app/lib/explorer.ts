// SPDX-License-Identifier: Apache-2.0

import { stellarNetworkKey } from "./config";

const EXPLORER_BASE = "https://stellar.expert/explorer";

/**
 * Maps a Stellar network passphrase to the stellar.expert network segment.
 * Anything that is not the public network is treated as testnet, which keeps
 * custom or unset profiles on the safer non-public explorer namespace.
 */
export function stellarExpertNetwork(networkPassphrase: string): "public" | "testnet" {
  return stellarNetworkKey(networkPassphrase) === "public" ? "public" : "testnet";
}

/** Link to a transaction on stellar.expert for the given network. */
export function stellarExpertTxUrl(hash: string, networkPassphrase: string): string {
  return `${EXPLORER_BASE}/${stellarExpertNetwork(networkPassphrase)}/tx/${hash}`;
}

/** Link to a contract on stellar.expert for the given network. */
export function stellarExpertContractUrl(address: string, networkPassphrase: string): string {
  return `${EXPLORER_BASE}/${stellarExpertNetwork(networkPassphrase)}/contract/${address}`;
}

/** Link to an account on stellar.expert for the given network. */
export function stellarExpertAccountUrl(address: string, networkPassphrase: string): string {
  return `${EXPLORER_BASE}/${stellarExpertNetwork(networkPassphrase)}/account/${address}`;
}
