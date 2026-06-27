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

## Next: Phase 2 step 1 (denomination) and step 2 (rewrite split)

- Step 1: encode the asset-unit denomination in `tokenizer.split` (mint
  `sy_amount * R / WAD`), document in ARCHITECTURE.md and code comments.
- Step 2: rewrite `tokenizer.split` and update its tests.
- Blocker to clear before step 5: SDK/human ack on the `preview_claim_yield`
  interface change (COORDINATION.md section 2).
