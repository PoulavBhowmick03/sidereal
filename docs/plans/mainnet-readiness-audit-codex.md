# Codex prompt: Sidereal mainnet-readiness audit

Copy everything below the line into Codex, run from the repo root. Read-only
engagement: Codex reports, humans decide what to fix.

---

You are auditing Sidereal, our own protocol, before we deploy the contracts to
Stellar mainnet. This is an authorized internal security and completeness audit
of code we wrote and operate. Your job is a full end-to-end review with a final
verdict: what is left to build, what is broken or wrong, and what must be fixed
before real funds touch these contracts. Do not modify any files. Report only.

## Ground rules

1. Read these first, in this order. They are the spec and the history:
   - `AGENTS.md` (§1 non-negotiables: internal TWAP only, PT+YT=SY invariant,
     code-first/deploy-second, no hardcoded keys, Apache-2.0 headers)
   - `ARCHITECTURE.md`
   - `AUDIT.md` (June product audit, partially stale, verify each claim
     against current code before repeating it)
   - `docs/audit/2026-06-pre-testnet.md` and `docs/audit/REMEDIATION.md`
   - `docs/testing/cohort-sim-2026-07-04.md`
   - `AGENT_HANDOFF.md` and `docs/ROADMAP.md`
2. Every finding must cite `file:line` in the current tree. If you cannot point
   at code, label it an inference and say what to check.
3. Distinguish "broken", "missing", "works but untested", and "works but
   undocumented". Do not inflate severities.
4. Run the test suites and record what actually happens, do not assume:
   - `cargo test --workspace` (contract unit + property tests)
   - `make` targets (read the `Makefile` first)
   - SDK tests under `sdk/tests/`, integration tests under `tests/integration/`
   - `cargo build --target wasm32v1-none --release` for every contract, and
     check the produced wasm for float opcodes (this regressed once before)

## Scope

Audit all of it, end to end:

- **Contracts** (`contracts/`): `tokenizer`, `sy-wrapper`, `pt-token`,
  `yt-token`, `amm`, `blend-adapter`, `shared`
- **SDK** (`sdk/src/`): transaction building, simulation/read paths, error
  surfaces, whether it matches current contract entrypoints
- **Frontend** (`app/`): does every user-reachable flow plumb slippage/min-out,
  gate zero-value claims, and handle failure states
- **Deploy and ops** (`scripts/`, `deployments/`, `Makefile`, CI): can the
  deployed bytecode be reproduced from committed source, are the new
  `build-optimized-wasm.sh` / release-profile changes sound
- **Tests** (`tests/`, per-contract test modules): coverage gaps against the
  invariants below

## Known findings to re-verify (do not trust these labels, check the code)

Prior audits (2026-06 and 2026-07-03) and a 20-wallet cohort simulation left
these open or recently "fixed". For each one, state current status:
FIXED (cite the fix), STILL OPEN, or PARTIALLY FIXED.

1. **Allowance TTL**: `approve` in pt-token and yt-token wrote allowances to
   temporary storage without extending the entry's own TTL, so allowances
   archived early (observed on-chain). pt-token now has an `extend_ttl` on the
   allowance key (`contracts/pt-token/src/lib.rs:264` as of 2026-07-08). Verify
   the TTL math actually covers the requested `expiration_ledger`, verify
   yt-token got the same fix, and verify a ledger-jump test exists.
2. **Flash YT route unit mixing**: `swap_sy_for_yt`/`swap_yt_for_sy` passed
   curve amounts to `flash_split`/`flash_recombine`, but `tokenizer.split`
   mints face units (`amount * rate / WAD`), not the raw amount. At rate ~1.0
   the bug is invisible; it grows as yield accrues. Was HIGH.
3. **LP min-out**: `add_liquidity` had no `min_lp_out`, `remove_liquidity` no
   `min_pt_out`/`min_sy_out`, while the pool page makes both user-reachable.
   A grep on 2026-07-08 still finds no `min_lp_out`.
4. **Reserve-index brick**: the sy-wrapper panics `InvalidBlendReserve` if
   Blend reindexes the underlying, and `config.reserve_index` is immutable with
   no admin migration path. Fail-closed is right, unrecoverable is not,
   acceptable on testnet, not on mainnet.
5. **YT seniority under a real slash**: `claim_yield` dropped its solvency
   gate by design (Blend sub-stroop rounding dips). Under a genuine rate
   regression, already-banked YT is paid uncapped while PT recombine/redeem is
   capped pro-rata, making YT senior to PT. Verify this reversal is documented
   and verify whether a multi-holder insolvency test now exists.
6. **Zero-value claims burn fees**: `claim_yield` deliberately has no
   `owed > 0` guard. Verify every UI/SDK path gates on
   `preview_claim_yield > 0`.
7. **June audit criticals**: float math in the AMM (libm appears removed,
   confirm no float opcodes in built wasm), PT redemption capped to face value
   vs capturing yield, `claim_yield` actually transferring SY, and YT
   checkpointing on transfer (sender and receiver settled before every balance
   move, with conservation tests). Verify each is genuinely resolved in
   current code, not just re-described in docs.

## Mainnet-specific review, beyond the known list

Fresh eyes, assume nothing:

- **Authorization**: every state-mutating entrypoint on every contract,
  `require_auth` on the right address, no privilege escalation through the
  tokenizer or AMM acting as intermediary, flash-route auth scoped to the
  current frame.
- **Arithmetic**: overflow paths on i128 math, rounding direction on every
  division (must favor the protocol/escrow), the integer ln/exp/sqrt in the
  AMM against a reference with explicit error bounds, behavior at boundaries
  (t → 0, proportion → max, dust amounts, maximum deposits).
- **Storage and TTLs**: every persistent/temporary/instance entry, what
  archives when, what happens to user funds if it does. This class of bug has
  already bitten once (allowances).
- **Economic attacks**: first-LP price seizure, rate manipulation by donating
  to the Blend position or the wrapper, sandwiching around the internal TWAP,
  value extraction via split/recombine/redeem interleavings across the
  maturity boundary, fee correctness.
- **Blend dependency**: every assumption about Blend v2 behavior (b_rate
  monotonicity, reserve indexing, pool freeze/pause states, what happens to
  the wrapper if Blend pauses or the pool is drained).
- **Admin and upgrade surface**: who can do what after deploy, is there a
  contract upgrade path, key rotation, and what an attacker with the admin key
  can steal. Mainnet needs an explicit answer here even if it is "immutable,
  no admin".
- **Maturity lifecycle**: what exactly happens at and after maturity for each
  contract, can funds be stranded, can a market be created with a bad
  maturity, epoch handling (`f6b691e` added epochs, review that code closely,
  it is newer than any prior audit).
- **Deploy reproducibility**: `deployments/testnet.toml` wasm hashes vs what
  the committed source + `scripts/build-optimized-wasm.sh` + the new release
  profile actually produce. A mainnet deploy must be byte-reproducible.
- **AGENTS.md §1 compliance sweep**: internal TWAP only (no external oracle
  reads), PT+YT=SY invariant enforced in code and tests, no hardcoded keys
  anywhere including scripts, Apache-2.0 headers on every source file.

## Deliverable

A single report with:

1. **Verdict**: one paragraph. Is this deployable to mainnet, and if not, what
   class of work stands in the way.
2. **Mainnet blockers**: numbered, severity-ordered, each with file:line, a
   concrete failure scenario, and what a fix requires. These are the "do not
   deploy until" items.
3. **Should-fix**: real defects that are not fund-loss blockers.
4. **Test gaps**: invariants and scenarios with no coverage, named
   specifically enough to write the test from the description.
5. **Status table for the seven known findings** above.
6. **What is left to build**: features that are claimed (README, docs,
   frontend) but not implemented or not wired end to end.

Order everything by severity. If the core is sound, say so plainly; if
something is unverifiable from source, say that instead of guessing.
