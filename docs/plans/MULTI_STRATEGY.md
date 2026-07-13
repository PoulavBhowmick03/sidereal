# Multi-strategy expansion plan

Status: proposed implementation plan, 2026-07-12

## Outcome

Sidereal should support many yield strategies without changing the immutable
mainnet Blend market or making one strategy's failure affect another market.
Each strategy gets its own SY, tokenizer, PT, YT, and AMM market. New SY vaults
use a common strategy contract interface, so the tokenizer, AMM, SDK, and app do
not need yield-source-specific settlement logic.

The live Blend market remains a supported v1 market. It is not migrated or
upgraded in place.

## Decisions

1. **One strategy per SY market.** A fungible SY token must represent one clearly
   defined source of risk and return. Combining unrelated strategies would
   socialize losses and withdrawal constraints across every holder.
2. **Immutable strategy binding.** A production SY vault cannot switch its
   strategy after initialization. A new strategy means a new market.
3. **Reusable SY core.** New vaults call a small strategy ABI instead of
   embedding Blend-specific types and reserve logic.
4. **Isolated strategy custody.** Each strategy contract owns only its market's
   external position. It cannot access another strategy or market.
5. **Manifest registry first.** Markets are discovered through reviewed
   deployment manifests. An on-chain registry is deferred until there is a
   concrete permissionless-discovery requirement.
6. **No allocator in v2.** A vault that dynamically spreads deposits across
   several strategies requires allocation governance, loss accounting,
   withdrawal ordering, and a separate audit. It is a later product, not part of
   this expansion.

## Target architecture

```text
Portfolio / market selector
            |
            +-- Market A: Blend USDC v1 (existing, unchanged)
            |
            +-- Market B: SY v2 -> Blend strategy -> Blend pool
            |
            +-- Market C: SY v2 -> Treasury strategy -> RWA vault
            |
            +-- Market D: SY v2 -> Reward strategy -> lending + compounding

Each market: Strategy -> SY -> Tokenizer -> PT + YT -> AMM
```

The tokenizer and AMM continue to depend only on the standardized SY behavior.
Only the SY v2 vault knows that a strategy contract exists.

## Strategy ABI

Add a `strategy-interface` library that generates a Soroban client for this
minimum surface:

```rust
pub trait YieldStrategy {
    fn underlying(env: Env) -> Address;
    fn vault(env: Env) -> Address;
    fn total_assets(env: Env) -> i128;
    fn max_withdraw(env: Env) -> i128;
    fn deposit(env: Env, vault: Address, amount: i128) -> i128;
    fn withdraw(
        env: Env,
        vault: Address,
        amount: i128,
        min_underlying_out: i128,
    ) -> i128;
    fn touch(env: Env);
}
```

Contract rules:

- `deposit` and `withdraw` require authorization from the strategy's configured
  vault and reject every other caller.
- `underlying`, `vault`, and the external protocol binding are immutable after
  one-time initialization.
- `deposit` returns the actual increase in managed assets, not the requested
  amount.
- `withdraw` returns the underlying actually delivered to the vault and must
  satisfy `min_underlying_out`.
- `total_assets` includes idle underlying plus the realizable value of the
  external position. Unclaimed reward tokens are excluded until they are
  converted into the underlying.
- `max_withdraw` reports current realizable liquidity. It is not assumed equal
  to `total_assets`.
- `touch` renews the strategy's own TTL and reads the upstream position through
  a real on-chain transaction so upstream TTL is renewed where supported.

## SY v2 accounting

Add `sy-vault-v2` as a new contract rather than changing `sy-wrapper`, whose
Wasm is already deployed on mainnet.

The vault stores only its immutable strategy address, underlying address, token
accounting, and TTL policy. Its exchange rate remains:

```text
exchange_rate = strategy.total_assets() * WAD / total_sy_supply
```

Deposits use pre-deposit assets and actual balance deltas to prevent donation
and rounding attacks:

1. Read `assets_before` and `supply_before`.
2. Transfer underlying from the user to the vault.
3. Transfer the received amount to the strategy and call `deposit`.
4. Read or verify the actual managed-asset increase.
5. Mint SY using the pre-deposit exchange rate.
6. Enforce user-provided `min_sy_out`.

Withdrawals burn SY before external calls, request underlying from the strategy,
verify the vault's balance delta, and enforce `min_underlying_out`. Any failure
reverts the complete Soroban transaction.

The existing tokenizer already handles a declining SY rate by keeping PT senior
and pricing shortfall pro rata. Every new strategy must still document whether
rate regression is expected, because that changes the product's risk profile.

## Blend strategy

The first adapter moves the current Blend-specific custody logic into a concrete
`strategy-blend` contract:

- Plain-supply only; it never borrows or marks supply as collateral.
- Configuration contains the Blend pool, underlying reserve, and validated
  reserve index.
- AUM is the bToken position valued at Blend's current `b_rate`, plus idle
  underlying.
- Reserve reindex recovery remains restricted to the same underlying asset.
- Supply and withdrawal use exact authorization trees and balance-delta checks.

Blend's 30-day value applies to its pool instance renewal. Blend user positions
use a 100-day threshold and a 120-day renewal target. The Sidereal strategy is a
Blend user, so `touch`, `total_assets`, `deposit`, and `withdraw` must call
`get_positions` or `submit`, renewing the relevant position entry. Sidereal must
not attempt to control the external pool instance TTL.

Once this adapter passes equivalence tests against the live v1 wrapper, the same
Wasm can support additional Blend pools or reserve assets through new isolated
strategy instances.

## Market discovery

Replace the app's single-market assumption with a list of immutable market
manifests:

```text
deployments/markets/mainnet/<market-id>.toml
deployments/markets/testnet/<market-id>.toml
```

Each manifest records:

- market ID, display name, network, and maturity;
- underlying asset and decimals;
- strategy kind, strategy contract, and external protocol addresses;
- SY, tokenizer, PT, YT, and AMM addresses;
- deployment transaction hashes and Wasm hashes;
- risk tier, withdrawal-liquidity notes, and whether rewards are included;
- keeper and monitoring status.

The SDK loads `MarketConfig[]` and requires an explicit market ID for reads and
transactions. The app adds a market selector and scopes balances, quotes, and
transactions to the selected market. Portfolio aggregates read-only balances
across configured markets but executes actions against one market at a time.

## TTL and operations

Every Sidereal v2 contract follows the current policy: renew below 30 days to at
least 120 days. Each strategy also owns an upstream keepalive rule.

The production keeper runs at least weekly and alerts before acting:

1. Check code, instance, and persistent-entry TTL for every Sidereal contract.
2. Call each strategy's `touch` when its own or upstream position TTL approaches
   the configured threshold.
3. Call `observe_rate` near maturity and `freeze_maturity_rate` immediately
   after maturity.
4. Verify PT supply equals YT supply before maturity and escrow covers the
   protocol's priced obligations.
5. Alert on stale rates, reduced `max_withdraw`, paused upstream protocols,
   reserve reindexing, or unexpected rate regression.

Network TTL settings are deployment inputs, not permanent constants. The
deployment script must read mainnet settings and reject a strategy whose target
TTL exceeds the network maximum.

## Delivery phases

### Phase 0: Preserve and baseline v1

- Freeze the deployed v1 Wasm artifacts and manifests.
- Add equivalence fixtures for Blend deposit, rate growth, withdrawal, rounding,
  reserve reindexing, and TTL renewal.
- Record current mainnet and testnet behavior as the compatibility baseline.

Gate: existing contract, SDK, app, and end-to-end tests stay green with no v1
address or ABI changes.

### Phase 1: Strategy interface and Blend extraction

- Add `contracts/strategy-interface`.
- Add `contracts/strategy-blend`.
- Add `contracts/sy-vault-v2`.
- Port Blend math and bindings without changing arithmetic or rounding.
- Prove nested authorization without `mock_all_auths`.
- Deploy a short-maturity v2 Blend market on testnet.

Gate: v1 and v2 produce equivalent SY mint, rate, and redemption results over
the same Blend state, including dust boundaries and liquidity shortfall.

### Phase 2: Multi-market SDK and app

- Introduce versioned market manifests and manifest validation.
- Refactor the SDK client around explicit `marketId` configuration.
- Add market selection to Mint, Trade, Pool, and Portfolio.
- Aggregate portfolio balances without combining market accounting.
- Add strategy and liquidity-risk labels sourced from manifests.

Gate: Playwright completes mint, split, trade, liquidity, claim, recombine, and
redeem against two testnet markets without cross-market address leakage.

### Phase 3: Repeatable Blend markets

- Deploy additional isolated Blend strategies for reviewed pools or assets.
- Reuse the same strategy and SY v2 Wasm hashes.
- Add per-market caps before accepting deposits.
- Validate decimal handling for every underlying.

Gate: each market passes the full adapter conformance suite and live testnet
authorization proof.

### Phase 4: Second strategy family

- Implement a tokenized-treasury or other non-Blend adapter.
- Define valuation, redemption latency, fees, and rate-regression behavior.
- Reject asynchronous redemption in the synchronous ABI unless the product adds
  an explicit request/claim state machine.
- Run an independent security review before mainnet deployment.

Gate: the second adapter proves that the interface is source-agnostic without
weakening withdrawal or valuation guarantees.

### Phase 5: Reward-bearing strategies

- Add explicit reward claiming and conversion to underlying.
- Use protected swap routes with minimum output and freshness limits.
- Include rewards in AUM only after conversion to underlying.
- Separate keeper compensation from user yield accounting.

Gate: adversarial tests cover reward-token price manipulation, failed swaps,
MEV bounds, and stale reward claims.

## Strategy onboarding checklist

A strategy cannot be listed until all answers are recorded in its manifest and
review notes:

- What assets are custodied, and by which contract?
- Can principal decrease, be frozen, or be seized?
- Is valuation based on a manipulable spot price?
- Is withdrawal synchronous, and what limits available liquidity?
- Which fees and rounding rules affect AUM?
- Are rewards part of AUM, and how are they converted?
- What upstream entries require TTL renewal or restoration?
- Can the upstream contract pause, reindex, migrate, or upgrade?
- Which admin keys can change economics or custody?
- What deposit cap limits loss during initial deployment?

## Required tests

- Strategy ABI conformance tests shared by every adapter.
- Exact deposit and withdrawal balance conservation.
- First-depositor and direct-donation tests.
- Rate growth, rate regression, zero supply, and maximum-value arithmetic.
- Insufficient upstream liquidity and partial-withdrawal rejection.
- TTL threshold, renewal, archival, and restoration tests.
- Upstream pause, stale rate, reserve migration, and malformed-return tests.
- Cross-contract authorization snapshots without permissive mocks.
- Randomized tokenizer invariants using each strategy's rate behavior.
- Testnet lifecycle proof before every mainnet market deployment.

## Initial implementation backlog

1. Create the strategy interface and conformance-test harness.
2. Implement `strategy-blend` by extracting the current wrapper's Blend calls.
3. Implement `sy-vault-v2` with immutable strategy binding and slippage bounds.
4. Add deterministic deployment and provenance scripts for a complete market.
5. Deploy and compare a v2 Blend testnet market against v1.
6. Refactor deployment manifests, SDK configuration, and app market selection.
7. Add keeper automation and TTL/rate/liquidity alerts.
8. Onboard a second Blend market, then a non-Blend strategy family.

The first mainnet expansion should occur only after phases 0 through 3 are
complete. The existing Blend market remains available throughout the rollout.
