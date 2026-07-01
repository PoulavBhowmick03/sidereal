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
- ☑ **YT yield claim pays out.** `tokenizer.claim_yield` settles the holder's
  accrued yield and transfers it in SY out of escrow. Yield uses the
  conservation-correct telescoping formula and is transfer-safe (both parties
  settle on every YT balance change). Per-holder state is persistent.
- ☑ **Tokenizer custodies SY, asset-unit denomination.** `split` pulls SY and
  mints `sy_amount * rate / WAD` of PT and YT (asset units); `recombine` burns
  equal PT+YT and returns principal; `redeem_at_maturity` redeems PT for its
  principal (`amount * WAD / maturity_rate`), not 1:1 in shares, so PT no longer
  captures the yield that belongs to YT. The escrow-coverage invariant is
  asserted in-contract on every mutation, with a pro-rata insolvency cap.
- ☑ **Audit M2/M3.** SY methods are gated on `initialize`; tokenization uses
  checked math (overflow rejected).
- ☑ **SDK + frontend track the real-token model** for the core lifecycle
  (deposit/split/recombine/redeem/claim).

Verification: `cargo test --workspace` green; integration journeys assert real
balances; frontend smoke/interaction e2e green (deployed-market flow gated on
`E2E_MARKET_DEPLOYED`).

## 1b. Closed by the audit remediation (2026-06-27)

The pre-testnet audit found defects that are now fixed. Closed items:

- ☑ **AMM wasm float blocker (audit Layer 1 finding 1).** The AMM used `libm`
  f64 sqrt/log/exp, which the Soroban wasm VM rejects at upload, so `main` was
  undeployable. Replaced with integer fixed-point; `libm` removed. A CI guard
  (`scripts/check-wasm-floats.sh`) builds every contract to wasm and fails on any
  float opcode, so this cannot regress. Closed in `6132f1c`, guard in `826cb31`.
- ☑ **Inverted PT/YT economics (audit Layer 1 findings 3, 4).** PT redeemed 1:1
  in appreciating shares (capturing the yield) and `claim_yield` paid nothing.
  Reworked: PT redeems to principal, YT is paid its yield in SY from escrow,
  conserved across transfers. See `ARCHITECTURE.md` section 3.
- ☑ **Escrow insolvency (audit Layer 1 finding 5, Layer 8).** Escrow-coverage
  invariant asserted in-contract; redemption capped pro-rata under a rate
  regression; maturity rate frozen so post-maturity moves cannot change
  redemption.
- ☑ **SDK simulation source-account bug (audit Layer 4).** Reads sourced
  simulations from the market C-address, which RPC cannot load. Now uses a funded
  G-account (connected wallet or a public fallback). Closed in `7a62124`.
- ☑ **SDK interface drift.** `getPosition` dropped the removed rate argument and
  added LP balance; a `buildClaimYield` builder targets `tokenizer.claim_yield`.
- ☑ **Deploy script missing `--yt_token` (audit Layer 7).** `scripts/deploy-testnet.sh`
  now passes `--yt_token` to the AMM init and pins the source commit.
  `scripts/deploy-testnet-resilient.sh` is the resumable path: it persists
  partial addresses, reuses the SAC address on rerun, and writes
  `deployments/testnet.toml`. The live redeploy from a pinned commit still needs
  a funded testnet run, see section 2.
- ☑ **TTL strategy (audit Layer 7).** SY/PT/YT/tokenizer now bump instance and
  per-holder persistent TTL on every mutating entrypoint; YT checkpoints are
  persistent and per-holder.
- ☑ **SY principal-on-transfer (audit Layer 1 cosmetic).** Principal now moves
  pro-rata with shares, so `accrued_yield` stays correct after a transfer.

Provenance of the live testnet deployment is recorded in `docs/PROVENANCE.md`.

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

The core lifecycle was walked on testnet on 2026-06-27 from commit `cdf9b3e`.
All addresses and per-transaction explorer links are in
`deployments/testnet.toml`. The maturity-redeem step ran against a separate
short-maturity test market (same wasm, 20-minute term) so the full
deposit/split/redeem path could be proven without waiting out the 90-day main
market.

This walk is reproducible: `bash scripts/smoke-testnet.sh` deploys a fresh
throwaway short-maturity market and runs the whole lifecycle
(deposit, split, claim, recombine, re-split, redeem at maturity, SY redeem),
asserting every economic result against its closed-form expectation. It is
hardened against the testnet RPC's transient errors (sequence lag, submission
timeouts, load-balanced-replica read lag and stale-state simulation) so it can
run unattended, and it tops the vault up with the underlying the mocked rate
implies (the testnet stand-in for real yield accrual).

- ☑ Deploy underlying SAC, SY wrapper, PT, YT, tokenizer (and AMM separately) to
  testnet. Addresses recorded in `deployments/testnet.toml`.
- ☑ Initialize in dependency order; addresses written to `app/.env.local` and
  the committed `testnet.toml`.
- ☑ Deposit underlying, assert SY minted (100 USDC in, 100M SY shares out).
- ☑ Split SY, assert PT and YT balances on the real token contracts (50M SY ->
  50M PT + 50M YT at rate 1.0).
- ☑ Bump mock exchange rate (1.0 -> 1.1), claim yield with YT, assert payout
  (`preview_claim_yield` = 4545454, `claim_yield` paid 4545454 SY from escrow;
  matches the telescoping formula).
- ☑ Recombine PT+YT, assert SY returned and PT/YT burned (50M PT+YT -> 45454545
  SY principal at rate 1.1; total recovered 99999999, conservation holds to 1
  dust).
- ☑ Advance maturity, redeem PT, assert principal returned. On the test market:
  rate frozen at 1.20 at maturity, `redeem_at_maturity` paid 8333333 SY
  (= 10M PT * WAD / 1.2, principal not 1:1), PT burned to 0; SY redeem then
  returned 9999999 underlying USDC (~10M principal recovered).
- ☑ Capture explorer links for each transaction for the demo (in `testnet.toml`).
- ☑ Frontend reads the live deployment: headless SDK `getMarket` / `getPosition`
  succeed against the live contracts via the public simulation source, and the
  dev server serves the homepage with no "no market configured" banner.
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
NEXT_PUBLIC_YIELD_SOURCE_KIND  = blend
NEXT_PUBLIC_YIELD_SOURCE_NAME  = Blend v2 USDC pool
NEXT_PUBLIC_YIELD_SOURCE_POOL_ADDRESS    = <Blend pool contract id>
NEXT_PUBLIC_YIELD_SOURCE_RESERVE_ADDRESS = <Blend reserve asset contract id>
NEXT_PUBLIC_YIELD_SOURCE_URL   = https://docs.blend.capital/
NEXT_PUBLIC_SY_ADDRESS         = <SY contract id>
NEXT_PUBLIC_PT_ADDRESS         = <PT contract id>
NEXT_PUBLIC_YT_ADDRESS         = <YT contract id>
NEXT_PUBLIC_TOKENIZER_ADDRESS  = <tokenizer contract id>
NEXT_PUBLIC_MARKET_ADDRESS     = <AMM contract id>
```
