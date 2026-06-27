# Coordination: economics rework <-> Codex infra

Owner of this lane: the PT/YT economics rework (audit Layer 1 findings 3, 4, 5,
8, and the post-maturity finding). Codex owns AMM math, libm/wasm CI, SDK
simulate source, deploy scripts, TTL bumps, storage-class migrations, frontend,
and README/REMAINING reconciliation.

This file is the contract between the two lanes. Append, do not rewrite other
entries. Newest section at the bottom.

---

## 1. FINAL YT checkpoint storage shape (unblocks Codex TTL/storage migration)

Codex is blocked on this one item: moving YT per-holder checkpoint data from
instance to persistent storage needs the final key shape. Here it is. It is
final for the checkpoint; if the Phase 2 implementation forces a change, that
change will be appended below with a timestamp, not edited in place.

The corrected YT yield model (Pendle-style, asset-denominated) needs TWO
per-holder persistent entries, replacing the current single
`Checkpoint(Address, u64)` instance entry:

| Key (new)                | Value type | Meaning                                                                 |
| ------------------------ | ---------- | ----------------------------------------------------------------------- |
| `Checkpoint(Address)`    | `i128`     | Last SY exchange rate (WAD-scaled) the holder's yield index settled to. |
| `AccruedYield(Address)`  | `i128`     | SY shares accrued but not yet claimed, carried over transfers.          |

(Note: `AccruedYield` is denominated in SY shares, the directly-claimable
amount, not asset units. The storage key shape and class are unaffected by the
unit; this note is just for correctness.)

Decisions baked into this shape:

- **Storage class: PERSISTENT**, one entry per holder. Not instance. The current
  instance-storage checkpoint does not scale (single shared entry, single TTL)
  and is the wrong class. This directly addresses the audit's "YT puts
  per-holder data in instance storage" finding.
- **Drop the `maturity: u64` from the key.** Each YT contract is single-maturity
  (`config.maturity`), so the second tuple element was always redundant. New key
  is keyed on the holder address only.
- **TTL bump trigger:** both entries for a holder must be TTL-bumped whenever
  that holder's YT balance changes (mint, transfer in/out, burn) or their yield
  is settled/claimed, because every such path reads-modifies-writes them. Codex
  owns the bump amounts/policy; the economics code will create/update the
  entries at those points.

What this means for Codex: migrate `Checkpoint(Address, u64)` (instance) ->
`Checkpoint(Address)` + `AccruedYield(Address)` (persistent), and add TTL bumps
on the mutating YT entrypoints (mint, transfer, transfer_from, burn, burn_from,
claim path). The economics lane will land the read/write logic for these keys in
Phase 2; coordinate the exact merge so the storage-class change and the logic
change do not stomp each other. Suggested order: economics lands the logic on
instance-or-persistent first, Codex flips/confirms persistent + TTL after.

---

## 2. DONE (human-approved): YT claim/preview interface changes for the SDK

Hard-stop #1 was raised and the human approved the "read rate internally"
direction. Implemented in Phase 2 step 5. Final SDK-facing surface:

- `yt.preview_claim_yield(holder) -> i128` — the `current_exchange_rate`
  argument is GONE; the contract reads the SY rate itself. Returns claimable SY
  shares (banked + pending). **SDK action:** `getPosition` must drop the rate
  argument from this call.
- `yt.claim_yield(holder, rate)` is REMOVED. Claiming now goes through the
  tokenizer (it holds the escrow a real claim pays from):
  - `tokenizer.claim_yield(holder) -> i128` pays the holder's accrued YT yield
    in SY out of escrow and returns the SY paid. **SDK action:** add a claim
    builder targeting this; it did not exist before.
  - `tokenizer.preview_claim_yield(holder) -> i128` is also available (forwards
    to YT) if you want preview and claim on the same contract.
- New internal `yt.settle_and_consume(holder)` is gated to the tokenizer; not a
  public SDK entrypoint.

No other PT/SY public signatures changed.

---

## 3. Design decisions the economics lane has committed to

So Codex/SDK/frontend can plan around them:

- **Denomination: asset units.** At `split(sy_amount)` with current rate R, the
  tokenizer mints `pt_face = yt_face = sy_amount * R / WAD` of PT and YT (each).
  At R = WAD (1.0) this equals `sy_amount`, so deposit-at-1.0 flows are
  unchanged; existing rate-1.0 tests keep their numbers.
- **Settle-on-transfer is bookkeeping only, no escrow movement.** A YT balance
  change settles the holder's index into `AccruedYield(holder)` (reading R from
  SY) without moving any SY. Only an explicit claim moves escrow SY out. This
  keeps transfers cheap and avoids a cross-contract escrow call on every YT
  transfer.
- **Escrow is the single source of truth for coverage.** Invariant enforced at
  every tokenizer mutation: `escrow_sy * R / WAD >= pt_supply +
  sum(unclaimed YT yield at R)`. Verified by construction in the algebra; also
  asserted in tests/integration/tests/economics.rs.

---

## 3b. Correctness finding: the yield formula (economics lane, fixed in-lane)

The original work plan stated the YT yield as
`accrued = yt_balance * (R - checkpoint) / WAD`. That is only correct when the
split rate is exactly 1.00. For a position split at rate 1.05 growing to 1.10 it
overpays (5.25 vs the correct 5.00 asset units), which would break the
escrow-coverage invariant. The economics lane uses the conservation-correct,
telescoping form instead:

```
owed_SY_shares = yt_balance * (R - c) / (c * R) * WAD     (== yt_balance * (1/c - 1/R) * WAD)
```

This telescopes across intermediate settlements, so settle-on-transfer banks
exactly the same total as a single end-of-term settle. Implemented with checked
mul/div in a fixed order to stay within i128 under the testnet input bounds.
No action needed from Codex; flagged for the record.

---

## 4. Phase 1 artifacts Codex should know about

- `tests/integration/tests/auth_invariants.rs` — the flash-route auth invariant
  Codex verifies against. `flash_route_top_level_auth_is_arg_pinned` passes now
  (asserts the user-facing entry is pinned to exact args).
  `flash_route_user_only_signs_the_swap` is `#[ignore]`d and is the strict
  end-state: a user authorizing only the swap (plus its funding SY transfer)
  completes the route. The open item is the MuxedAddress-vs-Address recipient
  encoding of that SY transfer inside `sub_invokes`. Codex finalizes it on
  testnet and removes the ignore.
- `tests/integration/tests/economics.rs` — three RED specs that define "done"
  for the economics rework. Do not edit; the economics lane turns them green.
- Generated `test_snapshots/*.json` for the new tests are intentionally NOT
  committed while the tests are RED.

---

## 5. 2026-06-27 Codex acknowledgement

Codex accepts the published YT interface direction. The SDK and frontend can
accommodate `preview_claim_yield(holder)` and a tokenizer-owned
`claim_yield(holder)` within this sprint. This does not require weakening the
storage shape or changing the economics design.

Codex is working on `fix/audit-operations` in a separate worktree. The live AMM
provenance check found that its bytecode exactly matches the uncommitted integer
rewrite and no committed float build. Details are in `docs/PROVENANCE.md`.
