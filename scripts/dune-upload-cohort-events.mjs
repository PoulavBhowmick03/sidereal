#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";

const API_BASE = "https://api.dune.com/api/v1";
const DEFAULT_TABLE = "sidereal_cohort_events";

function usage() {
  console.error(`Usage:
  DUNE_API_KEY=... DUNE_NAMESPACE=<namespace> node scripts/dune-upload-cohort-events.mjs <events.jsonl>

Options:
  DUNE_TABLE=<table>       Upload table name. Default: ${DEFAULT_TABLE}
  DUNE_SKIP_CREATE=1       Do not attempt table creation before insert.

The input must be JSONL with at least: run_id, epoch, agent_id, wallet,
event_type, successful, synthetic, occurred_at.`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseBoolean(value, field, lineNumber) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`line ${lineNumber}: ${field} must be a boolean`);
}

function normalizeRow(row, lineNumber) {
  const required = ["run_id", "epoch", "agent_id", "wallet", "event_type", "successful", "synthetic", "occurred_at"];
  for (const key of required) {
    if (row[key] === undefined || row[key] === null || row[key] === "") {
      throw new Error(`line ${lineNumber}: missing ${key}`);
    }
  }

  const occurredAt = new Date(row.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error(`line ${lineNumber}: occurred_at is not a valid timestamp`);
  }
  const epoch = Number(row.epoch);
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error(`line ${lineNumber}: epoch must be a non-negative integer`);
  }

  return {
    run_id: String(row.run_id),
    epoch,
    agent_id: String(row.agent_id),
    wallet: String(row.wallet),
    event_type: String(row.event_type),
    contract_id: row.contract_id === undefined || row.contract_id === null ? "" : String(row.contract_id),
    tx_hash: row.tx_hash === undefined || row.tx_hash === null ? "" : String(row.tx_hash),
    successful: parseBoolean(row.successful, "successful", lineNumber),
    synthetic: parseBoolean(row.synthetic, "synthetic", lineNumber),
    occurred_at: occurredAt.toISOString(),
    amount: row.amount === undefined || row.amount === null ? "" : String(row.amount),
    asset: row.asset === undefined || row.asset === null ? "" : String(row.asset),
    note: row.note === undefined || row.note === null ? "" : String(row.note),
  };
}

function readJsonl(file) {
  const raw = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`line ${index + 1}: invalid JSON, ${error.message}`);
    }
    rows.push(normalizeRow(parsed, index + 1));
  }
  if (rows.length === 0) {
    throw new Error(`${file} contains no events`);
  }
  return rows;
}

async function duneFetch(pathname, { apiKey, method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      "X-DUNE-API-KEY": apiKey,
      ...headers,
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Dune ${method} ${pathname} failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return text;
}

async function ensureTable({ apiKey, namespace, table }) {
  const schema = [
    { name: "run_id", type: "varchar", nullable: false },
    { name: "epoch", type: "bigint", nullable: false },
    { name: "agent_id", type: "varchar", nullable: false },
    { name: "wallet", type: "varchar", nullable: false },
    { name: "event_type", type: "varchar", nullable: false },
    { name: "contract_id", type: "varchar", nullable: true },
    { name: "tx_hash", type: "varchar", nullable: true },
    { name: "successful", type: "boolean", nullable: false },
    { name: "synthetic", type: "boolean", nullable: false },
    { name: "occurred_at", type: "timestamp", nullable: false },
    { name: "amount", type: "varchar", nullable: true },
    { name: "asset", type: "varchar", nullable: true },
    { name: "note", type: "varchar", nullable: true },
  ];

  try {
    await duneFetch("/uploads", {
      apiKey,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace,
        table_name: table,
        description: "Sidereal synthetic cohort simulation events. QA evidence, not organic traction.",
        is_private: false,
        schema,
      }),
    });
    console.log(`created Dune upload table ${namespace}.${table}`);
  } catch (error) {
    if (error.status === 409 || /already exists/i.test(error.message)) {
      console.log(`Dune upload table ${namespace}.${table} already exists`);
      return;
    }
    throw error;
  }
}

async function insertRows({ apiKey, namespace, table, rows }) {
  const ndjson = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await duneFetch(`/uploads/${encodeURIComponent(namespace)}/${encodeURIComponent(table)}/insert`, {
    apiKey,
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: ndjson,
  });
  console.log(`inserted ${rows.length} cohort events into ${namespace}.${table}`);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    usage();
    process.exitCode = 2;
    return;
  }

  const resolved = path.resolve(input);
  const apiKey = requiredEnv("DUNE_API_KEY");
  const namespace = requiredEnv("DUNE_NAMESPACE");
  const table = process.env.DUNE_TABLE || DEFAULT_TABLE;
  const rows = readJsonl(resolved);

  if (process.env.DUNE_SKIP_CREATE !== "1") {
    await ensureTable({ apiKey, namespace, table });
  }
  await insertRows({ apiKey, namespace, table, rows });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
