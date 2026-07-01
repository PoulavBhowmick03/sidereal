<!-- SPDX-License-Identifier: Apache-2.0 -->
# Codex task: finish the Blend yield-source integration (Sidereal Fix 2)

## Mission

Replace Sidereal's admin-set SY exchange rate with a rate derived from a live
Blend v2 lending-pool position, so the rate moves only with real accrued interest
and can never be dialed below the level that backs outstanding PT. Implement it,
test it, and prove it on testnet without permissive auth mocks.

Work in a continuous loop: implement a small step, build, run the full test suite
and the wasm float guard, fix whatever breaks, and repeat until every gate is
green. Do not stop after one pass. Re-verify. Do not declare done until the
no-mock testnet authorization proof (Phase 4) passes on-chain.

## Read first (authoritative, in this order)

1. `AGENTS.md` — sections 1 (non-negotiables) and 3 (interface freeze). These bind you.
2. `docs/BLEND_INTEGRATION.md` — the plan you are executing. This task is its §6-§8.
3. `contracts/blend-adapter/src/lib.rs` — the already-tested rate math. Reuse it; do not reinvent it.
4. `contracts/sy-wrapper/src/lib.rs` — where you wire Blend in.
5. `contracts/shared/types/src/lib.rs` — the frozen `StandardizedYield` trait. Do NOT change its method signatures.
6. `contracts/tokenizer/src/lib.rs` — Fix 1 already landed here (split/recombine price a shortfall instead of freezing, `check_solvency` kept only on `claim_yield`). Do not regress it.
7. `scripts/smoke-testnet.sh` — the end-to-end testnet lifecycle. Reuse and extend it; it is already hardened against testnet flakiness and derives the USDC SAC address deterministically.

## Why this exists

A user hit `HostError: Error(Contract, #9) Insolvent` on the Mint page. Root cause:
the SY rate is `sy-wrapper::set_exchange_rate`, an admin knob. Someone lowered it
below the rate PT was minted at, so the escrow (valued at the lower rate) no longer
covered PT, and the tokenizer's hard `check_solvency` reverted every operation.

Fix 1 (done, verified live on testnet) removed the freeze: mint never blocks, and
recombine/redeem price a genuine shortfall as a pro-rata haircut. Fix 2 (this task)
removes the cause: derive the rate from Blend so the knob is gone.

## Ground truth: Blend v2 interface

Verified against `blend-capital/blend-contracts-v2` `main`. Re-verify from source
if anything below is ambiguous; prefer the `blend-contract-sdk` crate for the
generated Rust pool client instead of hand-declaring the interface.

```rust
// pool/src/contract.rs
fn submit(e: Env, from: Address, spender: Address, to: Address,
          requests: Vec<Request>) -> Positions;
fn get_positions(e: Env, address: Address) -> Positions;
fn get_reserve(e: Env, asset: Address) -> Reserve;
fn get_reserve_list(e: Env) -> Vec<Address>;

// pool/src/pool/actions.rs
struct Request { request_type: u32, address: Address, amount: i128 }
// RequestType: Supply=0, Withdraw=1, SupplyCollateral=2, WithdrawCollateral=3, ...

// pool/src/pool/user.rs
struct Positions { liabilities: Map<u32,i128>, collateral: Map<u32,i128>, supply: Map<u32,i128> }
// plain Supply(0) lands in `positions.supply[reserve_index]` as bTokens.

// pool/src/pool/reserve.rs  (b_rate is 12-decimal, SCALAR_12 = 1_000_000_000_000)
// to_asset_from_b_token(b) = b.fixed_mul_floor(reserve.data.b_rate, SCALAR_12)  // = b * b_rate / 1e12
```

Adapter mapping (already partly implemented in `contracts/blend-adapter`):

| Need | Blend call |
|---|---|
| supply(amount) | `submit(self, self, self, [Request{0 Supply, underlying, amount}])` |
| withdraw(amount) | `submit(self, self, self, [Request{1 Withdraw, underlying, amount}])` |
| assets_under_management | `get_positions(self).supply[idx] * get_reserve(underlying).data.b_rate / 1e12` |
| derived rate | `assets_under_management * WAD / sy_total_supply` (already in blend-adapter) |

Use plain `Supply` (0), not `SupplyCollateral`: same interest, stays liquid, never
seized because the wrapper never borrows.

## Testnet addresses (from blend-capital/blend-utils; verify before use)

- Blend v2 pool: `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`
- USDC reserve asset: `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`
- Pool factory v2: `CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6`
- Backstop v2: `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA`
- BLND token: `CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF`

To use Blend, the SY wrapper's `underlying` must be Blend's USDC reserve asset above.

## The work, in ordered phases (each ends with a hard gate)

### Phase 0 — baseline green
Run `cargo test --workspace`, then `make wasm` and `bash scripts/check-wasm-floats.sh target/wasm32v1-none/release/*.wasm`. All must pass before you touch anything. If not, stop and report exactly what is red.

### Phase 1 — make the rate source pluggable (do NOT break the suite)
The entire existing test suite drives the rate through `set_exchange_rate`. If you delete it, ~80 tests fail. Instead, make the wrapper's rate source selectable:
- Keep a mock/admin rate path (the current `set_exchange_rate` + `DataKey::ExchangeRate`) for tests only.
- Add a Blend path: `Config` gains `pool: Address` and `reserve_index: u32`; when set, `exchange_rate` is derived from Blend and `set_exchange_rate` is rejected.
- `deposit`/`redeem` route through Blend when a pool is configured, and behave as today (idle custody) when it is not.
Gate: `cargo test --workspace` still green (existing tests use the mock path).

### Phase 2 — implement the Blend cross-contract calls
In the wrapper (or a `blend` submodule), implement `supply`/`withdraw` via `pool.submit` with self-authorization, and `assets_under_management` via `get_positions` + `get_reserve.b_rate`. Reuse `sidereal_blend_adapter::{assets_from_b_tokens, derived_exchange_rate}` for the math. Self-auth must argument-pin every sub-invocation, mirroring `contracts/tokenizer/src/lib.rs::authorize_self_call`.
Gate: compiles; float guard passes.

### Phase 3 — mock-pool integration test
Write a Soroban test-double contract that implements `submit`, `get_positions`, `get_reserve`, `get_reserve_list` with a controllable `b_rate`. Add an integration test (under `tests/integration` or the wrapper's tests) that, using this mock and `mock_all_auths`, exercises: deposit -> Blend supply; b_rate rises -> derived rate rises -> YT accrues; redeem -> Blend withdraw; and confirms the tokenizer's `check_solvency` never trips when the rate only increases.
Gate: new test green + `cargo test --workspace` green.

### Phase 4 — no-mock authorization proof (the hard, real part)
Deploy a throwaway SY wrapper pointed at the live Blend pool `CCEBVDYM...` with the USDC reserve as underlying. Deposit a small amount of real testnet USDC, read the derived rate, and redeem, all WITHOUT `mock_all_auths`. The wrapper -> pool `submit` nested authorization tree is the whole risk; iterate on the argument-pinned `InvokerContractAuthEntry` until the tree is accepted on-chain. Capture explorer tx links. Reuse the retry and deterministic-SAC patterns already in `scripts/smoke-testnet.sh`; the deployer identity is `sidereal-deployer` via stellar-cli.
Gate: a real testnet deposit + redeem through Blend with the auth tree accepted, evidenced by tx hashes. If it is rejected, capture the exact `HostError` and the auth entries tried, then keep iterating.

### Phase 5 — end-to-end lifecycle + docs
Add a Blend-backed variant of the smoke lifecycle (deposit -> split -> yield accrues via a real b_rate move or a controlled testnet interaction -> claim -> recombine -> redeem). Update `docs/BLEND_INTEGRATION.md` §8 to state exactly what is now proven. Update README/ARCHITECTURE if they still describe the mock rate as the only source. No document may claim something the code does not do.
Gate: full lifecycle green on testnet; docs match reality.

## Continuous loop discipline (the whole time)

After every code change, in order:
1. `cargo test --workspace`
2. `make wasm && bash scripts/check-wasm-floats.sh target/wasm32v1-none/release/*.wasm`
3. If you touched a testnet path, `DEPLOY_IDENTITY=sidereal-deployer bash scripts/smoke-testnet.sh`.

Never leave the tree red. If a change breaks a test, either fix the code or, when
the test encoded behavior you intentionally changed, update the test and write one
line of working notes explaining why. Re-run until green. Loop back to earlier
phases if a later phase reveals a design flaw.

## Non-negotiables (from AGENTS.md; violating any fails the task)

- Internal TWAP only. No external price oracle. Blend gives you an interest rate, not a price feed; do not wire an oracle.
- Preserve PT + YT = SY and the escrow-coverage invariant. Fix 1 prices shortfalls pro-rata; do not weaken or bypass that.
- Do not change the `StandardizedYield` trait signatures. Only the internal implementation changes. The tokenizer and AMM depend on the trait.
- No hardcoded secrets or keys, ever. Read addresses from `deployments/testnet.toml` or env; the signer is the `sidereal-deployer` stellar-cli identity.
- Apache-2.0 SPDX header on every new source file.
- No em dashes in comments, docs, or any committed prose. Use commas, parentheses, or sentence breaks.
- Code first, deploy second. Nothing reaches testnet until it builds, the float guard passes, and `cargo test --workspace` is green.

## Guardrails (how not to make it worse)

- Do not delete `set_exchange_rate` globally. Gate it behind the mock path so the suite survives; the Blend-backed production config rejects it, so the knob is gone where it matters.
- The nested auth for `pool.submit` is the single highest-risk surface. Argument-pin contract, fn_name, and args on every sub-invocation. Prove it without `mock_all_auths` before trusting it. Passing under mocks proves nothing here.
- Blend `Withdraw` can return less than requested when pool utilization is high. `redeem` must tolerate a partial or failed withdraw rather than assuming full liquidity.
- Decimals: Blend `b_rate` is 12-dec, USDC and SY are 7-dec, the derived rate is 18-dec (WAD). `contracts/blend-adapter` already handles this. Reuse it.
- Do not commit or push unless explicitly told. Leave changes in the working tree.
- If the auth tree resists for more than a handful of iterations, stop thrashing: capture the failing `HostError`, the exact `InvokerContractAuthEntry` you built, and report with a concrete question.

## Definition of done

1. `cargo test --workspace` green, including a new mock-pool integration test for the Blend path.
2. `make wasm` + float guard green.
3. A throwaway SY wrapper backed by the live testnet Blend pool completes deposit -> read derived rate -> redeem WITHOUT `mock_all_auths`, with explorer tx links captured.
4. In the Blend-backed config, `set_exchange_rate` is rejected and the rate is read-only, derived from Blend.
5. `docs/BLEND_INTEGRATION.md` updated to reflect what is proven; no doc overclaims.
6. Working-notes summary: what was implemented, what the accepted auth tree looks like, and any remaining risk (especially withdraw-liquidity handling).
