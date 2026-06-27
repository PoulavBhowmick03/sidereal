# Economics rework progress

Branch: `fix/pt-yt-economics`. Lane: PT/YT economics (audit Layer 1 findings 3,
4, 5, 8 and the post-maturity finding). Infra/AMM/SDK/deploy is Codex's lane;
see docs/COORDINATION.md for the interface between us.

Run the failing specs: `cargo test -p sidereal-integration-tests --test economics`
Run the auth invariant: `cargo test -p sidereal-integration-tests --test auth_invariants`

---

## Phase 1 (COMPLETE): make the defect impossible to ignore

Wrote the three failing specs that define "done" for the rework, plus the
flash-route auth invariant for Codex. All compile; the three economics tests are
RED against current code for exactly the right reasons; the rest of the suite is
unchanged and green.

What landed:

- `tests/integration/tests/economics.rs`:
  - `yt_receives_yield_on_claim`, RED: claim pays YT holder 0 SY today; spec
    wants ~9.09 SY (10 asset units of yield / rate 1.10) for a 100-unit split.
  - `pt_redeems_to_principal_not_share`, RED: PT redeems 1:1 (1_000_000_000
    SY) today; spec wants principal at the maturity rate (909_090_909 SY).
  - `escrow_covers_outstanding_claims`, RED: YT holders receive 0 SY on claim
    today; spec wants real payout plus the escrow-coverage invariant holding at
    every step, escrow draining to ~0 at the end.
- `tests/integration/tests/auth_invariants.rs`:
  - `flash_route_top_level_auth_is_arg_pinned`, GREEN: the user's
    `swap_sy_for_yt` authorization is pinned to the exact `sy_in`/`min_yt_out`,
    and every authorized transfer carries a concrete positive amount.
  - `flash_route_user_only_signs_the_swap`, `#[ignore]`d, the strict end-state
    for Codex's real (non-mock) auth tree.
- `docs/COORDINATION.md`:
  - Final YT checkpoint storage shape (`Checkpoint(Address)` +
    `AccruedYield(Address)`, persistent). This unblocks Codex's TTL/storage
    migration.
  - Heads-up on the `preview_claim_yield` / `claim_yield` interface changes
    (hard-stop #1) for SDK/human ack before Phase 2 step 5.

Verification: economics test binary reports 0 passed / 3 failed (intended).
auth_invariants reports 1 passed / 1 ignored. Full baseline (`cargo test
--workspace`) was green before these additions.

### Notes / decisions

- Denomination chosen: **asset units** (see COORDINATION.md section 3). The
  algebra closes: at every transition `escrow_sy * R / WAD` exactly equals
  `pt_supply + outstanding_yt_yield` (equality at split, preserved by claim,
  redeem, and recombine). Worked through before writing code.
- Settle-on-transfer is bookkeeping only (accrue into `AccruedYield`, no escrow
  move); only explicit claim moves SY. Keeps transfers cheap.
- The 3 modified `test_snapshots/*.json` in the working tree
  (`amm_*`, `yt_flash_route`) are side effects of running tests against Codex's
  uncommitted AMM integer-math change; they are NOT part of this commit.

## Phase 2 steps 1-4 (COMPLETE): denomination + split/redeem/recombine

Human checkpoint approved continuing through step 4, with "read rate internally"
for the step 5 interface.

- Step 1 (denomination): ARCHITECTURE.md section 3 rewritten to asset units, the
  correct telescoping YT formula, the escrow invariant, and a worked example
  that no longer double-counts. Recorded a correctness finding: the planned
  `(R-c)/WAD` yield formula overpays for splits above rate 1.00; the lane uses
  `(R-c)/(c*R)*WAD` instead (COORDINATION.md 3b).
- YT settle engine (`feat(yt)`): per-holder persistent `Checkpoint` +
  `AccruedYield`, `settle()` reading the SY rate internally, wired into mint /
  transfer / transfer_from / burn / burn_from. Telescoping formula locked by a
  1.05-split test and a cross-transfer conservation test. claim_yield settles
  and reports the claimable amount; payout is deferred to step 5.
- Step 2 (split): mints `face = sy_amount * rate / WAD` PT and YT, escrows the
  SY. At rate 1.00, face == sy_amount, so rate-1.0 flows are unchanged.
- Step 3 (redeem_at_maturity): pays `pt_amount * WAD / rate` SY (principal),
  burns PT. No longer 1:1 in shares.
- Step 4 (recombine): burns equal PT+YT (the YT burn settles accrued yield
  first), returns principal `pt_amount * WAD / rate`; banked yield stays
  claimable.

Test state after steps 1-4:
- `pt_redeems_to_principal_not_share` (economics): now GREEN.
- `yt_receives_yield_on_claim`, `escrow_covers_outstanding_claims`: still RED by
  design, waiting on the step 5 claim payout.
- yt-token 9, tokenizer 9, journey 5: green. Rate-1.0 numbers unchanged.

## Phase 2 steps 5-6 (COMPLETE): claim payout + transfer-safe conservation

Human approved proceeding with the "read rate internally" interface.

- Step 5 (claim payout): claiming moved to `tokenizer.claim_yield(holder)`. The
  tokenizer (escrow custodian) calls the new tokenizer-gated
  `yt.settle_and_consume(holder)`, which settles and zeroes the holder's banked
  yield and reports the owed SY shares; the tokenizer then transfers that SY out
  of escrow. `yt.claim_yield(holder, rate)` removed;
  `yt.preview_claim_yield(holder)` and `tokenizer.preview_claim_yield(holder)`
  read the rate internally. Interface change recorded in COORDINATION.md 2 for
  the SDK.
- Step 6 (transfer hooks): already wired in the settle engine. Added the
  dedicated payout-conservation integration test: Alice splits 100 YT, accrues,
  transfers 50 to Bob, rate rises again, both claim. Total SY claimed equals a
  single 100-YT holder's yield over the same rate path (no loss, no double
  count), and escrow is left holding exactly the principal.

Test state: all four economics specs GREEN
(`yt_receives_yield_on_claim`, `pt_redeems_to_principal_not_share`,
`escrow_covers_outstanding_claims`, `transfer_conserves_yield_through_claims`).
The central defect (PT captures yield, YT pays nothing) is closed: PT redeems to
principal, YT is paid its yield in SY, conserved across transfers.

## Phase 2 summary (human checkpoint)

PT and YT now have correct, conservation-clean economics on a mock SY rate:
asset-unit denomination, principal-only PT redemption, telescoping YT yield with
a per-holder ledger, real SY payout from escrow on claim, and transfer-safe
settlement. The escrow-coverage invariant is asserted across a full multi-holder
claim/redeem walk in the tests; Phase 3 step 7 will also assert it inside the
contract on every mutation.

## Phase 3 (COMPLETE): insolvency guard and post-maturity

Running autonomously in a loop (human approved).

- Step 7: in-contract escrow-coverage invariant. After split, recombine, redeem,
  and claim the tokenizer asserts `escrow_sy * rate / WAD >= pt_supply`. YT yield
  coverage holds by construction (escrow excess above PT principal == outstanding
  YT yield), and total YT yield is not enumerable on-chain, so the computable PT
  half is asserted. New `Insolvent` error.
- Step 8: insolvency guard. `redeem_at_maturity` caps the payout to
  `escrow_shares * pt_amount / pt_supply` when a rate regression has left the
  escrow short, so PT holders share the loss pro-rata (capping preserves the
  escrow/PT ratio, keeping later redeemers fair). YT is subordinate: a claim that
  would breach PT coverage reverts (Insolvent), flooring YT at zero during
  insolvency while the holder keeps their banked ledger. Tests: 1.00->0.95 cap
  with equal pro-rata loss; banked-then-crash claim revert.
- Step 9: maturity rate snapshot. Tokenizer freezes the SY rate at maturity
  (lazy + permissionless `freeze_maturity_rate` poke + `maturity_rate` view);
  redemption and the solvency check use the frozen rate, so post-maturity rate
  moves cannot change redemption. YT freezes accrual at maturity the same way
  (no phantom post-maturity yield); post-maturity claims stay open (grace
  window) at the maturity rate. Tests: frozen-rate redemption, exact-maturity
  boundary gating.

Test state: economics 9, yt 9, tokenizer 9, journey 5, amm 21, pt 11, sy 11,
auth 1 (+1 ignored). Full workspace green.

### Phase 3 summary (human checkpoint)

The economics are now defended against the adversarial cases, not just the happy
path: a rate regression cannot let early redeemers drain the escrow (pro-rata
cap), YT cannot drain escrow below PT coverage (subordinated, reverts), and
post-maturity rate moves cannot change redemption (frozen snapshot). The
escrow-coverage invariant is enforced in-contract on every mutation. The one
documented assumption is that the SY rate is flat post-maturity, which holds for
a real yield source (accrual stops at maturity) and for the mock requires the
admin not to bump it after expiry.

## Phase 4 (COMPLETE): property test and docs

- Step 10: conservation property test. 10k random sequences of split / transfer
  / claim / recombine across three holders with a monotonically rising rate,
  then a full drain at maturity. The escrow-coverage invariant is asserted at
  every step (the contract also asserts the PT half in-contract), and the
  leftover escrow is bounded to floor-rounding dust (measured ~1.15 shares per
  value op; bounded at 2). The economics code is pure integer math, so the
  native test path equals the wasm path (no float divergence to coordinate with
  Codex). A first run failed a too-tight drain bound; investigated per hard-stop
  #3 and confirmed it was safe rounding excess (escrow never short, every payout
  succeeded), then calibrated the bound from measurement rather than papering
  over it.
- Step 11: maturity-boundary tests landed with step 9 (exact-maturity redeem
  allowed, split rejected).
- Step 12: ARCHITECTURE section 3 extended to match the final code (in-contract
  invariant assertion, insolvency pro-rata cap + YT subordination, frozen
  maturity rate, post-maturity grace window).

## Phase 4 summary (human checkpoint) and final state

All four phases are complete. The PT/YT economics defect (audit Layer 1 findings
3 and 4) is closed and hardened:

- PT redeems to principal; YT is paid its yield in SY from escrow.
- Yield uses the conservation-correct telescoping formula; transfer-safe.
- Escrow-coverage invariant enforced in-contract on every mutation and checked
  by a 10k-step property test.
- Insolvency guard: pro-rata PT cap, YT subordinated.
- Maturity rate frozen; post-maturity settlement defined.

Done-checklist (from the brief):
1. Three Phase 1 specs green: yes.
2. Conservation property test green (10k, integer path): yes.
3. Escrow-coverage invariant enforced by in-contract assertion: yes.
4. Insolvency guard prevents over-redemption: yes.
5. Post-maturity YT settlement implemented and tested: yes.
6. ARCHITECTURE section 3 matches code incl. worked example: yes.
7. COORDINATION.md has final storage key shape: yes.
8. tests/auth_invariants.rs has the auth-pinning invariant: yes.
9. Full suite passes locally: yes (CI is Codex's lane).
10. PROGRESS.md has a summary per phase: yes.

Out of lane / not done here (by design): the real yield source (mock rate
remains; Layer 2 is Codex's), the AMM float fix, SDK simulate source, deploy
scripts, TTL bumps. The SDK must drop the rate arg from preview_claim_yield and
add a claim builder targeting tokenizer.claim_yield (COORDINATION.md 2).

---

## Codex operations Phase 1

### Provenance check complete

- Queried the live AMM Wasm hash on testnet.
- Rebuilt both committed float candidates and the uncommitted integer rewrite.
- Confirmed the live AMM exactly matches the uncommitted integer artifact and
  matches no committed candidate.
- Located the uncommitted resilient deploy script used for the live addresses.
- Recorded addresses, hashes, tool versions, and reproduction commands in
  `docs/PROVENANCE.md`.

Next: adopt the exact integer rewrite, remove `libm`, and verify the Wasm build
contains no floating-point instructions.

### AMM integer math complete

- Applied the exact integer fixed-point rewrite that produced the live testnet
  artifact.
- Removed the AMM's direct `libm` dependency and updated `Cargo.lock`.
- Built `sidereal-amm` for `wasm32v1-none` with `--locked`.
- Verified the new committed artifact hash is
  `33cf0ee0a757baa546f4350c8ab3e2167ce86e3e8051bc9bb2ec1809ed309a04`.
- Verified `wasm-objdump -d` reports zero `f32.*` or `f64.*` opcodes. The same
  check reports 210 float opcodes for the prior committed float artifact.
- AMM tests are green, including the 10,000-case property test.
- The full workspace reaches only Claude's three intentionally red economics
  specifications. All previously green tests, including the auth invariant,
  remain green.

Next: add the all-contract Wasm float-opcode CI guard.

### Wasm float-opcode guard complete

- Added `scripts/check-wasm-floats.sh`, which disassembles each supplied Wasm
  artifact and fails on any `f32.*` or `f64.*` opcode.
- Updated contract CI to install `wabt` and inspect all five release artifacts.
- Verified all five integer-path artifacts pass locally.
- Verified the prior float AMM fails with 210 detected float opcodes.

GitHub negative control:

- Opened temporary draft PR #20 from clean `main` with only the guard added.
- SDK, app, e2e, contract tests, and contract Wasm builds passed.
- The contracts job then failed only at `Reject floating-point Wasm opcodes`.
- Four contracts passed; the float AMM reported 210 rejected opcodes.
- Closed the PR and deleted the temporary branch after capturing the failed
  step log.

Next: fix the SDK simulation source account.

### SDK simulation source fixed

- Added an explicit funded G-account simulation source to the SDK options.
- The app uses the connected wallet for reads when available and the public
  funded testnet deployer address before wallet connection.
- Added a unit test proving reads never call `getAccount` with the market
  C-address.
- SDK typecheck, 32 tests, and build pass.
- App typecheck, 16 tests, and production build pass.
- A direct no-wallet testnet read now returns the live market successfully.
  It also confirms the current deployment has zero PT and SY reserves.
- The Rust workspace remains green except for Claude's three intentionally red
  economics specifications. The auth invariant remains green.

Next: fix and harden the testnet deploy scripts.

---

## Integration: economics + operations merged (2026-06-27)

Codex hit its usage limit partway through its operations lane. Its pushed work
(`fix/audit-operations`: provenance doc, AMM integer math + libm removal, the CI
float guard, and the SDK source-account fix) was merged into the economics
branch on `integrate/economics-and-ops`. Codex's uncommitted deploy-script work
in its separate worktree was not recoverable, so the remaining items were
finished here. The merge was clean apart from PROGRESS.md (both lanes appended).

Completed after the merge (code-only, no testnet needed):

- SDK interface sync: `getPosition` drops the removed rate arg and adds LP
  balance; new `buildClaimYield` targets `tokenizer.claim_yield`; `Position`
  gains `lpBalance`. SDK 33 tests, app 16 tests, both typecheck + build green.
- TTL bumps on SY/PT/YT/tokenizer mutating entrypoints (instance + per-holder
  persistent), matching the AMM's 30/120-day policy. YT checkpoints were already
  persistent and per-holder from the economics rework. Adds a YT TTL test.
- SY principal-on-transfer fix: principal moves pro-rata with shares so
  `accrued_yield` stays correct for both parties after a transfer. New test.
- Deploy script: `--yt_token` added to the AMM init (it would have failed
  without it); env now records the source commit and simulation source account.
- README/REMAINING reconciled with the reworked code: YT claim pays out, PT
  redeems to principal, yield source stated as a pluggable testnet mock (not
  wired to Blend), property-test vs float-guard claim corrected, and a section
  listing the audit items closed by this remediation.
- MAX_FLOAT_HELPER_* renamed to honest names (values unchanged).

Verification: full `cargo test --workspace` green with the integer AMM and the
economics rework together (amm 21, economics 6, journey 5, pt 12-ish, sy 12, yt
10, tokenizer 9); all 5 contract wasm pass the float guard; SDK 33, app 16.

Still pending (need a funded testnet run + wallet, interactive, not headless):
reproducible redeploy from a pinned commit + committed `deployments/testnet.toml`,
AMM liquidity seeding, PT/SY swap proof, the flash-route auth proof on testnet
(the `flash_route_user_only_signs_the_swap` test stays `#[ignore]`d until then),
and the full frontend manual verification pass against the live deployment.

---

## Codex operations loop (2026-06-27)

Baseline:

- Read `AUDIT.md`, `docs/COORDINATION.md`, `docs/PROVENANCE.md`, and
  `docs/PROGRESS.md`.
- Confirmed `main` already contains the provenance finding, AMM integer math,
  float-opcode CI guard, SDK simulation source fix, SDK claim/LP additions, TTL
  bumps, deploy `--yt_token` fix, docs reconciliation, and SY principal transfer
  fix.
- Ran `cargo test --workspace`; full workspace is green. The strict
  `flash_route_user_only_signs_the_swap` test remains ignored as documented
  until testnet auth proof.

Completed in this loop:

- Added `scripts/deploy-testnet-resilient.sh`, a resumable deployment path that
  refuses tracked dirty source by default, persists public partial state, reuses
  the underlying SAC address on rerun, verifies local and on-chain Wasm hashes,
  writes `app/.env.local`, and emits `deployments/testnet.toml`.
- Pointed `make deploy` at the resilient script.
- Added `deployments/README.md` and ignored local deployment state files.

Blocker:

- `stellar` CLI is not installed in this environment, so the pinned testnet
  redeploy, `deployments/testnet.toml`, AMM liquidity seed, and wallet/manual
  frontend verification remain pending for a funded testnet machine.
