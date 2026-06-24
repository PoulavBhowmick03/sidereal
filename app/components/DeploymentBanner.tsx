// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import { appConfig, isDeployed } from "../lib/config";

/**
 * Shown when the frontend has no deployed contract addresses configured. It
 * explains why stats and actions are inert, so the demo reads honestly instead
 * of looking broken before `make deploy` has run.
 */
export function DeploymentBanner() {
  const deployed = useMemo(() => isDeployed(appConfig()), []);
  if (deployed) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10">
      <p className="mx-auto max-w-3xl px-4 py-2 text-xs text-amber-200">
        No market is configured yet. Pool stats and actions stay inert until contracts are deployed
        (run <code className="font-mono">make deploy</code> to wire testnet addresses into{" "}
        <code className="font-mono">app/.env.local</code>).
      </p>
    </div>
  );
}
