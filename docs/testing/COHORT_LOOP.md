# Repeatable cohort loop

This is the follow-up plan for the one-off audit in
[`cohort-sim-2026-07-04.md`](./cohort-sim-2026-07-04.md). The audit document
is evidence. This document is the implementation plan for making that style of
simulation repeatable.

The purpose is synthetic QA against testnet. These wallets can be counted in a
separate Dune cohort table, but they must be labeled as synthetic testnet QA
users, not organic traction.

## Loop shape

Run for 30 to 45 minutes. Each epoch keeps existing wallets alive and introduces
fresh wallets so protocol state evolves like a small market:

- Epoch length: 5 to 8 minutes.
- Active agents: 4 to 8.
- New wallets per epoch: 2 to 4.
- RPC concurrency: 2 to 3.
- Network: Stellar testnet.
- Auth: real wallet keys, no deployer identity, no mock auth.

Each wallet gets:

- a persona, for example fixed-rate buyer, long-yield holder, LP, churner,
  whale, rescue wallet, or guardrail prober;
- a funded testnet keypair;
- the exact underlying asset needed by the deployed market;
- an allowed action set;
- an expected-balance model for USDC, SY, PT, and YT.

## Output contract

Every run should write files under `artifacts/cohort-runs/<timestamp>/`:

- `events.jsonl`: one normalized event per action, uploadable to Dune.
- `wallets.json`: public wallet addresses, personas, and final balances.
- `txs.md`: explorer links grouped by epoch and wallet.
- `summary.md`: human-readable audit summary.

The event shape should match the Dune uploader:

```json
{"run_id":"2026-07-04-cohort","epoch":1,"agent_id":"fixed-1","wallet":"G...","event_type":"deposit","contract_id":"C...","tx_hash":"abc","successful":true,"synthetic":true,"occurred_at":"2026-07-04T13:26:00Z","amount":"5000000000","asset":"USDC","note":"deposit 500"}
```

## Dune reporting

Dune support lives in [`../../analytics/dune`](../../analytics/dune):

- `sidereal_active_users.sql` counts distinct wallets that touch deployed
  Sidereal contracts through Dune's native Stellar tables.
- `sidereal_cohort_uploaded_user_count.sql` counts uploaded cohort events in a
  separate synthetic table.
- `scripts/dune-upload-cohort-events.mjs` uploads cohort JSONL events when run
  with `DUNE_API_KEY` and `DUNE_NAMESPACE`.

Keep native on-chain usage and uploaded synthetic cohort usage separate in
Dune. The former can be called users. The latter must be labeled synthetic
testnet QA users.

## Acceptance criteria

- Every epoch reconciles expected and on-chain balances before the next epoch
  starts.
- Every landed transaction has a hash in `events.jsonl`.
- Every expected failure is recorded as synthetic QA evidence and is not counted
  as a successful active-user action.
- The final summary lists user count, transaction count, action coverage,
  reconciliation status, and findings.
