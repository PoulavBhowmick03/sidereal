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
| `AccruedYield(Address)`  | `i128`     | Asset-unit YT yield accrued but not yet claimed, carried over transfers.|

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

## 2. HEADS-UP: upcoming token interface changes (hard-stop #1 territory)

The corrected economics will change two YT read/claim signatures. Flagging now
so Codex (SDK) and the human can weigh in BEFORE Phase 2 step 5 lands them.
These are NOT yet implemented; Phase 1 only added failing tests.

- `preview_claim_yield(holder, current_exchange_rate) -> i128`
  is expected to become `preview_claim_yield(holder) -> i128`, reading the SY
  rate from the SY contract itself (caller-supplied rate is manipulable) and
  returning yield in **asset units**, not the current share-delta number.
  - Impact: the SDK's `getPosition` calls this with a passed-in rate. That call
    site must change. This trips audit hard-stop #1 (YT public interface change
    that touches the SDK).
- `claim_yield(holder, current_exchange_rate) -> i128` may move onto the
  tokenizer as `claim_yield(holder)` (the tokenizer holds the SY escrow that a
  real claim must pay out of) and read the rate internally.
  - Impact: the SDK has no claim builder today (audit confirms), so consumer
    impact is low, but the entrypoint location/signature is changing.

Codex / human: ack or push back here before Phase 2 step 5. The economics lane
will pause at that step for acknowledgement per hard-stop #1.

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
