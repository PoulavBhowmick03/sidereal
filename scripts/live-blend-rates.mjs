// SPDX-License-Identifier: Apache-2.0
//
// Prints the live Blend reserve rates and the SY wrapper exchange rate for the
// market configured in app/.env.local. Read-only diagnostics, no signing.
//
// Usage: node scripts/live-blend-rates.mjs

import { readFileSync } from "node:fs";
import { StellarYT, blendRateToBps } from "../sdk/dist/index.js";

const envPath = new URL("../app/.env.local", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const client = new StellarYT({
  rpcUrl: env.NEXT_PUBLIC_SOROBAN_RPC_URL,
  networkPassphrase: env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
  simulationSourceAccount: env.NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS,
  contracts: {
    sy: env.NEXT_PUBLIC_SY_ADDRESS,
    pt: env.NEXT_PUBLIC_PT_ADDRESS,
    yt: env.NEXT_PUBLIC_YT_ADDRESS,
    tokenizer: env.NEXT_PUBLIC_TOKENIZER_ADDRESS,
    market: env.NEXT_PUBLIC_MARKET_ADDRESS,
  },
});

const [rates, market] = await Promise.all([
  client.getBlendRates(
    env.NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS,
    env.NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS,
  ),
  client.getMarket(env.NEXT_PUBLIC_MARKET_ID),
]);

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
console.log("== live Blend reserve ==");
console.log(json(rates));
console.log("utilization:", (Number(rates.utilization) / 1e5).toFixed(2) + "%");
console.log("borrow APR :", (Number(blendRateToBps(rates.borrowApr)) / 100).toFixed(3) + "%");
console.log("supply APR :", (Number(blendRateToBps(rates.supplyApr)) / 100).toFixed(3) + "%");
console.log("\n== SY wrapper / AMM market ==");
console.log(json(market));
console.log("1 SY =", (Number(market.exchangeRate) / 1e18).toFixed(12), "underlying");
