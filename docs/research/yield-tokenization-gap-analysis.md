# Yield tokenization gap analysis — what Sidereal has, what the category expects, what's open to build

Date: 2026-07-12. Written against the mainnet deployment of 2026-07-11
(commit `67151f8`, manifest `deployments/mainnet.toml`) and the post-launch
state of `findings.md`. Peer-protocol claims are sourced from public docs and
2026 ecosystem reporting (links at the bottom); repo claims are verified
against source. Items marked *(inference)* were not verified in code — check
before acting on them.

This document deliberately does **not** rank the items. Grouping is by kind of
gap, not by priority — sequencing is a strategy call this doc only feeds.

---

## 1. Where Sidereal stands today

Verified against the repo:

- **One market, one asset, one term.** A single PT/YT/SY series over the Blend
  v2 `FixedV2` USDC pool, 30-day cycle maturing 2026-08-09 15:39 UTC
  (`deployments/mainnet.toml`). No factory contract; a second market means a
  second manual deploy of the full stack (`contracts/` has no factory crate).
- **Full lifecycle settles real funds.** Deposit, split, recombine, claim,
  redeem, PT/SY swaps, and the YT flash route are proven end-to-end on mainnet
  (`docs/testing/mainnet-usage-2026-07-11.md`).
- **Single shared liquidity book** (Pendle-V2-style time-decaying AMM; YT
  routes through the same pool via flash split/recombine) — but seeded with
  only ~5 USDC per side, so trading is not usable at size today.
- **Immutable contracts, single-key admin** whose only power is the
  constrained reserve-index migration (README §Deployed contracts).
- **No professional audit.** Internal loops (three audit rounds, cohort sim,
  live user-simulation, Codex delta audit clean at `fa2deb7`) but no third
  party (README §Status).
- **Ops is manual.** `observe_rate` before maturity and `freeze_maturity_rate`
  after it are standing human duties (`docs/deploy/PROVENANCE.md` §Post-deploy
  operations), as is LP TTL keepalive. The current deployment was provisioned
  as a one-shot 120-day-TTL cycle.
- **Frontend surface:** mint, trade, pool, portfolio, redeem, demo. No
  analytics/stats page, no zap/one-click flows, no rollover UX.

---

## 2. Category table stakes Sidereal doesn't have yet

These are features every mature yield tokenization protocol (Pendle, Spectra)
ships, and that users coming from those protocols will expect. Absence of each
is a concrete, buildable workstream.

### 2.1 Multiple concurrent maturities (a term structure)

Pendle and Spectra list several maturities per asset simultaneously; the
spread between them *is* the yield curve, and it's what makes the product a
fixed-income market rather than a single bet. Sidereal's maturity is a
per-market init parameter, so this is a deployment/orchestration problem, not
a contract redesign — but three things have to exist first:

- **A market registry or factory** so the SDK/frontend can enumerate markets
  instead of reading one hardcoded env set (`app/.env.example` is a single
  market's addresses).
- **Per-term AMM parameterization** — `initial_anchor` must be recomputed per
  term (`docs/deploy/MAINNET_PARAMETERS.md` gives the formula
  `initial_anchor^(365 / maturity_days) − 1`).
- **TTL strategy for long terms.** The 120-day minimum persistent TTL covers a
  30-day market; a 6–12-month market needs scheduled `ExtendFootprintTTLOp`
  renewal in ops (currently explicitly "no renewal needed for a one-shot
  cycle", `deployments/mainnet.toml`).

### 2.2 Market rollover

When a Pendle market matures, users are prompted (and in the 2026 roadmap,
auto-rolled) into the next series. Sidereal has no successor-market concept at
all: after 2026-08-09 the protocol has zero live markets until someone
manually deploys and re-seeds one. Minimum viable version: deploy market N+1
before market N matures, and make the redeem page offer "redeem → re-deposit
→ re-split into the new market" as one guided flow. The contract layer needs
nothing new for the guided version; a true one-transaction rollover would need
a router contract *(inference — no router crate exists, but composability of
the entrypoints for this wasn't checked)*.

### 2.3 A router / zap layer (one-click fixed rate)

Pendle's headline UX is "buy PT with the underlying in one click" — under the
hood: wrap → split → sell YT into the pool, or a direct underlying→PT swap via
their router. On Sidereal today the fixed-rate trade is three separate user
actions (deposit USDC→SY, then swap SY→PT; or deposit, split, sell YT). No zap
code exists in `app/lib` or the contracts. This matters commercially: "lock in
X% fixed on your USDC" is the sentence that sells the protocol, and right now
no single button does it. The YT flash route already proves the tokenizer can
compose split/recombine inside a swap, so the mechanism precedent exists
in-repo.

### 2.4 PT as collateral elsewhere (the integration flywheel)

A large share of Pendle's 2026 TVL is PT deposited as collateral on external
lending markets (Morpho, Aave); it's the loop that makes PT demand structural
instead of speculative. On Stellar the natural first target is **Templar**,
which launched RWA lend/borrow vaults in April 2026, and Blend itself. What an
integrator needs from Sidereal:

- **A PT pricing oracle** they can consume — the AMM already maintains a TWAP;
  what's missing is a documented, external-facing "fair PT price / implied
  rate" read entrypoint an integrator would trust, plus its behavior at and
  after maturity *(inference on the exact read surface — verify what the AMM
  exposes publicly before pitching integrators)*.
- RedStone's arrival on Stellar (March 2026) is the other path: getting a PT
  feed listed there is what unlocks integrations that won't read a
  competitor's pool directly.

### 2.5 Multi-asset SY (beyond Blend USDC)

The SY wrapper abstraction exists precisely so more underlyings can be added,
and Stellar's 2026 yield substrate is unusually rich for this:

| Underlying | Yield source | Notes |
|---|---|---|
| Blend USDC (live today) | Lending, ~8%+ APY | Only current market |
| Blend XLM / other reserves | Lending | Same adapter family, lowest lift *(inference)* |
| Centrifuge deJTRSY | Tokenized short-term US Treasuries | Launched on Stellar with $20M seed |
| Centrifuge deJAAA | AAA CLO strategy | Same launch |
| Ondo USDY | Treasury yield | $123M on Stellar, +12,000% QoQ in Q1 |
| Spiko EUTBL | EUR T-bills | $447M on Stellar — a **EUR** fixed-rate market has no competitor anywhere |
| Figure YLDS | Yield-bearing stablecoin | SEC-registered, pays holders directly |

Stellar is #2 globally in tokenized treasuries with >$2B RWA market cap as of
April 2026. A fixed-rate market over *treasuries* (PT on deJTRSY ≈ an on-chain
zero-coupon bond on a real T-bill strategy) is the most direct "must have"
extension of the existing design — and none of these issuers has a yield-split
venue on Stellar today. Each new underlying needs: an adapter (the
`blend-adapter` crate is the template), a rate-read model as trustworthy as
the bToken read, and its own maturity/anchor parameterization. Regulatory
posture of wrapping regulated instruments (YLDS, deJTRSY) is a real question
to answer per-asset before building.

### 2.6 Professional audit + admin hardening

The README says it plainly: unaudited, immutable, permanent defects. For a
protocol asking users to park size (and the liquidity section below requires
exactly that), a third-party audit is the gate, not a nice-to-have. Related
trust items, all verified as current state: single-key admin (should be a
multisig even for its one constrained power), and no bug bounty beyond
GitHub's private reporting. The SCF application is the natural funding path
for the audit.

### 2.7 Liquidity depth and LP incentives

~$10 of AMM depth means the protocol's differentiating half (trading,
fixed-rate locking) is nonfunctional in practice. Peers solve this with
incentivized LP (Pendle: gauge-directed PENDLE emissions; 80% of swap fees to
LPs). Sidereal has the fee (10bps, pool keeps ~0.4% round-trip per the usage
test) but no incentive layer and no protocol treasury to fund one. Options
that don't require a token: SCF-grant-funded seeding, fee share, or
structured deals with the first large depositors (the Discord conversation
with the tokenized-vault holder is exactly this shape). A token/gauge system
(vePENDLE-style, or Pendle's 2026 sPENDLE simplification) is the far end of
this spectrum and is a strategy decision, not an engineering gap.

### 2.8 Analytics and market transparency

No stats surface exists (routes: mint/trade/pool/portfolio/redeem only).
Table stakes for the category: historical underlying APY vs implied APY chart
(the fixed-vs-floating decision *is* this chart), TVL, pool composition,
per-wallet PnL, days-to-maturity. The TWAP and observation data the contracts
already record are the data source; this is frontend/indexer work. Related
known issue to fold in: M2 in `findings.md` — trade/pool pages render implied
APY as confident during TWAP warm-up (already flagged to Rahul).

### 2.9 Maturity operations automation (keeper)

`observe_rate` shortly before maturity and `freeze_maturity_rate` just after
are load-bearing for redemption correctness and currently rest on a human
(`docs/deploy/PROVENANCE.md`). Every serious protocol automates this class of
duty. `observe_rate` is already permissionless, so a public keeper/cron (or
an incentivized poke) is straightforward; same for LP TTL keepalive. This is
also a prerequisite for running multiple concurrent maturities — the manual
version doesn't scale past one market.

---

## 3. Differentiators peers ship that are *optional* for Sidereal

Worth knowing about, explicitly not table stakes:

- **Limit orders / RFQ** — Pendle runs an off-chain order book alongside the
  AMM for large fixed-rate fills. Matters only once there's flow.
- **Points/airdrop markets** — a major Pendle YT demand driver on EVM;
  Stellar has no equivalent points meta yet, so there's nothing to tokenize.
- **Funding-rate / off-chain-rate markets (Boros)** — Pendle's 2026 expansion
  into perp funding rates and (July 2026) commodities/equities rates. A
  different product; listed here so the roadmap conversation knows where the
  category leader is heading.
- **Auto-compounding / strategy vaults on top of PT/YT** — third parties build
  these on Pendle (Penpie, Equilibria). Needs the base market to be liquid
  first.
- **CEX distribution / one-click leveraged PT** — Pendle's stated 2026 UX
  roadmap; noted for completeness.

---

## 4. Known internal debt (already in the repo's own ledgers)

Smaller than the above, but they're the "can be worked on now" list with zero
research risk. All from `findings.md` and ARCHITECTURE §8's accepted-postures
list:

1. **`recombine` has no `min_sy_out`** (M1 — deliberately deferred; becomes
   real the day any contract composes on `recombine`, e.g. the router in §2.3).
2. **TWAP warm-up not gated on trade/pool pages** (M2 — flagged to Rahul,
   display-only, mechanical fix).
3. **Stale-quote fee burn on `remove_liquidity`** (M3 — guaranteed-revert txs
   still cost fees; a fresher-quote or wider-default-slippage UX fix).
4. **YT claimants share junior surplus first-come** — pro-rata needs an
   aggregate banked-yield ledger; accepted posture, but it's a fairness gap a
   competitor or auditor will point at.
5. **No-op claim fee burn** (cohort-sim finding — verify still current before
   working on it).
6. **Archived-LP restore path** relies on `RestoreFootprintOp` semantics that
   ARCHITECTURE §8 itself says to re-verify before relying on operationally.

---

## 5. How this maps to effort *(shape, not priority)*

- **Contract work:** market factory/registry; router (zap + one-tx rollover);
  new SY adapters (Centrifuge/Ondo/Spiko/YLDS); external PT-price read
  surface; `min_sy_out`; pro-rata YT surplus.
- **Ops/infra:** keeper automation; TTL renewal for long markets; multisig
  admin; audit procurement; RedStone feed listing.
- **Frontend/SDK:** multi-market model in SDK + env; analytics page; rollover
  and zap UX; M2/M3 fixes; integrator docs for PT collateral.
- **Strategy decisions this doc does not make:** which underlying is market
  #2; term lengths; whether/when a token and incentive layer exist; whether
  to pursue permissionless market listing (Spectra's experience — cited in
  the README — is why Sidereal launched curated; revisit deliberately).

---

## Sources

Repo (verified): `README.md`, `deployments/mainnet.toml`,
`docs/deploy/MAINNET_PARAMETERS.md`, `docs/deploy/PROVENANCE.md`,
`docs/testing/mainnet-usage-2026-07-11.md`, `findings.md`, `docs/ROADMAP.md`
(superseded), `contracts/` and `app/app/(app)/` listings.

Web (2026 landscape):

- [Pendle — What Is Pendle Finance? 2026 guide to PT/YT mechanics and Boros (Earnpark)](https://earnpark.com/en/posts/what-is-pendle-finance-the-complete-2026-guide-to-yield-tokenisation-pt-yt-mechanics-and-boros/)
- [Pendle introduces sPENDLE, removing long lockups (CoinDesk, Jan 2026)](https://www.coindesk.com/markets/2026/01/20/pendle-introduces-spendle-removing-the-need-for-long-lockups)
- [Boros by Pendle: yield trading with margin (Pendle team, Medium)](https://medium.com/boros-fi/boros-by-pendle-yield-trading-with-margin-63d026dc7399)
- [Pendle protocol overview (OAK Research)](https://oakresearch.io/en/reports/protocols/pendle-pendle-comprehensive-overview-leading-platform-on-chain-yield)
- [Yield tokenization protocols, how they're made: Pendle (MixBytes)](https://mixbytes.io/blog/yield-tokenization-protocols-how-they-re-made-pendle)
- [State of Stellar Q1 2026 (Messari)](https://messari.io/report/state-of-stellar-q1-2026)
- [Centrifuge brings deRWA to Stellar: $20M into deJTRSY and deJAAA (Stellar press)](https://stellar.org/press/centrifuge-brings-derwa-to-stellar-launching-with-usd20m-into-dejtrsy-and-dejaaa)
- [deRWA on Stellar with $20M allocation (Centrifuge blog)](https://centrifuge.io/blog/derwa-on-stellar-with-20m-allocation)
- [YLDS on Stellar: Figure's yield-bearing stablecoin (Eco)](https://eco.com/support/en/articles/14982160-ylds-on-stellar-figure-s-yield-bearing-stablecoin-explained)
- [Stellar's tokenized RWA ecosystem: WisdomTree, Ondo, Franklin (Eco)](https://eco.com/support/en/articles/14982164-stellar-s-tokenized-rwa-ecosystem-wisdomtree-ondo-franklin)
- [RedStone oracle infrastructure on Stellar (RedStone blog, Mar 2026)](https://blog.redstone.finance/2026/03/04/stellar-finally-gets-the-oracle-infrastructure-it-deserves/)
- [What the DeFi is happening on Stellar (Stellar blog)](https://stellar.org/blog/ecosystem/what-the-defi-is-happening-on-stellar)
