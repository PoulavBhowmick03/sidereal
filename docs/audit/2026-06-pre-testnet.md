# Pre-Testnet Contract Audit - June 2026

Test result: `cargo test --workspace` passed on 2026-06-24. The run covered 40 Rust tests plus doc tests, including the AMM 10,000-case property test; it emitted one existing `dead_code` warning in `contracts/yt-token/src/lib.rs` tests.

Summary: The contracts are not ready for an untrusted public testnet. The then-current internal-accounting limitation was treated as accepted scope, not as a finding. Even within that model, the AMM has no holder-scoped LP ownership and the TWAP can be overwritten by same-ledger swaps, so the recommendation is **NO-GO for testnet** until the HIGH findings are fixed and tests are added around them.

Scope: `contracts/sy-wrapper`, `contracts/pt-token`, `contracts/yt-token`, `contracts/tokenizer`, `contracts/amm`, and `contracts/shared/types`, with known internal-accounting gaps separated from new audit findings.

## Critical

No critical findings.

## High

### H1. LP Shares Are Global, So Any Caller Can Remove Pool Liquidity

Severity: HIGH

Location: `contracts/amm/src/lib.rs:360`, `contracts/amm/src/lib.rs:371`, `contracts/amm/src/lib.rs:393`, `contracts/amm/src/lib.rs:416`, `contracts/amm/src/lib.rs:425`, `contracts/amm/src/lib.rs:435`

Description: `add_liquidity` updates only `state.total_pt`, `state.total_sy`, and `state.total_lp`; it returns an LP amount but never stores LP ownership for `from`. `remove_liquidity` only checks `from.require_auth()` and `lp_in < state.total_lp`, then subtracts assets from the global reserves. There is no `LpBalance(Address)` key or equivalent holder accounting.

Exploit/impact scenario: Alice seeds the market. Bob, who owns no LP, signs `remove_liquidity(bob, total_lp - 1)` and drains almost all internal PT/SY reserves from the market state. Today this corrupts quotes and pool accounting. Once real token settlement is added, this pattern would become a direct pool-drain unless LP balances are introduced first.

Recommended fix: Track LP balances keyed by provider. On add, credit only the minted LP to `from`; on remove, require `lp_in <= holder_lp`, debit the holder before reducing reserves, and add adversarial tests where a non-LP tries to remove liquidity.

### H2. Same-Ledger Swaps Can Overwrite The TWAP

Severity: HIGH

Location: `contracts/amm/src/lib.rs:719`, `contracts/amm/src/lib.rs:723`, `contracts/amm/src/lib.rs:724`, `contracts/amm/src/lib.rs:729`, `contracts/amm/src/lib.rs:222`

Description: `sync_twap` computes `elapsed = now.saturating_sub(state.last_observation)`, but when `elapsed == 0` it sets `state.twap_ln_implied_rate = observed_ln_rate`. That means a second swap in the same ledger can replace the TWAP with the manipulated spot rate instead of receiving zero time weight.

Exploit/impact scenario: An attacker performs a price-moving swap and then triggers or relies on a TWAP read in the same ledger. Because the TWAP is overwritten, an external integrator reading `twap_apy` can see the attacker's spot rate rather than a 30-minute average. This violates the internal-TWAP manipulation-resistance requirement.

Recommended fix: When `elapsed == 0`, update `last_ln_implied_rate` if needed but leave `twap_ln_implied_rate` and `last_observation` unchanged, or aggregate same-ledger observations with zero time weight. Add a test with two swaps at the same timestamp proving the TWAP does not move to the second swap's spot value.

## Medium

### M1. SY Exact-In Swaps Do Not Account For The Full `sy_in`

Severity: MEDIUM

Location: `contracts/amm/src/lib.rs:291`, `contracts/amm/src/lib.rs:302`, `contracts/amm/src/lib.rs:623`, `contracts/amm/src/lib.rs:637`, `contracts/amm/src/lib.rs:654`, `contracts/amm/src/lib.rs:662`, `contracts/amm/src/lib.rs:667`

Description: `swap_sy_for_pt` and the SY-to-YT route accept `sy_in` as an exact input, but `exact_sy_in_pt_out_or_panic` binary-searches the largest PT output whose `required_sy <= sy_in`. `apply_exact_sy_in_trade_or_panic` then adds only `required_sy` to `state.total_sy`; any difference between `sy_in` and `required_sy` is neither credited to reserves nor returned by the interface.

Exploit/impact scenario: A user signs an exact-input swap for 1,000 SY, but the pool state may only account for 999 SY due to integer search and rounding. In the current internal model this makes accounting and quote semantics ambiguous. With real token transfers, either the user overpays unaccounted dust or the implementation must silently spend less than the signed exact input.

Recommended fix: Decide whether the API is exact-in or max-in. For exact-in, add the full `sy_in` to reserves and include the full amount in fee economics. For max-in, return the actual amount spent and refund or avoid transferring the unused amount. Add tests that assert reserve deltas equal the signed input or the returned spent amount.

### M2. SY Methods Can Mutate State Before Initialization

Severity: MEDIUM

Location: `contracts/sy-wrapper/src/lib.rs:46`, `contracts/sy-wrapper/src/lib.rs:54`, `contracts/sy-wrapper/src/lib.rs:123`, `contracts/sy-wrapper/src/lib.rs:129`, `contracts/sy-wrapper/src/lib.rs:151`, `contracts/sy-wrapper/src/lib.rs:215`

Description: `deposit`, `redeem`, `exchange_rate`, and `accrued_yield` do not require `Config` to exist. `exchange_rate` returns `WAD` when unset, so a caller can call `deposit` before `initialize` and create holder share/principal entries. A later `initialize` writes `TotalShares = 0` without clearing those holder entries.

Exploit/impact scenario: Before initialization, an attacker deposits under their own address. After the admin initializes the contract, total shares no longer match holder shares. Later redemption can underflow total-share accounting or leave corrupted balances that do not reconcile with the initialized market.

Recommended fix: Require `read_config` at the start of every public/state-reading SY method except `initialize`. Do not default `exchange_rate` on an uninitialized contract; return or panic with `NotInitialized`. Add a test that `deposit` before initialization fails.

### M3. Tokenization State Updates Use Unchecked `i128` Arithmetic

Severity: MEDIUM

Location: `contracts/sy-wrapper/src/lib.rs:151`, `contracts/sy-wrapper/src/lib.rs:155`, `contracts/sy-wrapper/src/lib.rs:159`, `contracts/sy-wrapper/src/lib.rs:200`, `contracts/sy-wrapper/src/lib.rs:204`, `contracts/sy-wrapper/src/lib.rs:208`, `contracts/tokenizer/src/lib.rs:141`, `contracts/tokenizer/src/lib.rs:142`, `contracts/tokenizer/src/lib.rs:144`

Description: Several balance and supply updates use raw `+`, `-`, or `+=` on `i128`. The AMM uses checked helpers, but the SY wrapper and tokenizer do not apply the same discipline.

Exploit/impact scenario: A very large amount can overflow holder balances, total shares, tokenizer positions, or escrowed SY. Depending on build/runtime overflow behavior, this can trap a transaction or wrap/corrupt accounting. Either outcome is unacceptable for protocol balances.

Recommended fix: Use checked arithmetic helpers consistently in all contract crates, reject overflow with a contract error, and add boundary tests near `i128::MAX` for deposit, redeem, split, recombine, and maturity redemption.

### M4. AMM Financial Math Uses `f64` For Core Curve Operations

Severity: MEDIUM

Location: `contracts/amm/src/lib.rs:7`, `contracts/amm/src/lib.rs:891`, `contracts/amm/src/lib.rs:904`, `contracts/amm/src/lib.rs:919`, `contracts/amm/src/lib.rs:929`, `contracts/amm/src/lib.rs:934`

Description: The AMM converts fixed-point `i128` values to `f64` for square root, logarithm, and exponentiation. `f64` cannot exactly represent large 18-decimal fixed-point balances, and all outputs are floored back into `i128`.

Exploit/impact scenario: At large balances or near curve boundaries, precision loss can change LP minting, quoted exchange rates, or implied APY. The current property test covers invariant preservation but not price accuracy against a fixed-point reference implementation.

Recommended fix: Replace floating-point curve helpers with deterministic fixed-point math, or enforce conservative input bounds and test them against a high-precision off-chain reference. Add monotonicity, boundary, and rounding-direction tests for `get_exchange_rate`, `ln`, `exp`, and LP square root.

## Low

### L1. Unauthorized Admin Calls Return `NotInitialized`

Severity: LOW

Location: `contracts/sy-wrapper/src/lib.rs:65`, `contracts/sy-wrapper/src/lib.rs:68`, `contracts/sy-wrapper/src/lib.rs:69`, `contracts/yt-token/src/lib.rs:87`, `contracts/yt-token/src/lib.rs:94`, `contracts/yt-token/src/lib.rs:96`

Description: `set_exchange_rate` and `seed_checkpoint` authenticate the supplied admin address and compare it to the stored admin, but a mismatch returns `NotInitialized`. The contract is initialized; the caller is unauthorized.

Exploit/impact scenario: This does not grant access, but it makes monitoring and debugging harder because unauthorized attempts are indistinguishable from deployment/configuration failures.

Recommended fix: Add an `Unauthorized` error and return it on admin mismatch.

### L2. Long-Lived Instance State Has No TTL/Bump Strategy

Severity: LOW

Location: `contracts/amm/src/lib.rs:144`, `contracts/amm/src/lib.rs:491`, `contracts/tokenizer/src/lib.rs:76`, `contracts/tokenizer/src/lib.rs:146`, `contracts/tokenizer/src/lib.rs:149`, `contracts/sy-wrapper/src/lib.rs:54`, `contracts/yt-token/src/lib.rs:146`

Description: All contract state is stored in instance storage, and there are no calls that extend/bump TTL. The MVP maturity is about three months, so live markets need explicit archival planning.

Exploit/impact scenario: If contract instance TTL is not kept alive operationally, market state could require restoration during an active term, disrupting claims, redemptions, quotes, or liquidity operations.

Recommended fix: Define a TTL policy for deployment and mutating entrypoints. Add instance TTL extension where appropriate and document the maintenance expectation for three-month markets.

## Checked And OK

- Re-initialization is guarded in every contract that has `initialize`: SY, PT, YT, tokenizer, and AMM all check for existing config before storing config.
- State-mutating entrypoints require authorization from the relevant address: admin for initialization/admin knobs, holder for tokenizer and YT claim paths, and `from` for AMM swaps/liquidity. H1 is the exception because LP ownership is not checked after `from` auth.
- The AMM pricing path does not read an external oracle or cross-contract price feed. Pricing comes from internal reserves, time-to-maturity, the curve, and stored TWAP state.
- Maturity gates are directionally correct: mint/split/swap/liquidity paths reject `timestamp >= maturity`, while PT/tokenizer redemption allows `timestamp == maturity`.
- AMM public rate views return zero at or after maturity.
- The tokenizer's current internal-accounting split, recombine, and maturity redemption paths preserve `PT + YT = SY` for normal ranges and are covered by unit tests.
- YT checkpoint storage is keyed by `(holder, maturity)`, and lower claim exchange rates are rejected.
- No unbounded iteration over user-controlled collections was found in the contract crates.
- Source files under `contracts/` and `tests/integration/` have Apache-2.0 SPDX headers.
- No hardcoded private keys were found in the audited contract/test scope.
- Contract crate dependencies are limited to `soroban-sdk`, `sidereal-shared-types`, `libm`, and test-only `proptest`; no copyleft contract dependency was identified in `Cargo.toml`.
- The AMM property suite is configured for 10,000 cases and passed in the audit run.

## Deferred

- Real SEP-41 settlement is not implemented yet. SY deposits/redemptions, tokenizer custody, AMM reserves, and PT/YT balances are internal accounting by documented design.
- The YT flash routes currently reuse PT/SY reserve math and do not call tokenizer split/recombine or move real PT/YT/SY. This is the WS-5 settlement task, not a separate finding in this pass.
- `claim_yield` currently accepts caller-supplied `yt_balance` and `current_exchange_rate` at `contracts/yt-token/src/lib.rs:107` and `contracts/yt-token/src/lib.rs:130`. This is not value-draining until real yield transfers exist, but WS-2 must replace those inputs with the holder's real YT balance and the SY contract's exchange rate, capped to the maturity accrual period.
- When real token transfers are added, use checks-effects-interactions discipline around every cross-contract token call: validate and debit internal balances before token-out transfers, verify token-in transfers before crediting reserves, reconcile reserves against actual token balances, and add reentrancy/regression tests for swap, remove-liquidity, recombine, redeem, and claim paths.
