# Settlement model

How value moves in Sidereal, and how the current code differs from the earlier
prototype.

## Old model: internal accounting

The first prototype tracked balances in each contract's own storage and never
moved real SEP-41 tokens between contracts:

- The SY wrapper minted "shares" in storage; no underlying was pulled in.
- The tokenizer held PT/YT balances in a `Position(holder, maturity)` struct.
- PT and YT contracts had no balances of their own.
- The AMM tracked `reserve_pt` / `reserve_sy` as numbers; a swap moved no tokens.

A deploy ran and the UI drove on-chain state, but no external token value was
custodied or transferred. In a live demo this looked fake: the balances shown
were contract bookkeeping, not real token holdings.

## New model: real token movement

The core lifecycle now moves real SEP-41 tokens.

### SY wrapper / vault

- `deposit(from, amount)` calls `underlying.transfer(from, vault, amount)` to
  pull the real underlying token into the wrapper, then mints SY shares to the
  user. `shares = amount * WAD / exchange_rate`, checked math.
- `redeem(from, sy_amount)` burns shares and calls
  `underlying.transfer(vault, to, underlying_out)` to return the real token.
- SY itself is a SEP-41 token: real balances with transfer/allowance.
- Public methods fail before `initialize`.

### PT and YT tokens

- Both expose the full SEP-41 surface (balance, transfer, transfer_from,
  approve, allowance, decimals, name, symbol).
- `mint` and `burn` are gated to the tokenizer address (stored at `initialize`,
  `require_auth` on the tokenizer). Unauthorized mint/burn is rejected.
- YT `claim_yield` reads the holder's real YT balance and accrues against
  exchange-rate growth, with per-`(holder, maturity)` checkpoints.

### Tokenizer custody

- `split(from, sy_amount)`: `sy.transfer(from, tokenizer, sy_amount)`, then
  `pt.mint(from, sy_amount)` and `yt.mint(from, sy_amount)`.
- `recombine(from, pt, yt)`: requires `pt == yt`, burns both, then
  `sy.transfer(tokenizer, from, pt)`.
- `redeem_at_maturity(from, pt)`: after maturity, `pt.burn(from, pt)` then
  `sy.transfer(tokenizer, from, pt)` 1:1. New mints are refused after maturity.
- Moving the tokenizer's own custodied SY uses a single-level self-call auth
  helper so the SY contract's `require_auth` on the tokenizer succeeds.

## Invariants

- `PT + YT = SY` for every holder before maturity. Split mints equal PT and YT
  against SY pulled in; recombine burns equal amounts.
- `1 PT -> 1 SY` at maturity.
- Tokenizer SY balance equals outstanding PT (== YT). A test asserts this.
- Vault underlying balance equals total deposits minus redemptions.

## Failure behavior

- Operations that fail (insufficient balance, overflow, before `initialize`,
  unauthorized mint/burn, mint after maturity) revert without mutating balances.
- Overflow in share or tokenization math is rejected by checked arithmetic
  (audit M2/M3), not wrapped.

## What is not yet real-settlement-proven

The PT/SY AMM and the YT flash route move real tokens in tests, but their
authorization tree (nested `authorize_as_current_contract` /
`InvokerContractAuthEntry`) is only exercised under `mock_all_auths`. Passing
those tests does not prove the real auth tree. These paths are experimental and
gated until verified on testnet. See [`REMAINING.md`](./REMAINING.md) section 2.
