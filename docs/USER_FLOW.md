# User flow: from Blend lender to fixed or variable yield

This document describes the intended end-to-end user journey for the
Blend-backed market, where the current app diverges from it, and the
implementation plan to close the gaps. It follows on from the onboarding
surfaces tracked in [REMAINING.md](./REMAINING.md) section 3b. The shipped
flow is written up as a stage-by-stage walkthrough in [FLOW.md](./FLOW.md).

Live figures in this document come from `node scripts/live-blend-rates.mjs`
run on 2026-07-03 against the deployed `blend-usdc-q3` market and the Blend v2
testnet USDC pool (`CCEBVD...Q44HGF`).

Status legend: ☑ done · ◐ in progress · ☐ not started

---

## 1. Plan at a glance

Four pieces of work, in order. All of them are frontend composition over
existing SDK reads and wallet-signed writes: no SDK changes and no backend.

- ☑ **Seed the AMM (prerequisite).** `sidereal-smoke` seeded the deployed
  market with 25 PT and 25 SY of AMM liquidity. The fixed-rate card now has a
  real implied APY. Details in section 4.
- ☑ **Gap 1: position banner on /trade.** Slim `variant="banner"` on
  `BlendPositionCard`, rendered on the trade page (the Launch App landing),
  so a returning Blend lender sees their position on the first screen. Details
  in section 5.
- ☑ **Gap 2: fixed-versus-variable framing.** New `YieldChoiceCard` showing
  "lock a fixed rate (PT)" from `market.impliedApyBps` next to "stay
  variable (YT)" from `rates.supplyApr`, rendered on the mint page and in
  the tokenize panel. Details in section 6.
- ☑ **Gap 3: one-action fixed-rate flow.** Mode toggle in
  `TokenizeBlendPanel` that appends a fourth signature (sell the minted YT
  with a slippage bound) to the existing withdraw, deposit, split sequence.
  The four-step builder is covered by unit tests. A funded browser-wallet run
  remains the final manual verification. Details in section 7.

What is left to finish, in priority order, is tracked in section 9.

## 2. The intended flow

The target persona is a DeFi user who already supplies USDC on Blend (or
would consider it) and arrives with no knowledge of yield tokenization.

1. **Discover.** The user connects a wallet and the app immediately
   recognizes an existing Blend supply position: "You have N USDC supplied on
   Blend earning X% variable." No manual input. This is implemented:
   `useBlendPosition` reads the pool's `get_positions`, and
   `BlendPositionCard` renders the detected deposit.
2. **Decide.** The user picks a goal, not a mechanism:
   - **Lock a fixed rate.** Tokenize, keep PT, sell YT for cash now. The PT
     discount is the guaranteed yield to maturity.
   - **Go long yield.** Keep or buy YT and collect all variable yield the SY
     accrues.
3. **Migrate.** From the position card, "Tokenize this position" leads to
   `/mint`, where `TokenizeBlendPanel` runs the guided three-signature flow:
   withdraw from Blend, deposit into SY, split into PT and YT. Fresh capital
   skips the withdraw and uses deposit or deposit-plus-split.
4. **Manage.** `/portfolio` is the ongoing home: claim accrued YT yield (paid
   in SY), recombine PT and YT back to SY to exit early, adjust exposure on
   `/trade`.
5. **Exit at maturity.** Portfolio flips to redemption mode: PT redeems 1:1
   for SY, SY unwraps to the underlying USDC. Implemented in
   `app/app/(app)/portfolio/page.tsx` (the `matured` branch).

## 3. Where the app diverges today

1. **The entry point misses the hook.** "Launch App" lands on `/trade`, but
   the detected Blend position is only surfaced on `/portfolio` and `/mint`.
   A returning Blend lender's first screen says nothing about their position.
2. **The app is organized by mechanism, not by goal.** Mint, Trade, and
   Portfolio describe how, but the user thinks "I want fixed yield" or "I
   want to bet on rates." Nothing presents the two outcomes side by side with
   their current numbers (implied fixed APY from the AMM versus the live
   variable supply APR from Blend).
3. **The fixed-rate path needs two manual hops.** Locking a rate means
   tokenizing on `/mint`, then walking to `/trade` to sell YT. The flagship
   use case should be one guided action.

## 4. Prerequisite: seed the AMM

The initial live read showed the AMM was unseeded: `totalPt = 0`,
`totalSy = 0`, `impliedApyBps = 0`. Without pool liquidity there was no fixed
rate to display (gap 2) and a YT sale reverted (gap 3).

- Done on 2026-07-02 with:
  `DEPLOY_IDENTITY=sidereal-smoke SEED_AMM=1 DEPOSIT=1000000000 SPLIT=500000000 LIQ_PT=250000000 LIQ_SY=250000000 scripts/seed-demo.sh`.
  Transactions:
  `c42565e7cda144c7ded6f0215d6a76d638d186610b58ec371c785e37c6eb6096`,
  `e7f98aeafd64427a3904895e0b14821e9536d441401d5257b564dcc62c107f53`,
  `2e2eb0cd89ea18dcced39770b66ac1e71c0f2c1a49fb4de23ea5716698706ba2`.
- Dependency: the deployer and any browser wallet running the funded flow
  must hold the exact Blend testnet USDC reserve asset
  (`USDC:GATALT...5V56`), the same constraint as the funded walkthrough in
  [REMAINING.md](./REMAINING.md) section 3b. The wallet must add this custom
  asset trustline before Sidereal can deposit or tokenize. Circle faucet USDC
  uses a different issuer and will not appear in this market.
- Verified with `scripts/live-blend-rates.mjs`: `totalPt = 250000000`,
  `totalSy = 250000000`, `impliedApyBps = 1999`, and `twapWarmingUp: false`.

## 5. Plan, gap 1: surface the position on /trade

Add a slim banner variant of the existing position card to the page users
land on.

- `app/components/BlendPositionCard.tsx`: add `variant?: "full" | "banner"`
  (default `"full"`, so `/portfolio` is unchanged). The banner is a
  single-row strip: amount detected, current variable APR, "Tokenize" link to
  `/mint`. Same early returns (renders nothing for non-blend markets, no
  wallet, or no position).
- `app/app/(app)/trade/page.tsx`: add `useBlendPosition` (the page already
  has `useBlendRates`) and render the banner between the header and
  `PositionCard`.
- Rejected alternative: routing "Launch App" to `/portfolio` when a position
  is detected. Detection is an async read, so the user would land on trade
  and then be yanked to another page when it resolves.
- Tests: component unit tests for both variants and the null cases. The
  banner needs a connected wallet, which e2e does not have, so unit tests
  carry this gap.

## 6. Plan, gap 2: frame the choice as fixed versus variable

A two-outcome comparison with live numbers, shown wherever tokenization is
pitched.

- New `app/components/YieldChoiceCard.tsx`, purely presentational, props
  `{ market, rates, decimals }`:
  - **Lock a fixed rate (PT).** Number from `market.impliedApyBps`, the
    AMM's TWAP-implied APY already returned by `getMarket`. Degenerate
    states render honestly: `twapWarmingUp` shows "market price warming up",
    `totalSy === 0n` shows "no market liquidity yet", never a fake 0.00%.
  - **Stay variable, or go long yield (YT).** Number from
    `blendRateToBps(rates.supplyApr)`, labeled as Blend's current supply
    APR.
  - Each side gets one sentence of meaning and a CTA: PT side to mint with
    split, YT side to the trade page's Buy YT route.
- Render inside `TokenizeBlendPanel` (above the submit button) and on the
  mint page for users without a Blend position.
- Tests: unit tests for the three display branches (real numbers, warming
  up, no liquidity).

## 7. Plan, gap 3: one-action "tokenize and lock fixed rate"

A mode toggle in `TokenizeBlendPanel`; the fixed-rate mode appends a fourth
signature to the existing `submitSequence`.

- Two modes, same pattern as the mint page's mode buttons: **"Keep PT + YT"**
  (current three signatures) and **"Lock fixed rate"** (four signatures:
  withdraw, deposit, split, sell YT).
- The fourth step's `build()` sizes itself at build time like the existing
  steps: read the actual YT balance via `client.getPosition`, quote with
  `client.quoteSwap({ assetIn: "YT", assetOut: "SY", ... })`, then
  `client.buildSwap` with `minAmountOut` derived from the quote minus
  slippage. Extract `applySlippage` and `DEFAULT_SLIPPAGE_BPS` from
  `app/app/(app)/trade/page.tsx` into a shared `app/lib/slippage.ts` instead
  of duplicating them.
- Failure mode is benign and must be messaged: if the YT sale fails (thin
  liquidity, price moved), steps one through three already landed and the
  user holds PT and YT. The error copy should say the position is tokenized
  and point at the trade page to sell the YT, not imply the whole flow
  failed. Verify how `submitSequence` reports a mid-sequence failure and
  hook the message there.
- The panel's receipt preview updates per mode: fixed mode shows
  approximately N PT held to maturity plus M USDC cash now, using the same
  quote.
- Tests: unit test the four-step build logic against the mocked client
  (`app/tests` mock already records built operations); e2e asserts the mode
  toggle renders on a blend market; the final proof is a funded manual run
  through the demo walkthrough.

## 8. Order and verification

1. `chore(scripts)`: the live rates diagnostic (`live-blend-rates.mjs`).
2. Section 4 seeding (operational; commits only if the seed script needs
   fixes).
3. `feat(app)`: gap 1, position banner on trade.
4. `feat(app)`: gap 2, fixed-versus-variable framing.
5. `feat(app)`: gap 3, lock-fixed-rate mode.

Each lands with SDK and app unit tests, typecheck, and the live e2e suite
green. No SDK changes are needed: every builder and read this plan uses
(quotes, swaps, positions, implied APY) already exists, so no backend is
needed either. Reads are client-side RPC simulations and writes are
wallet-signed transactions; a backend only becomes relevant later for
historical rate charts, multi-market discovery, or RPC caching.

Audit state on 2026-07-02: all three gaps are implemented. Typecheck, lint,
app unit tests (42), the live smoke e2e suite (8), and the full local e2e run
(26 passed, 6 skipped) all pass against the deployed testnet market. The only
remaining verification item is the funded browser-wallet four-signature run.

## 9. Remaining work (from the 2026-07-03 audit)

In priority order:

- ☑ **Seed the AMM** (section 4). The deployed market now has 25 PT and 25 SY
  of AMM liquidity and publishes a nonzero implied APY.
- ☑ **Unit tests for the four-step fixed-mode build.** The riskiest new
  code (YT balance delta, quote, minimum-out sizing) lives inside
  `app/lib/tokenizeSteps.ts` and is covered against a mocked client,
  including the "no YT available to sell after split" guard and the
  pre-existing-YT delta case.
- ☑ **Unit tests for the `BlendPositionCard` banner variant** and its null
  cases (non-blend market, no position, missing rates).
- ☑ **Verify the `/trade#buy-yt` deep link on in-app navigation.** Full
  page loads pass e2e, but a Next `Link` navigation updates the URL via
  `pushState`, which fires no `hashchange`; the e2e suite now clicks from
  `/mint` to `/trade#buy-yt` and confirms Buy YT is selected.
- ☑ **Copy fixes.** The yield choice card now targets the mint form in-place,
  the banner fallback reads "a variable rate", and the YT-sale recovery copy
  points users back to Trade with clearer wording.
- ☐ **Funded manual run.** Walk the four-signature lock-fixed-rate flow end
  to end with a faucet-funded wallet via the demo walkthrough, after
  seeding. This remains open because the automated checks do not sign with a
  browser wallet.
- ☑ **Commit.** The work lands as separate local commits by concern.

## 10. Known number-quality caveat

The real pool currently pays little: 38.72% utilization, 0.170% borrow APR,
0.050% supply APR (live read, 2026-07-03; the pool's reactive interest
modifier sits at its 0.1 floor, see `blend-contracts-v2` `ir_mod` bounds).
The gap 2 comparison will be honest but small on testnet. If a demo needs a
visible spread, the lever is operational, not code: push utilization up with
a borrower account, since the third slope of Blend's rate curve above 95%
utilization is steep and not scaled by `ir_mod`.
