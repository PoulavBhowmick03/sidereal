# What remains

The real-token settlement work (WS-1 through WS-6) has landed on the `rahul`
branch (PR #18). The protocol no longer uses internal accounting for the core
lifecycle: it moves real SEP-41 tokens for deposit, split, recombine, redeem,
and yield claim. This document tracks what is done, what is genuinely left, and
the gate that keeps the AMM and YT flash route out of the demo until proven.

Status legend: ☑ done · ◐ in progress · ☐ not started

---

## 1. Completed: real settlement core (Tier 1)

These ship and are covered by tests that reconcile balances against the actual
token contracts.

- ☑ **SY wrapper is a real vault.** `deposit` pulls the underlying SEP-41 token
  into the wrapper and mints SY shares; `redeem` burns shares and returns the
  underlying. SY is a transferable SEP-41 balance. Exchange-rate math is
  checked; public methods fail before `initialize`.
- ☑ **PT and YT are real SEP-41 tokens.** Full balance/transfer/allowance
  surface. `mint`/`burn` are restricted to the tokenizer; unauthorized mint/burn
  is rejected.
- ☑ **YT yield claim reads real balances.** Yield accrues against the holder's
  real YT balance and exchange-rate growth, with per-holder checkpoints.
- ☑ **Tokenizer custodies SY.** `split` pulls SY from the user and mints equal
  PT+YT; `recombine` burns equal PT+YT and returns SY; `redeem_at_maturity`
  burns PT and returns SY 1:1. Minting after maturity is refused. A test asserts
  the tokenizer's SY balance equals outstanding PT (== YT).
- ☑ **Audit M2/M3.** SY methods are gated on `initialize`; tokenization uses
  checked math (overflow rejected).
- ☑ **SDK + frontend track the real-token model** for the core lifecycle
  (deposit/split/recombine/redeem/claim).

Verification: `cargo test --workspace` green; integration journeys assert real
balances; frontend smoke/interaction e2e green (deployed-market flow gated on
`E2E_MARKET_DEPLOYED`).

## 2. Remaining: AMM + auth (Tier 2, gated)

The AMM and YT flash route are implemented but **not proven**. They are the
follow-up work, behind the testnet auth gate.

- ◐ **AMM custody and swaps.** `add_liquidity` and PT/SY swaps move real tokens
  and reserves reconcile against balances in tests, but only under
  `mock_all_auths`.
- ☐ **YT flash route auth.** `swap_sy_for_yt` / `swap_yt_for_sy` settle through
  the tokenizer in one transaction using a nested
  `authorize_as_current_contract` / `InvokerContractAuthEntry` tree. This is
  proven only under permissive auth mocks (`mock_all_auths` /
  `mock_all_auths_allowing_non_root_auth`). The exact production auth entries
  (argument encoding for each sub-invocation) are not verified.
- ☐ **Testnet auth proof.** Run the AMM and YT flash paths on testnet without
  permissive mocks and confirm the authorization tree is accepted.

Until item 3 passes, the AMM and YT flash route stay marked experimental in the
README, docs, and UI, and are not part of the grant demo.

## 3. Testnet verification checklist

- ☐ Deploy underlying SAC, SY wrapper, PT, YT, tokenizer (and AMM separately) to
  testnet via `scripts/deploy-testnet.sh`.
- ☐ Initialize in dependency order; confirm addresses written to `app/.env.local`.
- ☐ Deposit underlying, assert vault underlying balance increases and SY minted.
- ☐ Split SY, assert PT and YT balances on the real token contracts.
- ☐ Bump mock exchange rate, claim yield with YT, assert payout.
- ☐ Recombine PT+YT, assert SY returned and PT/YT burned.
- ☐ Advance maturity, redeem PT, assert underlying returned 1:1.
- ☐ Capture explorer links for each transaction for the demo.
- ☐ (Tier 2, only if pursuing) add liquidity and run a PT/SY swap on testnet
  without `mock_all_auths`; then the YT flash route.

## 4. Known risks

- The YT flash route's nested auth is the highest-risk surface; passing tests
  under `mock_all_auths` does not prove the real authorization tree.
- The SY wrapper redeem and tokenizer custody transfers use a self-call auth
  helper (`authorize_self_call`) for moving the contract's own custodied
  balance. This is single-level (lower risk than the AMM nesting) but should
  still be confirmed on testnet.
- Exchange rate is an admin-set testnet knob, not a real oracle (internal TWAP
  only by design).

## 5. Non-goals (for this sprint)

- Multiple maturities or multiple underlyings.
- Governance, fee switches, mainnet.
- Third-party audit (testnet prototype only).
- A permissionless AMM or "full Pendle-like" positioning until auth is proven.

---

## Reference: testnet env vars (`app/.env.local`)

```
NEXT_PUBLIC_SOROBAN_RPC_URL    = https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE = Test SDF Network ; September 2015
NEXT_PUBLIC_MARKET_ID          = blend-usdc-q3
NEXT_PUBLIC_TOKEN_DECIMALS     = 7
NEXT_PUBLIC_SY_ADDRESS         = <SY contract id>
NEXT_PUBLIC_PT_ADDRESS         = <PT contract id>
NEXT_PUBLIC_YT_ADDRESS         = <YT contract id>
NEXT_PUBLIC_TOKENIZER_ADDRESS  = <tokenizer contract id>
NEXT_PUBLIC_MARKET_ADDRESS     = <AMM contract id>
```
