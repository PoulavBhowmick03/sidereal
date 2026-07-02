# The user flow: from Blend deposit to fixed or variable yield

This document walks the shipped end-to-end journey through the app, stage by
stage, as a user experiences it. The implementation plan, status, and
remaining work behind this flow live in [USER_FLOW.md](./USER_FLOW.md).

Live figures come from `node scripts/live-blend-rates.mjs` run on 2026-07-03
against the deployed `blend-usdc-q3` market and the Blend v2 testnet USDC
pool.

---

## Stage 1: arrive and discover

A Blend lender opens the marketing page and clicks Launch App, landing on
`/trade`. When their wallet connects, the app reads the Blend pool's
`get_positions` for that address and, if a deposit exists, shows a banner on
that first screen:

> Blend position detected. N USDC supplied in Blend v2 USDC pool, earning
> 0.05%. Tokenize.

No manual input, no address pasting. The hook fires before the user has
clicked anything. (`BlendPositionCard` with `variant="banner"`, driven by
`useBlendPosition` and `useBlendRates`.)

First-time visitors also get a built-in guided tour. A halo and callout point
at the next control, starting with wallet connection, then adapting to either
the detected Blend tokenization path or the fresh USDC mint path. The tour
can be skipped, remembers completion in the browser, and can be replayed from
the help button in the app header.

Before the wallet can deposit or tokenize, it must trust the exact Blend
testnet USDC reserve asset used by this market:

```text
USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56
```

Circle faucet USDC uses a different issuer and will not satisfy this market.
If the app says "trustline missing for Blend testnet USDC", add the custom
asset above in the testnet wallet first, then fund it from the Blend testnet
app or another wallet that already holds that reserve asset.

## Stage 2: decide between fixed and variable

The banner's Tokenize link leads to `/mint`. Users with a detected Blend
deposit see the tokenize panel; users without one see the same choice framed
for fresh capital. Both center on the yield choice card, which presents the
two goals side by side with live numbers:

- **Lock a fixed rate with PT.** The rate shown is the AMM's TWAP-implied
  APY (19.99% on 2026-07-03). Tokenize, sell the YT, and the PT discount is
  the yield kept to maturity.
- **Stay variable or buy YT.** The rate shown is Blend's current supply APR
  (0.05% on 2026-07-03). Keep the YT for future yield, or buy more for
  leveraged exposure to Blend rates.

The card never fakes a number: before the AMM was seeded it said "No
liquidity yet", and while the TWAP window fills it says "Warming up".
(`YieldChoiceCard`, display logic in `app/lib/yieldChoice.ts`.)

## Stage 3: act in one guided flow

The tokenize panel has a goal toggle that decides the signature sequence.
Soroban allows one host-function call per transaction, so each step is its
own wallet signature, submitted strictly in order:

- **Keep PT + YT** (three signatures): withdraw the full deposit from Blend,
  deposit the USDC into SY (the wrapper supplies it straight back into the
  same Blend pool), split the SY into equal PT and YT.
- **Lock fixed rate** (four signatures): the same three, then sell the newly
  minted YT for SY with a 0.5% slippage floor. The receipt preview shows the
  PT kept to maturity and the SY the sale returns.

Every step sizes itself at build time from what actually happened on chain:
the deposit uses what the withdraw really returned, the split uses what the
deposit really minted, and the YT sale sells only the YT the split created.
If the optional fourth signature fails (thin liquidity, price moved), the
panel says so honestly: the position is already tokenized, and the YT can be
sold later on Trade. (`TokenizeBlendPanel`, step builders in
`app/lib/tokenizeSteps.ts`.)

Fresh capital skips the withdraw: the mint form takes a USDC amount and
offers deposit, or deposit plus split, in the same preview-then-sign style.
The choice card's Buy YT link deep-links to `/trade#buy-yt` with the route
preselected.

## Stage 4: manage the position

`/portfolio` is the ongoing home. It shows the PT, YT, and SY balances, the
detected Blend position if any remains, days to maturity, and three
independent actions:

- **Claim YT yield.** Accrued yield is paid out in SY.
- **Recombine PT + YT.** Equal amounts burn back into SY at any time before
  maturity, the early exit.
- **Redeem SY.** Burn SY shares and withdraw their current value in USDC.

Exposure changes happen on `/trade`, which quotes all four routes of the
PT/SY pool (YT trades flash-route through it) with price impact, implied
APY, and a slippage guard before signing.

## Stage 5: exit at maturity

When the market matures, the portfolio page flips to redemption mode: PT
redeems 1:1 for SY, SY unwraps to USDC, and the capital is free to go back
to Blend or anywhere else. YT stops accruing at maturity; PT holders get
exactly the face value they locked.

---

## Current live state and caveats

As of 2026-07-03 on testnet: the AMM holds 25 PT and 25 SY of seeded
liquidity, the TWAP is warm, and the SY exchange rate has started moving
(1 SY = 1.000000017 USDC), which is real Blend interest accruing through
the wrapper.

Two honest caveats about the numbers:

- The 19.99% implied fixed APY reflects how the demo liquidity was priced
  at seeding, not a market consensus. The 0.05% variable APR is the real
  Blend testnet reserve rate (its interest modifier sits at its floor). On
  a live market that spread would be arbitraged; on testnet it simply makes
  the fixed side look generous.
- The last unverified piece is a funded browser-wallet run of the
  four-signature flow, tracked with the rest of the remaining work in
  [USER_FLOW.md](./USER_FLOW.md) section 9. Everything up to that point is
  covered by unit tests and the live e2e suites.
