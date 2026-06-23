# ARCHITECTURE.md — sidereal protocol design

This document is the protocol specification. `AGENTS.md` is the build spec; this is the design spec.

---

## 1. The three layers

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js) ←→ SDK (TypeScript) ←→ Soroban RPC       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Time-decay AMM (PT/SY pool, YT via flash swap)     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Tokenizer (mints PT + YT from SY)                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: SY wrapper (OZ Vault extension on Soroban)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Underlying yield source (Blend USDC pool, then RWAs)        │
└─────────────────────────────────────────────────────────────┘
```

Each layer is a separate Soroban contract. The dependency only flows downward — the SY wrapper does not know about the AMM, and the AMM does not know about Blend.

---

## 2. Layer 1: Standardized Yield (SY)

**Purpose:** wrap any yield-bearing asset into a uniform interface so the tokenizer and AMM can stay agnostic to where yield comes from.

**Pattern:** OpenZeppelin's Soroban Vault extension (`stellar-tokens::fungible::extensions::vault`). This is an ERC-4626-style design adapted for Soroban. The contract holds the underlying yield-bearing position and issues shares that track the position's value.

**Exchange rate.** The SY contract exposes `exchange_rate()` returning underlying per SY share, scaled to 18 decimals. As the Blend pool earns interest, the exchange rate ticks up. SY holders don't see their balance change; they see the value of each share rise.

**Per-underlying contracts.** One SY contract per underlying. For the MVP, exactly one: `SY-blendUSDC`. For each future underlying (deJTRSY, YLDS, etc.), deploy a new SY contract with a new wrapper logic. The tokenizer and AMM treat them identically because they all conform to the same trait.

**Why not just use the Blend pool position directly?** Because Blend's bToken doesn't expose a clean ERC-4626-style interface. Wrapping it normalizes the API. It also lets us add a thin permissions layer later (KYB gating for institutional pools, for example) without changing the tokenizer.

---

## 3. Layer 2: Tokenizer

**Purpose:** mint PT + YT from SY, redeem the underlying at maturity, and track YT yield accrual.

**The mint operation.**

```
input:  N units of SY, maturity timestamp M
output: N units of PT-M, N units of YT-M
```

Both PT and YT are tagged with the same maturity. The tokenizer holds the SY in escrow until either:
- the holder recombines PT+YT before maturity → returns SY, or
- maturity passes and PT holders redeem → returns SY pro-rata

**The PT redemption at maturity.**

After the maturity timestamp, each PT-M is redeemable 1:1 for SY-M. The tokenizer reads the current `exchange_rate()` from the SY contract — which by then reflects all the yield earned during the term — and transfers the appropriate amount of underlying.

Worked example. A user mints 100 PT and 100 YT from 100 SY at t=0, when the SY exchange rate is 1.00 (1 SY = 1 USDC). The maturity is t+90 days. During those 90 days, Blend pays an average of 8% APY, so by maturity the SY exchange rate is roughly 1.02. The user redeems 100 PT at maturity and receives 100 SY, which they unwrap into 102 USDC. The 2 USDC of yield went to whoever held the YT during the term and called `claim_yield`.

**The YT yield accrual.**

This is the subtle part, and we are deliberately matching Pendle's behavior rather than auto-compounding.

Each holder has a `last_claim_rate` checkpoint. When they call `claim_yield`:

```
accrued = (current_exchange_rate - last_claim_rate) * yt_balance
transfer accrued SY to holder
last_claim_rate = current_exchange_rate
```

Unclaimed yield is not lost — it stays in the SY wrapper and accrues to the holder's account on the next claim. But it does not compound. A YT holder who never claims and then sells their YT mid-term will have transferred their accrued yield to the buyer.

**Storage segregation.** YT checkpoints are keyed by `(holder_address, maturity_timestamp)`, never by holder alone. This is enforced at the storage layer so that v2's multi-maturity support is a no-op refactor.

---

## 4. Layer 3: The time-decay AMM

This is the load-bearing, audit-critical piece.

### 4.1 Why a standard AMM doesn't work

Constant-product AMMs (Uniswap V2 style) assume the two assets in the pool have no enforced time-dependent relationship. PT does have one: PT must trade at exactly 1 SY at maturity, by construction. A standard AMM would either over-price PT (LPs lose money to arbitrage) or under-price it (no one would mint PT in the first place).

Concentrated liquidity AMMs (Uniswap V3 style) get closer but still don't solve the time-decay problem — the LP would have to manually rebalance their range as maturity approaches.

The solution is an AMM whose pricing curve has time as an explicit parameter. As maturity approaches, the curve continuously concentrates around the 1:1 ratio.

### 4.2 The curve

Adapted from Pendle V2, which adapted Notional V2's. Citing both sources directly:
- Pendle V2 AMM: https://docs.pendle.finance/ProtocolMechanics/LiquidityEngines/AMM
- Notional V2 whitepaper: https://github.com/notional-finance/contracts-v3

The pool tracks reserves of PT and SY. The pricing curve is parameterized by:

- **rate scalar** (`r`) — controls how sensitive PT price is to deviations from the current implied yield. Higher `r` means tighter pricing near the current implied yield, but worse pricing for trades that move the implied yield far.
- **rate anchor** (`a`) — the "center" of the curve, around which PT is priced. Updated periodically to track the implied yield as the market discovers it.
- **time-to-maturity** (`τ`) — the input that drives time decay. As `τ → 0`, the curve flattens around PT = 1 SY.

The simplified pricing formula (full math in the Pendle whitepaper):

```
exchange_rate = exp(ln(proportion / (1 - proportion)) / (r * τ) + a)
```

Where `proportion = PT_reserve / (PT_reserve + SY_reserve)`.

Key properties this gives us:

1. As `τ → 0`, the exchange rate → 1, regardless of pool proportions.
2. The curve concentrates liquidity around the current implied yield, like Uniswap V3 but on the yield axis instead of the price axis.
3. The implied APY can be read directly from the current exchange rate and `τ`.

### 4.3 The flash swap for YT

The pool only holds PT and SY. YT swaps are routed through the same pool atomically:

**Buying YT for SY:**

```
1. User sends `sy_in` to the market contract.
2. Market flash-borrows additional SY from the pool.
3. Total SY = `sy_in + flash_borrow`. Send to tokenizer.
4. Tokenizer mints PT + YT in equal amounts from the SY.
5. Return PT to the pool (repays the flash loan via swap).
6. Send YT to the user.
```

The trade succeeds atomically or reverts. Soroban's transaction-level atomicity makes this clean — no separate flash-loan primitive needed.

**Selling YT for SY:**

Symmetric. Flash-borrow PT, recombine with the user's YT into SY via the tokenizer, swap part of the SY back to PT to repay the flash, send the rest to the user.

### 4.4 Internal TWAP

Every swap updates an exponentially-weighted moving average of the implied APY. The TWAP is:

- Stored in contract storage, updated on every state-changing operation.
- Exposed via a public read-only function.
- Used by external integrators (a lending protocol that wants to use PT as collateral, for instance) to get a manipulation-resistant price.

**Window:** 30 minutes. Long enough that a single-block manipulation gets averaged out, short enough that it tracks real market moves.

**Why this matters specifically for Stellar:** the February 22, 2026 YieldBlox exploit was an oracle manipulation against an external Blend pool oracle, draining $10.8M (https://medium.com/@cryip/10-8m-oracle-manipulation-exploit-on-stellars-blend-protocol-6bdcbb1568c0). The post-mortem made clear that TWAP is mandatory for any lending market using a yield-bearing asset as collateral. Our protocol generates TWAPs natively. This is a defensible security advantage to surface in the SCF proposal.

### 4.5 LP economics

LPs deposit PT and SY in the current pool ratio and receive LP shares. They earn:

1. **Swap fees.** 0.1% on PT↔SY swaps, 0.3% on YT swaps (which go through two pool operations). Fee rates are configurable per pool at deployment.
2. **PT appreciation.** The PT in the pool naturally appreciates toward 1 SY as maturity approaches. Pendle's term: "no impermanent loss at maturity" — an LP who holds to maturity is guaranteed to receive the underlying value of their initial deposit, because PT always converges to SY.

For LP positions held to maturity, the protocol provides a single-transaction `zap_out_at_maturity` that removes liquidity, redeems all PT for SY, and unwraps SY to the underlying.

---

## 5. The TWAP design in detail

Each swap calls `update_twap()` which performs:

```
elapsed = current_time - last_observation_time
weight = elapsed / window_size  // capped at 1.0
twap_apy = twap_apy * (1 - weight) + current_apy * weight
last_observation_time = current_time
```

Special cases:
- First observation after `> window_size` seconds of inactivity: `twap_apy` resets to `current_apy`. Stale TWAPs are worse than no TWAP.
- During the first 30 minutes after pool deployment, the TWAP is marked "warming up" and external readers get a warning. Don't price loans against a 5-minute-old TWAP.

---

## 6. Maturity selection

The MVP launches with exactly one maturity. Choosing it is a product decision, not a technical one:

- **3 months from launch** maximizes the chance of meaningful trading volume in the sprint window (Pendle's data shows 3-month maturities get the most liquidity).
- **6 months** is the institutional sweet spot for fixed income but takes longer to demo a full cycle.
- The MVP picks **3 months**, deploys with maturity = (deployment date + 90 days), and the demo shows a partial-term flow rather than a full term.

v2 adds rolling maturities: every quarter, a new 3-month pool spawns alongside the existing 6-month one, so users can roll into the next term as the old one expires.

---

## 7. What we are explicitly not building (and why)

### 7.1 No governance token in v1

Pendle's vePENDLE is essential to their flywheel: locked governance tokens earn protocol revenue and direct liquidity emissions. We've designed the equivalent on paper — call it `veYT` — but we are not minting or distributing it during the sprint. Reasons:

1. Token distribution at sprint time is a regulatory and operational distraction.
2. The protocol has to demonstrate organic LP demand before token incentives mean anything.
3. SCF reviewers will be more receptive to a clean fixed-income primitive than a yet another token launch.

We document the design in `docs/governance.md` so it's clear the path forward exists.

### 7.2 No cross-chain in v1

A natural extension is to let users move PT/YT across chains via SODAX or NEAR Intents. Out of scope for v1 because (a) the cross-chain solver layer on Stellar is still maturing, and (b) Pendle's cross-chain rollout came after they had ~$2B TVL on their home chain. Walk before running.

### 7.3 No options layer in v1

YT is already implicitly an option on yield direction. Building an explicit options layer (cash-secured puts on PT, covered calls on YT) is a v2 conversation.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Oracle manipulation on the underlying SY (à la YieldBlox) | Internal TWAP, no external oracle in pricing path; SY wrapper exchange rate read from Blend on every interaction, not cached |
| Liquidity fragmentation across maturities | v1 launches with one maturity to concentrate liquidity |
| Yield compression killing PT demand | The protocol is cyclical by design; we surface this in docs rather than hide it |
| AMM math bug | Property-based testing with 10k iterations; reference implementation cross-check against Pendle V2 contracts |
| Underlying protocol failure (Blend bug) | SY wrapper is isolated; a Blend failure affects only the SY-blendUSDC pool, not the protocol |
| Flash-swap atomicity bug | Comprehensive integration tests covering revert scenarios; Soroban's transaction model makes this easier than EVM |

---

## 9. Open design questions

These are deliberately unresolved. They need discussion before being settled:

1. **Initial rate anchor.** How do we set the initial `rate anchor` for a new pool? Options: (a) read current Blend APY and seed at that, (b) start at 5% and let the market discover, (c) let a curator set it. Leaning toward (a).
2. **Fee distribution.** Where do swap fees go in v1 without a governance token? Options: (a) entirely to LPs, (b) split between LPs and a protocol treasury, (c) burn. Leaning toward (a) for simplicity.
3. **Maturity rollover UX.** When a pool reaches maturity and we deploy a new one, how does the frontend present the choice between redeeming and rolling into the new maturity? Out of MVP scope but worth thinking through.
4. **KYB-gated pools for institutions.** Should some pools (deJTRSY in particular) require verified counterparts to mint, the way PagFinance's BRLP gates trustlines? Not in MVP but a real conversation for the institutional pitch.

Add to this list as new questions surface. Resolving one is a doc PR.

---

## 10. Sources

All design claims in this document trace to one of:

- Pendle V2 AMM documentation — https://docs.pendle.finance/ProtocolMechanics/LiquidityEngines/AMM
- Pendle V2 AMM whitepaper (via Pendle docs)
- Pendle Market contracts — https://github.com/pendle-finance/pendle-core-v2-public
- Spectra protocol docs — https://docs.spectra.finance/
- Spectra core — https://github.com/perspectivefi/spectra-core
- Notional V3 — https://github.com/notional-finance/contracts-v3
- Blend protocol — https://docs.blend.capital/
- OpenZeppelin Soroban Vault — https://docs.openzeppelin.com/stellar-contracts/tokens/fungible
- YieldBlox post-mortem — https://medium.com/@cryip/10-8m-oracle-manipulation-exploit-on-stellars-blend-protocol-6bdcbb1568c0
- Stellar DeFi 2026 ecosystem update — https://stellar.org/blog/ecosystem/what-the-defi-is-happening-on-stellar

If a claim in this document doesn't trace to one of these, it's wrong or speculative — flag it.