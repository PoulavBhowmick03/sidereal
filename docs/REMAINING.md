# What remains: real token settlement

The MVP on `main` is complete and green (~94 tests) but uses **internal
accounting**: contracts track balances in their own storage and never move real
SEP-41 tokens between each other. A deploy runs and the UI drives on-chain
state, but no external value is custodied and the YT flash route does not
settle. This document is the detailed plan to close that gap.

Status legend: ☐ not started · ◐ in progress · ☑ done

---

## 0. The invariant that must survive

`PT + YT = SY` at all times before maturity, and `1 PT -> 1 SY` at maturity.
Every change below keeps the frozen `StandardizedYield` and `Market` trait
signatures in `contracts/shared/types` **unchanged**. The new token methods on
PT/YT are **additive** (a SEP-41 surface), so this is not a frozen-interface
change under AGENTS.md section 3, but it does span two columns and needs the
coordination note in the PR.

## 1. The model we are moving to

Today (internal accounting):

- SY wrapper mints "shares" in its own storage; no underlying is pulled in.
- Tokenizer holds PT/YT balances in a `Position(holder, maturity)` struct.
- PT/YT contracts have no balances at all.
- AMM tracks `reserve_pt`/`reserve_sy` as numbers; no tokens move on a swap.

Target (real settlement):

- SY wrapper is a vault: `deposit` pulls the underlying SEP-41 token from the
  user into the wrapper; `redeem` sends it back. SY itself becomes a real
  balance the wrapper mints/burns.
- PT and YT become SEP-41 tokens with real per-holder balances, mintable and
  burnable only by the tokenizer.
- Tokenizer custodies SY: `split` pulls SY in, mints PT+YT to the user;
  `recombine` burns PT+YT, returns SY; `redeem_at_maturity` burns PT, returns SY.
- AMM custodies PT and SY: `add_liquidity`/swaps move real tokens in and out,
  and `reserve_pt`/`reserve_sy` read (or reconcile against) actual balances.

---

## 2. Workstreams

### WS-1 — SY wrapper becomes a real vault ☐ (owner: codex-2)

- Make SY a SEP-41 token (balance/transfer/allowance), minted on `deposit`,
  burned on `redeem`. Use the OpenZeppelin Soroban fungible vault extension
  (`stellar-tokens::fungible::extensions::vault`) per AGENTS.md section 5, or a
  hand-rolled SEP-41 if the dependency is heavy.
- `deposit(from, amount)`: `token::Client(underlying).transfer(from, this, amount)`
  then mint shares to `from`. Keep `shares = amount * WAD / exchange_rate`.
- `redeem(from, sy_amount)`: burn shares, `transfer(this, from, underlying_out)`.
- Keep `exchange_rate`, `accrued_yield`, and the admin `set_exchange_rate`
  (the testnet yield knob) working unchanged.
- Tests: deposit pulls real tokens (use a registered Stellar Asset Contract in
  the test env), redeem returns them, balances reconcile, invariant holds.

Acceptance: `cargo test -p sidereal-sy-wrapper` green; a test asserts the
wrapper's underlying balance equals total deposits minus redemptions.

### WS-2 — PT and YT become SEP-41 tokens ☐ (owner: codex-2)

- Add the SEP-41 surface to both: `balance`, `transfer`, `transfer_from`,
  `approve`, `allowance`, `decimals`, `name`, `symbol`.
- Add `mint(to, amount)` and `burn(from, amount)` gated to the tokenizer address
  (stored at `initialize`; `require_auth` on the tokenizer).
- YT keeps `claim_yield` but it now reads the holder's real YT balance instead
  of a number passed in. Update `preview_claim_yield`/`claim_yield` signatures'
  internals (not the trait) accordingly, and keep per-`(holder, maturity)`
  checkpoint storage (AGENTS.md section 5).
- Tests: only the tokenizer can mint/burn; transfers move balances; YT yield
  accrues against the real balance.

Acceptance: `cargo test -p sidereal-pt-token -p sidereal-yt-token` green;
unauthorized mint/burn rejected.

### WS-3 — Tokenizer custodies SY and drives PT/YT ☐ (owner: codex-2)

- `split(from, sy_amount)`: pull SY from `from` into the tokenizer
  (`sy.transfer(from, this, sy_amount)`), then `pt.mint(from, sy_amount)` and
  `yt.mint(from, sy_amount)`. Drop the internal `Position` struct (PT/YT
  balances now live on the token contracts).
- `recombine(from, pt, yt)`: require `pt == yt`, `pt.burn(from, pt)`,
  `yt.burn(from, yt)`, `sy.transfer(this, from, pt)`.
- `redeem_at_maturity(from, pt)`: after maturity, `pt.burn(from, pt)`,
  `sy.transfer(this, from, pt)` (1:1). YT becomes worthless; refuse new mints.
- Keep `preview_split`/`preview_recombine` (still 1:1) and `is_matured`.
- Update the integration tests in `tests/integration` to register real SY/PT/YT
  and assert escrow balances.

Acceptance: `cargo test -p sidereal-tokenizer` and the integration suite green;
a test asserts `tokenizer SY balance == sum of outstanding PT (== YT)`.

### WS-4 — AMM custodies PT/SY for liquidity and swaps ☐ (owner: codex-1)

- `add_liquidity`/`remove_liquidity`: move real PT and SY between the user and
  the pool; mint/burn LP (LP can stay internal for the MVP or become SEP-41).
- `swap_pt_for_sy`/`swap_sy_for_pt`: transfer the input token in, the output
  token out; keep the time-decay curve and TWAP update unchanged.
- `reserve_pt`/`reserve_sy` read actual token balances (or reconcile against
  them) so the internal-TWAP pricing path stays oracle-free (non-negotiable #1).
- Tests: reserves equal real balances after each op; round-trip pays the fee.

Acceptance: `cargo test -p sidereal-amm` green including the property suite
(PT+YT=SY across 10k swaps) against real token movements.

### WS-5 — YT flash route settles atomically ☐ (owner: codex-1, needs WS-2/3)

The hard one (AGENTS.md section 4). `swap_sy_for_yt(from, sy_in, min_yt_out)`:

1. take `sy_in` SY from the user,
2. flash-borrow additional SY from the pool against the curve,
3. `tokenizer.split` the combined SY into PT + YT,
4. return PT to the pool (repaying the borrow), keep the curve consistent,
5. send YT to the user; revert the whole tx if `yt_out < min_yt_out`.

`swap_yt_for_sy` is the inverse (recombine path). Atomicity is enforced by
Soroban auth + a single transaction: if any step fails, everything reverts.

Acceptance: integration test buys YT with SY and the user ends with real YT and
the pool is made whole; `swap_yt_for_sy` round-trips; property test still holds.

### WS-6 — Plumb settlement through SDK + frontend ☐ (owner: claude-1/claude-2)

- SDK: `getPosition` reads PT/YT via the token `balance` methods (not the
  tokenizer Position); add `buildApprove` if a swap needs an allowance first;
  drop the now-unused tokenizer `position` read.
- Frontend: remove the trade-page "YT may not settle" warning once WS-5 lands;
  add an approve step to mint/trade if the underlying/SY needs an allowance.
- e2e: promote `app/e2e/flow.spec.ts` from skipped to a real testnet run gated
  on `E2E_MARKET_DEPLOYED=1`, driving mint -> split -> swap -> redeem.

Acceptance: SDK + app tests green; the full e2e flow passes against a seeded
testnet deployment.

---

## 3. Sequencing

```
WS-1 (SY vault) ─┐
WS-2 (PT/YT SEP-41) ─┼─> WS-3 (tokenizer custody) ─> WS-5 (YT flash route) ─> WS-6 (SDK/UI)
WS-4 (AMM custody) ──┘
```

WS-1, WS-2, WS-4 can proceed in parallel. WS-3 needs WS-1+WS-2. WS-5 needs
WS-2+WS-3+WS-4. WS-6 is last. Each workstream is its own PR with the
cross-column coordination note; keep every existing test green at each step.

## 4. Definition of done

- All six workstreams checked; `make test` green (contracts + integration +
  SDK + app), property suite green against real token movements.
- A seeded testnet deployment lets a wallet complete mint -> split -> swap (PT
  and YT) -> recombine -> redeem end to end.
- README "Current limitations" reduced to the genuinely out-of-scope items
  (multiple maturities/underlyings, governance, mainnet, audit).

NEXT_PUBLIC_SOROBAN_RPC_URL = https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE = Test SDF Network ; September 2015  
NEXT_PUBLIC_MARKET_ID = blend-usdc-q3  
NEXT_PUBLIC_TOKEN_DECIMALS = 7
NEXT_PUBLIC_SY_ADDRESS = <SY contract id>
NEXT_PUBLIC_PT_ADDRESS = <PT contract id>
NEXT_PUBLIC_YT_ADDRESS = <YT contract id>
NEXT_PUBLIC_TOKENIZER_ADDRESS = <tokenizer contract id>
NEXT_PUBLIC_MARKET_ADDRESS = <AMM contract id>
