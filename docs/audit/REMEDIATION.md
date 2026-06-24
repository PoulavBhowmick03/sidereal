# Audit remediation tracker

Tracks fixes for the findings in [`2026-06-pre-testnet.md`](./2026-06-pre-testnet.md).
Audit verdict: **NO-GO for testnet** until the two HIGH findings are fixed with
tests. H1, H2, and M2 were independently re-verified against source on
2026-06-24 and confirmed real.

Status: ☐ open · ◐ in progress · ☑ fixed (with test)

## Gate to testnet (must all be ☑)

| ID | Severity | Finding | Owner | Status |
|----|----------|---------|-------|--------|
| H1 | HIGH | LP shares are global; any caller can remove pool liquidity | codex-1 (AMM) | ☑ |
| H2 | HIGH | Same-ledger swaps overwrite the TWAP with spot | codex-1 (AMM) | ☑ |
| M2 | MED  | SY methods mutate state before initialization | codex-2 (sy-wrapper) | ☐ |
| M3 | MED  | Tokenization state uses unchecked i128 arithmetic | codex-2 (sy-wrapper, tokenizer) | ☐ |
| M1 | MED  | SY exact-in swaps do not account for the full `sy_in` | codex-1 (AMM) | ☐ |

## Recommended for testnet (☑ or a written accept-risk note)

| ID | Severity | Finding | Owner | Status |
|----|----------|---------|-------|--------|
| M4 | MED | AMM curve math uses `f64` (precision loss at bounds) | codex-1 (AMM) | ☐ |
| L1 | LOW | Unauthorized admin calls return `NotInitialized` | codex-2 (sy-wrapper, yt) | ☐ |
| L2 | LOW | Long-lived instance state has no TTL/bump strategy | codex-1 + codex-2 (ops) | ☐ |

## Fix notes (acceptance = the fix lands AND a test proves it)

- **H1** — add per-holder LP accounting (`LpBalance(Address)` key). `add_liquidity`
  credits only `from`; `remove_liquidity` requires `lp_in <= holder_lp`, debits the
  holder before reducing reserves. Test: a non-LP caller's `remove_liquidity` fails.
- **H2** — in `sync_twap`, when `elapsed == 0` leave `twap_ln_implied_rate` and
  `last_observation` unchanged (give same-ledger observations zero time weight).
  Test: two swaps at the same timestamp; assert the TWAP does not move to the
  second swap's spot value.
- **M1** — decide exact-in vs max-in for `swap_sy_for_pt` / SY->YT. For exact-in,
  add the full `sy_in` to reserves and fee math; for max-in, return the actual
  spent and refund/avoid the unused. Test: reserve delta equals signed input (or
  returned spent amount).
- **M2** — require `read_config` at the start of every public SY method except
  `initialize`; do not default `exchange_rate` when uninitialized (return/panic
  `NotInitialized`). Test: `deposit` before `initialize` fails.
- **M3** — use the checked i128 helpers consistently in sy-wrapper and tokenizer
  (the AMM already does). Reject overflow with a contract error. Tests: boundary
  cases near `i128::MAX` for deposit, redeem, split, recombine, redeem-at-maturity.
- **M4** — replace `f64` curve helpers (`sqrt`, `ln`, `exp`) with deterministic
  fixed-point math, or enforce and test conservative input bounds against a
  high-precision off-chain reference. Add monotonicity/rounding-direction tests.
  If deferred for testnet, write the accepted-risk note and the input bounds here.
- **L1** — add an `Unauthorized` error; return it on admin mismatch (not
  `NotInitialized`) in `set_exchange_rate` and `seed_checkpoint`.
- **L2** — define a TTL/bump policy for the ~3-month markets; extend instance TTL
  on mutating entrypoints and document the maintenance expectation.

## Process

- Each fix is its own PR off `main` (or grouped per owner per contract), with the
  finding ID in the title and the `Agent:` trailer.
- Keep `cargo test --workspace` green; every fix adds the test named in its row.
- Update the Status column in the same PR. Testnet deploy is unblocked when the
  "Gate to testnet" table is all ☑ and M4/L1/L2 are either ☑ or have an
  accept-risk note.
- Settlement-era cautions (checks-effects-interactions, reentrancy) are tracked in
  [`../REMAINING.md`](../REMAINING.md), not here.
