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
  - `yt_receives_yield_on_claim` — RED: claim pays YT holder 0 SY today; spec
    wants ~9.09 SY (10 asset units of yield / rate 1.10) for a 100-unit split.
  - `pt_redeems_to_principal_not_share` — RED: PT redeems 1:1 (1_000_000_000
    SY) today; spec wants principal at the maturity rate (909_090_909 SY).
  - `escrow_covers_outstanding_claims` — RED: YT holders receive 0 SY on claim
    today; spec wants real payout plus the escrow-coverage invariant holding at
    every step, escrow draining to ~0 at the end.
- `tests/integration/tests/auth_invariants.rs`:
  - `flash_route_top_level_auth_is_arg_pinned` — GREEN: the user's
    `swap_sy_for_yt` authorization is pinned to the exact `sy_in`/`min_yt_out`,
    and every authorized transfer carries a concrete positive amount.
  - `flash_route_user_only_signs_the_swap` — `#[ignore]`d, the strict end-state
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

## Next: Phase 3 (insolvency guard and post-maturity)

- Step 7: assert the escrow-coverage invariant in-contract after every tokenizer
  mutation (helper, debug_assert in release / hard check in tests).
- Step 8: insolvency guard, cap redemption to recoverable underlying when the
  rate goes backwards; document pro-rata loss allocation.
- Step 9: snapshot the maturity rate so post-maturity rate moves do not change
  redemption; define post-maturity YT settlement (grace window).
Then Phase 4: property test (10k sequences) and ARCHITECTURE reconciliation.
