// SPDX-License-Identifier: Apache-2.0

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function stellarExpertNetwork(networkPassphrase: string): "public" | "testnet" {
  return networkPassphrase === PUBLIC_PASSPHRASE ? "public" : "testnet";
}

export function stellarExpertTxUrl(hash: string, networkPassphrase: string): string {
  return `${STELLAR_EXPERT_BASE}/${stellarExpertNetwork(networkPassphrase)}/tx/${hash}`;
}
