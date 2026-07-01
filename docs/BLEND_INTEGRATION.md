<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fix 2: real yield source (Blend) integration plan

Status: **implemented and proven on testnet**. The wrapper-to-Blend supply and
withdraw authorization paths have passed without permissive auth mocks.

## 1. Why this exists

The `#9 Insolvent` incident's root cause is that the SY exchange rate is an
admin-set number (`sy-wrapper::set_exchange_rate`). It can be dialed below the
level backing outstanding PT, manufacturing an unbacked shortfall. Fix 1 stopped
the market from *freezing* on that shortfall (price, don't block). Fix 2 removes
the *cause*: derive the rate from a real yield source so it moves only with
actual accrued interest and cannot be arbitrarily lowered.

## 2. Decision: Blend (not DeFindex)

Chosen for the first integration:

- A live Blend **v2** pool exists on Stellar testnet with a USDC reserve, so
  there is a concrete target today.
- Blend's interface is verified from source (`submit`, `RequestType`, `b_rate`,
  `get_positions`), and `b_rate` is a cumulative interest index — monotonic under
  normal accrual, which is exactly the property that makes the rate non-decreasing
  by construction.

Tradeoff accepted: Blend's bTokens are **non-transferable**, so SY redemption must
withdraw base USDC from the pool and inherits pool-liquidity risk (a withdraw can
be capped when utilization is high). DeFindex's transferable ERC-4626-style shares
would avoid that and are worth revisiting as a second adapter; DeFindex is a
vault-over-strategies layer that needed more discovery and a factory-deployed
vault, so it is not the first target.

## 3. Testnet addresses (from blend-capital/blend-utils, verify before use)

| Contract | Address |
|---|---|
| Blend v2 pool | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` |
| USDC reserve asset | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |
| Pool factory v2 | `CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6` |
| Backstop v2 | `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA` |
| BLND token | `CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF` |

Note: to use Blend, the SY wrapper's `underlying` must be Blend's USDC reserve
asset, not our own throwaway test-USDC SAC.

## 4. Interface mapping (verified against blend-contracts-v2 `main`)

Blend routes everything through one pool entrypoint:

```rust
fn submit(e, from, spender, to, requests: Vec<Request>) -> Positions;
struct Request { request_type: u32, address: Address, amount: i128 }
// RequestType: Supply=0, Withdraw=1, SupplyCollateral=2, ...
struct Positions { liabilities: Map<u32,i128>, collateral: Map<u32,i128>, supply: Map<u32,i128> }
// reserve.data.b_rate is 12-decimal (SCALAR_12 = 1e12); underlying = b_tokens * b_rate / 1e12
```

`YieldAdapter` → Blend:

| Adapter method | Blend call |
|---|---|
| `supply(amount)` | `submit(self, self, self, [Request{ Supply(0), underlying, amount }])` |
| `withdraw(amount)` | `submit(self, self, self, [Request{ Withdraw(1), underlying, amount }])` |
| `assets_under_management()` | `get_positions(self).supply[idx]` × `get_reserve(underlying).data.b_rate / 1e12` |

Use plain `Supply` (0), not `SupplyCollateral` (2): same interest, stays liquid,
never seized in a liquidation since the wrapper never borrows.

## 5. SY wrapper changes (the wiring)

1. `Config` gains an optional `pool` and `reserve_index` (read once from
   `pool.get_reserve_list()` in `initialize_blend`). The original initializer
   remains the test-only mock path.
2. `deposit` (`sy-wrapper:310`): after pulling underlying in, call `supply(amount)`
   to route it into Blend.
3. `redeem` calls `withdraw(underlying_out)` before pushing underlying to the
   holder. A failed withdraw returns zero without burning shares. A short
   withdraw burns only the shares covered by assets actually received.
4. `exchange_rate` (`sy-wrapper:386`) becomes derived, not stored:
   `rate = assets_under_management() * WAD / total_sy_supply` (WAD if supply == 0).
5. Keep `set_exchange_rate` only for the mock initializer. Blend-backed configs
   reject it with `ReadOnlyExchangeRate`.
6. Blend deposits mint shares from the actual AUM increase after bToken floor
   rounding. This prevents a deposit from lowering the derived rate by one
   underlying stroop.

Decimals cancel: AUM is 7-dec underlying, SY supply is 7-dec, so
`aum * 1e18 / supply` is WAD-scaled. Confirm the pool's USDC is 7-dec.

## 6. Auth and the remaining risk

The wrapper is the direct invoker of `pool.submit`, so Blend's
`spender.require_auth()` uses invoker authorization. Supply separately installs
one argument-pinned `InvokerContractAuthEntry` for the later nested
`underlying.transfer(wrapper, pool, amount)`. Withdraw needs no wrapper-owned
nested authorization because Blend authorizes its own outgoing transfer.

This exact tree passed on testnet without `mock_all_auths` for both supply and
withdraw.

## 7. Testing and migration plan

1. **Rate-math core**: pure `aum`/`derived_rate` functions with
   unit tests over known `b_rate` values. See `contracts/blend-adapter`.
2. **Mock-pool integration test**: a Soroban test double implementing
   `submit`/`get_positions`/`get_reserve`, to exercise `supply`/`withdraw` and the
   derived rate end to end under `mock_all_auths`.
3. **Live testnet**: wrapper `CC7F5EFIIOL73XXN6RN4KQZCLURBUA7FI5V7BUTPQK4UOFFSPBLFEW2E`
   deposited 500,000 reserve units, minted 499,999 SY after Blend rounding, read
   a derived rate of `1000000000000000000`, and redeemed 499,999 reserve units.
   The admin setter rejected with contract error 9.
4. **Lifecycle smoke**: `scripts/smoke-blend-testnet.sh` deploys a fresh
   SY/PT/YT/tokenizer set, waits for positive real b-rate accrual, then claims,
   recombines, and redeems. It supports bounded RPC retries and resuming an
   already-split position.

## 8. Proven scope

- Rate math, live Blend calls, rounding-safe share minting, read-only Blend rate,
  partial-withdraw accounting, and mock-pool lifecycle coverage are implemented.
- No-mock testnet supply: `c12f13641c028c1e8a3e0ef84a58b5d0e970ed06368aee0505e8fa027d7f3310`.
- No-mock testnet withdraw: `148ee417c4b960851e38c5cdddfdf913ac47bf1830276caac703c17a6443bcbb`.
- Remaining underlying risk: Blend withdrawals can fail when pool liquidity is
  unavailable. The wrapper preserves shares and returns zero in that case; it
  does not guarantee immediate liquidity.
