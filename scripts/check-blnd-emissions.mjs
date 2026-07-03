// SPDX-License-Identifier: Apache-2.0
//
// Checks whether the Blend reserve configured in app/.env.local emits BLND to
// suppliers. This is the live diagnostic behind docs/BLND_EMISSIONS.md.
//
// Usage:
//   pnpm --filter @sidereal/sdk build
//   node scripts/check-blnd-emissions.mjs

import { existsSync, readFileSync } from "node:fs";
import { StellarYT } from "../sdk/dist/index.js";

const envPath = new URL("../app/.env.local", import.meta.url);

function readEnv(path) {
  if (!existsSync(path)) {
    throw new Error(`missing env file: ${path.pathname}`);
  }
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}

function required(env, key) {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`missing required env var ${key}`);
  }
  return value;
}

function formatEmission(emission) {
  if (emission === null) return "null";
  return [
    "active",
    `eps=${emission.eps}`,
    `expiration=${emission.expiration}`,
    `index=${emission.index}`,
    `last_time=${emission.lastTime}`,
  ].join(" ");
}

const env = readEnv(envPath);
const slotCount = Number(process.env.BLEND_EMISSION_SLOT_COUNT ?? "8");
const pool = required(env, "NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS");
const reserveAsset = required(env, "NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS");

const client = new StellarYT({
  rpcUrl: required(env, "NEXT_PUBLIC_SOROBAN_RPC_URL"),
  networkPassphrase: required(env, "NEXT_PUBLIC_NETWORK_PASSPHRASE"),
  simulationSourceAccount: required(env, "NEXT_PUBLIC_SIMULATION_SOURCE_ADDRESS"),
  contracts: {
    sy: required(env, "NEXT_PUBLIC_SY_ADDRESS"),
    pt: required(env, "NEXT_PUBLIC_PT_ADDRESS"),
    yt: required(env, "NEXT_PUBLIC_YT_ADDRESS"),
    tokenizer: required(env, "NEXT_PUBLIC_TOKENIZER_ADDRESS"),
    market: required(env, "NEXT_PUBLIC_MARKET_ADDRESS"),
  },
});

const scan = await client.getBlendReserveEmissionScan(pool, reserveAsset, slotCount);

console.log("== Blend BLND reserve emission scan ==");
console.log("pool:", pool);
console.log("reserve asset:", reserveAsset);
console.log("reserve index:", scan.reserve.config.index);
console.log("liability token index:", scan.liabilityTokenIndex);
console.log("supply token index:", scan.supplyTokenIndex);
console.log("");

for (const slot of scan.slots) {
  console.log(`slot ${slot.reserveTokenIndex}: ${formatEmission(slot.emission)}`);
}

console.log("");
console.log("liability:", formatEmission(scan.liability));
console.log("supply:", formatEmission(scan.supply));

if (scan.supply === null) {
  console.log("verdict: no supply side BLND emissions for this reserve");
} else {
  console.log("verdict: supply side BLND emissions are active for this reserve");
}
