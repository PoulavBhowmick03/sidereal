# Sidereal — remaining-work evaluation

Date: 2026-07-10 · Source: fa2deb7 (`fix: route direct YT settle rates through the maturity-freeze observation`)
Author: Claude (session evaluation, not committed by policy — do not commit without review)

## Where the product stands

The contract layer has been through three audit-and-fix rounds (commits `6511900`,
`09ff467`, `fa2deb7` plus CI repair `04d277d`). The final external (Codex) delta audit
returned zero findings at `fa2deb7`, and the full local sweep is green with per-stage
exit codes: workspace tests (economics 19, yt 14, amm 36, plus unit suites), wasm
float-opcode check on all 5 artifacts, SDK and app typecheck/test all exit 0.
The blockers from both audit rounds are fixed: allowance TTL, AMM flash-route units,
LP min-outs, canonical/observation-based maturity freeze (incl. direct YT
transfer/burn paths), PT-senior surplus cap, reserve-index migration gating, deploy
provenance pipeline.

**"Mainnet-ready" here means the code gates are clean. The items below are what
actually remains.**

## 1. Operational proofs still owed (highest value, in progress today)

- **Live exercise of the fixed bytecode.** Until 2026-07-10 the public testnet
  deployment was from `27ce517` (2026-07-03) — it predates *all three* fix rounds.
  Nothing with the observation freeze, PT-senior cap, or AMM unit fixes had ever run
  against real RPC/Blend. → Redeployed today at `fa2deb7` (see
  `deployments/testnet.toml`); a continuous multi-agent user simulation runs against
  it (ledger: `docs/testing/live-sim-2026-07-10/ledger.md`). **DISCHARGED as of the
  first two epochs:** full lifecycle smoke passed end-to-end on the fresh bytecode
  (incl. maturity freeze); the round-1 allowance-TTL fix is proven on real storage
  (`liveUntilLedgerSeq` == requested expiration, not the 720-ledger minimum); the
  round-3 direct-YT settlement is proven with exact on-chain arithmetic.
- **Maturity-path drill on-chain. DISCHARGED.** An epoch-2 drill deployed its own
  900-second Blend market and ran the freeze/redeem against real post-maturity accrual.
  Last pre-maturity observation R_obs = 1.000000012; live rate had accrued to
  1.000000033 by freeze time; `freeze_maturity_rate` pinned R_obs, not the live rate
  (orchestrator re-verified `maturity_rate` on-chain). Post-maturity `observe_rate`
  rejects (#6); PT redeemed exactly at the frozen rate with senior reservation covered
  first; the unobserved post-maturity tail is unclaimable by YT and accrues to PT/SY.
  The round-2 split-brain blocker is now closed in live conditions, not just the harness.
- **LP archival restore drill.** The accepted posture "archived persistent LP entries
  are restorable via RestoreFootprintOp" is inferred from Soroban state-archival
  semantics; it has never been demonstrated on this codebase. One deliberate
  let-an-entry-archive-then-restore exercise on testnet before any mainnet LP exists.
- **Wallet-signed end-to-end.** `app/e2e/flow.spec.ts` is still permanently gated on
  `E2E_MARKET_DEPLOYED=1` and has no automated wallet; the real-user path through the
  UI (connect, sign, submit) is only proven manually. The ROADMAP item "promote
  flow.spec to a real run" was never done.

## 2. Deferred code/UX items (flagged to Rahul, not blocking)

- Trade page (`app/app/(app)/trade/page.tsx:185`) and pool page
  (`app/app/(app)/pool/page.tsx:305-307`) render `impliedApyBps` without checking
  `twapWarmingUp`; only `app/lib/yieldChoice.ts:32` gates on it. Swaps price off live
  reserves, so no funds are at risk — but measured live on 2026-07-10, both pages
  show a confident amber "live feed" APY (19.78%→20.05%) for the entire 1800s
  warm-up, and `/trade` labels it "Implied APY (TWAP)" while no TWAP has warmed.
  Both pages already fetch `twapWarmingUp`; the fix is mechanical.
- Neither page polls; an idle tab shows stale stats behind a "Live feed" label
  (fresh loads are correct and match chain exactly). Labeling or polling, pick one.
- YT junior surplus is first-come among claimants under shortfall; pro-rata needs an
  aggregate banked ledger (design decision deferred, documented ARCHITECTURE.md §8).

## 3. Ops infrastructure that does not exist yet (required for mainnet)

- **Keeper automation.** The runbook (docs/deploy/PROVENANCE.md) requires a keeper to
  poke `observe_rate` near maturity and `freeze_maturity_rate` just after, plus LP
  TTL keepalive. No keeper code, cron, or service exists — it is a manual checklist
  step today. Even a minimal scheduled script + alerting is unbuilt.
- **Monitoring/alerting.** No on-chain invariant monitor (PT supply == YT supply,
  escrow coverage, exchange-rate staleness) runs anywhere. The cohort sim verified
  these externally by hand; nothing does it continuously.
- **Mainnet parameters.** `deployments/mainnet.toml.template` still needs real
  mainnet Blend v2 pool/reserve addresses, maturity, and curve parameters chosen and
  reviewed. Contracts are immutable (no upgrade entrypoint) — a mainnet deploy is
  one-shot, so parameter review is a real gate, not paperwork.

## 4. Documentation drift (cheap, misleading if left)

- `AUDIT.md` (repo root) describes the June state — float AMM, "YT structurally
  worthless", undeployable main. All of that is long fixed; a new reader's first
  impression is wrong. Archive it under `docs/audit/` with a date or rewrite the
  executive summary.
- `docs/ROADMAP.md` is the pre-grant three-week plan (references PR #18, demo video);
  mostly overtaken. Rewrite or delete.
- `README.md` still says "PT/SY AMM and YT flash route are experimental and pending
  testnet auth verification" and pins the deployed-contracts table to the `27ce517`
  deployment. Both stale after today's redeploy — the table needs the new IDs and
  hashes once the redeploy is committed/reviewed.
- `scripts/smoke-testnet.sh` drifted from the current interface: it calls
  `preview_claim_yield` on the tokenizer, but the function lives on the YT token.
  The documented post-deploy regression check dies mid-run (found live 2026-07-10;
  one-line fix, see the live-sim ledger).

## 5. Accepted limitations (decided and documented — revisit only deliberately)

Documented in ARCHITECTURE.md §8; listed for completeness, not as work:
sub-share YT flash-route dust (matched pair, never reaches trader); YT claimants
share junior surplus first-come; admin-gated reserve-index migration is the only
admin lever; archived LP entries restorable (see drill above); provenance
Blend-custody grep is brittle but fails closed; `claim_yield` accepts zero-owed
calls (UIs must gate on `preview_claim_yield > 0`).

## 6. Product-scope gaps (future work, not readiness defects)

- Single market per deployment, wired by env vars; no market factory/registry, no
  market-rollover story after maturity (users must migrate manually to a new
  deployment).
- No indexer or analytics surface (Dune tracking was removed in `094d7a7`/`169da5a`).
- Faucet/demo API routes (`app/app/api/faucet`, `api/demo`) are testnet conveniences;
  the demo route spawns repo scripts server-side and must not ship in a mainnet
  deployment profile. *(Inference from reading the route; verify the deployment
  profile actually excludes it.)*

## Verification snapshot

- Codex delta audit at `fa2deb7`: "No Critical/High/Medium/Low/Informational
  findings", all checklist items closed (caveat: it could not execute cargo; covered
  by the local sweep).
- Local sweep at `fa2deb7`: CARGO_EXIT 0 (all suites), WASM_EXIT 0 (5 float-free
  artifacts), SDK_TYPECHECK/SDK_TEST/APP_TYPECHECK/APP_TEST all 0.
- Testnet redeploy at `fa2deb7`: 2026-07-10, blend custody, manifest
  `deployments/testnet.toml`, env `app/.env.local`.
