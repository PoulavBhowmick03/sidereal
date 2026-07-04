<!-- SPDX-License-Identifier: Apache-2.0 -->

# Dune analytics

Sidereal has two user-count paths:

1. Native Stellar Dune tables for production or any Dune-indexed Stellar
   deployment.
2. Uploaded cohort/testnet events for synthetic QA loops.

The distinction matters. Synthetic cohort wallets are QA evidence, not organic
traction. Keep them in a separate Dune table and label every chart as synthetic.

The initial cohort audit is
[`docs/testing/cohort-sim-2026-07-04.md`](../../docs/testing/cohort-sim-2026-07-04.md).
The repeatable runner plan is
[`docs/testing/COHORT_LOOP.md`](../../docs/testing/COHORT_LOOP.md).

## Native on-chain user count

Use [`sidereal_active_users.sql`](./sidereal_active_users.sql) in Dune. It
counts distinct successful transaction source accounts that emitted events from
one of the Sidereal contracts listed in the query.

For a new deployment, update the `sidereal_contracts` CTE with the deployed
contract addresses before saving the query.

## Cohort/testnet user count

Use [`sidereal_cohort_uploaded_user_count.sql`](./sidereal_cohort_uploaded_user_count.sql)
after uploading cohort events.

Expected event shape, one JSON object per line:

```json
{"run_id":"2026-07-04-cohort","epoch":1,"agent_id":"fixed-1","wallet":"G...","event_type":"deposit","contract_id":"C...","tx_hash":"abc","successful":true,"synthetic":true,"occurred_at":"2026-07-04T13:26:00Z","amount":"5000000000","asset":"USDC","note":"deposit 500"}
```

Upload:

```bash
DUNE_API_KEY=... DUNE_NAMESPACE=<your_dune_namespace> \
  node scripts/dune-upload-cohort-events.mjs artifacts/cohort-runs/<run>/events.jsonl
```

The script creates `sidereal_cohort_events` when missing and appends JSONL
events using Dune's upload insert endpoint.

Required environment:

- `DUNE_API_KEY`: Dune API key.
- `DUNE_NAMESPACE`: Dune upload namespace, usually your user or team namespace.
- `DUNE_TABLE`: optional, defaults to `sidereal_cohort_events`.

## Cohort loop output

A repeatable runner should emit files under
`artifacts/cohort-runs/<timestamp>/`:

- `events.jsonl`: one normalized event per action, uploadable to Dune.
- `wallets.json`: public wallet addresses, personas, and final balances.
- `txs.md`: explorer links grouped by epoch and wallet.
- `summary.md`: human-readable audit summary.

Every epoch should reconcile expected and on-chain USDC/SY/PT/YT balances
before the next epoch starts.
