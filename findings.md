# Sidereal live user-simulation — findings

Date: 2026-07-10 · Source commit under test: **fa2deb7** · Network: Stellar testnet
Method: rolling epochs of background agents funding real testnet wallets and using the
freshly deployed contracts + frontend as real users. Every agent-claimed finding was
re-verified against source and/or on-chain by the orchestrator before being recorded here.

## Deployment under test (fresh, from fa2deb7, Blend v2 custody)

| Component | Contract ID |
|---|---|
| SY wrapper | `CBX2B6NGQW2SZ7BV2ATJZY7AHVUO2Y47QUATJOEUR7ZCXOL7VMV7EENS` |
| PT token | `CBH33TRW36ESW5AIL4ELOBNFI6K3NSSPLI77WYJIBW54X22AZBUHULXS` |
| YT token | `CAKVWNZKB7ZT24GHKLAMC36A2LJLWCXYFOWSB2XYOZQXWXVIRFQ5U45I` |
| Tokenizer | `CCLNQII4FKGNMJQRYQGPE4BPPBCH32MU3NNS646WFB673NS5K62KL33H` |
| AMM | `CBLIBCVL4NEZ4EX6LFKAD2OBZZPNWDWKFKMMWAJFIXPBQF6C4KEXYSHN` |
| Underlying USDC SAC | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` (Blend testnet USDC) |
| Blend pool | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` |

Maturity 1791431478 (~2026-10-08) · 7 decimals · AMM fee 10bps · TWAP window 1800s.
Frontend: production https://www.sidereal.tech redeployed to these addresses; env
verified by pulling Vercel prod values back after the update. Manifest:
`deployments/testnet.toml`.

## Headline: all three hardening rounds now have LIVE on-chain proof

The three audit-fix rounds (`6511900`, `09ff467`, `fa2deb7`) had only ever been proven in
the integration harness. This simulation proved each against real Blend accrual on testnet:

- **Round-1 allowance TTL** — the allowance entry's `liveUntilLedgerSeq` now equals the
  requested `expiration_ledger` (not the 720-ledger temp-storage minimum). The cohort-sim
  allowance bug is dead. (Finding 10.)
- **Round-2 observation-based maturity freeze** — `freeze_maturity_rate` pinned the last
  pre-maturity observation (R_obs = 1.000000012) and ignored the higher live post-maturity
  rate (1.000000033), re-verified by independent `maturity_rate` read. The split-brain
  blocker is closed in live conditions. (Finding 13.)
- **Round-3 direct-YT settlement** — direct YT transfer/burn banks yield through the
  tokenizer observation; the sender keeps only their own accrued yield, the receiver starts
  fresh at the transfer rate. Proven with independently reproduced arithmetic. (Finding 11.)

Also: the full lifecycle smoke (deposit → split → claim → recombine → freeze → PT redeem →
SY redeem) **passed end-to-end** on the fresh bytecode after a one-line script fix
(finding 1). PT-senior surplus cap held on-chain: escrow covered the senior PT reservation
before any YT payout in every settlement (findings 11, 13). Empty-pool swap attempts
rejected cleanly with `MarketNotSeeded` (#9), correctly mapped in the frontend.

## Findings by severity

Nothing CRITICAL or HIGH was found. No fund-loss, no value-from-nothing, no invariant
violation that any economic path depends on. The items below are error-semantics, UX, and
one design decision.

### MEDIUM

**M1 — Previews are point-in-time; `recombine` has no min-out floor** (finding 2).
`preview_claim_yield`/`preview_recombine` read the live, continuously-accruing Blend rate
at call time, so a rate move between preview and submission shifts the result (observed:
preview 5, executed 6). Direction of harm is benign — the supply-only rate is monotonic up,
so claims pay ≥ preview and recombine returns fewer-but-more-valuable shares (value
conserved). But `recombine(from, pt_amount, yt_amount)` (tokenizer lib.rs:247) is the one
value-moving entrypoint with no slippage floor, unlike every AMM call. **Decision owed:**
document previews as point-in-time, or add an optional `min_sy_out` to `recombine`.
**Status (2026-07-10): FIXED — Path B (document, defer).** Point-in-time doc notes added to
`preview_recombine` (tokenizer), `preview_claim_yield` (yt-token), the SDK recombine
builder + types, and ARCHITECTURE §3; no ABI change. A `min_sy_out` floor was deliberately
deferred — it only helps a contract composing on `recombine`, and none does today.

**M2 — `twapWarmingUp` not gated on trade/pool pages** (finding 4).
During the full 1800s TWAP warm-up, `/trade` and `/pool` render implied APY as a confident
amber "live feed" percentage — and `/trade` labels it "Implied APY (TWAP)", asserting a
TWAP that has not warmed — while `/mint`'s yield-choice card correctly shows a "Warming up"
pill. Display-only (swaps price off live reserves, no funds at risk), but misleading. Both
pages already fetch `twapWarmingUp`; the fix is mechanical. Source: pool/page.tsx:305-310,
trade/page.tsx:183-188; only lib/yieldChoice.ts:32 gates. (Flagged for Rahul in
evaluation.md §2; severity raised from display-only after seeing the "(TWAP)" label.)

**M3 — Stale-quote fee burn on `remove_liquidity`** (finding 3).
Under concurrent trading, a withdrawal with tight min-outs passed simulation then trapped
(`SlippageExceeded`) on submission, burning ~33.8k stroops on a guaranteed-revert tx. The
contract guard behaved exactly right — no partial withdrawal. The pool page does apply a
user-selectable 50bps default buffer to all three LP min-outs (slippage.ts:9,
pool/page.tsx:83-85), but previews are computed at render and not re-simulated at signature
time. **Recommendation:** re-simulate immediately before wallet signature.

**M4 — Misleading error code for wrong-caller on SY admin gates** (finding 7).
`set_exchange_rate` and `migrate_reserve_index` check `admin != config.admin` and return
`Error::NotInitialized` (code 2 — false, the contract IS initialized) before reaching the
Blend-custody guard. Rejection is correct (verified on-chain: non-admin sims both return
`Error(Contract,#2)`); only the code is wrong. Source: sy-wrapper/src/lib.rs:142-159,
181-189.
**Status (2026-07-10): FIXED.** Added `NotAuthorized = 12` to the sy-wrapper Error enum;
both wrong-caller sites now return it (the two genuine not-initialized uses are untouched);
mapped `12: "Not authorized."` in app/lib/errors.ts; added a `#12` unit test. sy-wrapper
suite 14 passed / exit 0, still builds to wasm.

**M5 — Standalone YT burn breaks the stated PT==YT supply invariant, but inertly**
(finding 12). A holder-privileged standalone SEP-41 YT `burn` reduces YT total_supply below
PT total_supply (observed gap == burned amount). **Verified economically inert:** the
tokenizer reads only *PT* total_supply for escrow coverage / PT-senior cap / pro-rata
(lib.rs:184,277,319,378); YT total_supply feeds no economic path, and per-holder recombine
operates on the holder's own balances. The burner simply forfeits their own future yield to
escrow, favoring PT seniority. **Action:** qualify the invariant statement (holds under
split/recombine; standalone YT burn may reduce YT supply), or reconsider exposing
standalone YT burn.
**Status (2026-07-10): FIXED — documentation.** Added a §8 risk row in ARCHITECTURE plus a
comment on the yt-token `burn` explaining the parity break is by-design and inert (no
economic path reads YT supply). Kept the entrypoint. Note: `journey.rs` asserts global
PT==YT supply, but only in a split/flash/recombine test that never calls standalone burn,
so the note doesn't contradict it — flagged for if that test ever grows a burn case.

### LOW

**L1 — `scripts/smoke-testnet.sh` drifted from the interface** (finding 1).
Line 246 calls `preview_claim_yield` on the tokenizer, but the function lives on the YT
token (SDK agrees, sdk/src/client.ts:193). The documented post-deploy regression check dies
mid-run on any current deployment. One-line fix; with it applied the full lifecycle passes.

**L2 — Frontend AMM error table is incomplete** (finding 8).
`app/lib/errors.ts` maps only AMM codes 4/9/10/11/12; the enum (amm/src/lib.rs:72-90) runs
to 19. User-reachable codes `MarketProportionTooHigh`(14), `ExchangeRateBelowOne`(15),
`InputOutOfBounds`(18), `InvalidSyRate`(19) fall back to a generic "Transaction failed
(error #N)".

**L3 — Pages don't poll; "Live feed" label overstates freshness** (finding 5).
A 6-minute idle tab showed byte-identical stats while on-chain reserves moved. Fresh loads
are correct and match chain to the base unit, so it's a labeling (or polling) gap.

**L4 — Post-maturity `observe_rate` returns a bare `#6`** (finding 14).
A keeper polling `observe_rate` on a just-matured market gets `Error(Contract,#6)` (Matured)
with no "call freeze_maturity_rate" hint. Safe (no fee, no state change), but unmapped for
keepers/UI. Same family as L2, tokenizer side.

### PROCESS

**P1 — Adversarial-framed subagents get chain access blocked** (finding 9).
An agent framed as "try to break it / attack financial infra" had its `stellar`/RPC calls
denied by a harness intent classifier (plain Bash still worked), producing zero on-chain
adversarial coverage that epoch. Correct agent behavior (it stopped rather than seek a
bypass). **Mitigation:** frame negative testing explicitly as authorized security testing,
or have the orchestrator run the probes directly (it did, for finding 7). The donation-attack
surface separately looks unexploitable by source read — LP mint prices off internal
`state.total_pt/total_sy` (amm/src/lib.rs:525-535), not live balance, plus the
`MINIMUM_LIQUIDITY` burn — but this was not executed live and remains an inference.

## Epochs run

- **Epoch 1** (complete) — LP whale (seeded the empty pool as first LP), yield trader
  (swaps + both flash routes, empty-pool probe), frontend user (all six routes, e2e suite,
  API routes, production rebake check). Findings 1–6. Orchestrator ran the lifecycle smoke.
- **Epoch 2** (complete) — adversarial (source-level after chain block; findings 7–9),
  token mechanics (allowance TTL + direct-YT settlement proofs; findings 10–12), maturity
  drill (own 900s market, the freeze headline; findings 13–14).
- **Epoch 3** (not run) — an authorized-security-tester and a concurrency persona were
  queued but blocked by session limits (agent hit the session cap; the safety classifier
  for launching the second was temporarily unavailable). Uncovered next time: on-chain
  negative/robustness probes with authorized framing, and multi-user concurrent load on the
  reserve/TWAP accounting. The queued prompts and coverage targets are described in the
  epoch-3 section of the git history / prior session; re-run with corrected framing.

## What this simulation did and did not cover

Covered live on-chain: wrap/split/recombine/claim, PT/SY swaps, both YT flash routes, LP
add/remove, PT/YT transfers, allowances (incl. TTL), direct YT transfer/burn settlement, the
full maturity freeze/redeem against real accrual, empty-pool and wrong-caller rejections,
and the six frontend routes + API routes + production rebake.

Not covered (still owed, see evaluation.md): a wallet-signed end-to-end run through the UI
(the e2e flow spec is still gated, no automated signer), an LP-archival restore drill, and
multi-user concurrency under sustained load. No mainnet action was taken — this is testnet
validation of the fa2deb7 bytecode, not a deploy.
