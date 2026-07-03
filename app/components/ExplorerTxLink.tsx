// SPDX-License-Identifier: Apache-2.0

"use client";

import { appConfig } from "../lib/config";
import { stellarExpertTxUrl } from "../lib/explorer";

/**
 * Renders a confirmed transaction hash as a link to stellar.expert for the
 * configured network. Used wherever an action reports a settled tx hash.
 */
export function ExplorerTxLink({ hash, className }: { hash: string; className?: string }) {
  const url = stellarExpertTxUrl(hash, appConfig().networkPassphrase);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="View transaction on Stellar Expert"
      className={`font-mono text-amber underline decoration-dotted underline-offset-2 transition hover:text-paper ${className ?? ""}`}
    >
      {hash.slice(0, 10)}… ↗
    </a>
  );
}
