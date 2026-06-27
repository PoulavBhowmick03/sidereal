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

**Purpose:** mint PT + YT from SY, separate fixed principal (PT) from yield (YT),
redeem principal at maturity, and pay YT holders their accrued yield.

**Denomination: asset units.** PT and YT are denominated in underlying asset
units, not SY shares. This is what makes PT fungible across holders who split at
different times: 1 PT is always a claim on 1 unit of asset at maturity,
regardless of the exchange rate when it was minted. At `split(sy_amount)` with
the current SY rate `R` (asset per share, WAD scaled), the tokenizer mints

```
pt_face = yt_face = sy_amount * R / WAD   (asset units, equal amounts)
```

and escrows `sy_amount` SY shares. At `R = WAD` (rate 1.00) the asset amount
equals the share amount, so a split at par mints `sy_amount` of each.

The tokenizer holds the escrowed SY until either:
- the holder recombines PT+YT before maturity, returning principal plus settling
  any accrued YT yield, or
- maturity passes and PT holders redeem principal, while YT holders claim the
  yield accrued over the term.

**PT redemption at maturity.** Each PT is principal, not a share claim. Redeeming
`pt_amount` (asset units) pays

```
sy_to_pay = pt_amount * WAD / R_maturity
```

SY shares out of escrow, which unwrap to `pt_amount` units of underlying. PT is
fixed principal: it does not capture yield. (This is the central correction over
the earlier prototype, where PT redeemed 1:1 in shares and so captured the yield
that belongs to YT. See the audit, Layer 1 finding 3.)

**YT yield accrual.** YT captures everything the escrow earns above principal. We
match Pendle's index model rather than auto-compounding. Each holder carries a
`checkpoint`, the SY exchange rate their yield was last settled at. Settling a
holder from checkpoint `c` to the current rate `R` banks

```
owed_shares = yt_balance * (R - c) / (c * R) * WAD     (SY shares)
```

into the holder's `accrued_yield` ledger and advances `checkpoint` to `R`. The
`(R - c) / (c * R)` form (equivalently `1/c - 1/R`) is the conservation-correct
amount: it telescopes across intermediate settlements, so settling at every
transfer yields exactly the same total as a single settle at the end. A naive
`(R - c) / WAD` overpays whenever the split rate is above 1.00. `claim_yield`
pays the banked `accrued_yield` SY out of escrow and zeroes the ledger.

Worked example. A user deposits 100 USDC at rate 1.00 and splits into 100 PT and
100 YT (asset units). Over the term the SY rate rises to 1.02. The escrow (100
SY shares) is now worth 102 USDC. The YT holder claims `100 * (1/1.00 - 1/1.02)`
= 1.96 SY, which unwraps to 2.00 USDC: the yield. At maturity the PT holder
redeems 100 PT for `100 / 1.02` = 98.04 SY, which unwraps to 100.00 USDC: the
principal. Out: 2.00 + 100.00 = 102.00 USDC, exactly the escrow. No double count.

**Transfer carries settled yield, not unsettled.** On any YT balance change
(mint, transfer, transfer_from, burn) both the sender and the receiver are
settled first, banking each party's accrued yield to their own ledger before the
balance moves. A holder who never claims and then sells keeps the yield they
earned while holding (in their ledger); the buyer only earns yield from the
transfer forward. This fixes the earlier behavior where mid-term transfers lost
or double-counted yield (audit Layer 1 finding 4).

**The escrow-coverage invariant.** At every tokenizer state transition,

```
escrow_sy * R / WAD  >=  pt_supply + total_unclaimed_yt_yield
```

The escrow, valued at the current rate, always covers every PT at face plus
every YT's unclaimed yield. Equality holds at split and is preserved by claim,
redeem, and recombine. The tokenizer asserts the computable half of this,
`escrow_sy * R / WAD >= pt_supply`, after every mutating call (split, recombine,
redeem, claim) and rejects with `Insolvent` if it fails. The YT half follows by
construction: the escrow asset value above PT principal is exactly the total
outstanding YT yield, and total YT yield is not enumerable on-chain. A 10k-step
random property test checks the full invariant (PT plus YT) holds at every step.

**Insolvency (negative yield).** If the SY rate regresses (a slash, a loss) the
escrow may no longer cover all PT principal. The protocol fails safe rather than
first-come-first-served:

- PT redemption is capped to the holder's pro-rata share of escrow,
  `escrow_shares * pt_amount / pt_supply`. PT holders share the shortfall
  pro-rata; capping preserves the escrow/PT ratio so later redeemers are not
  disadvantaged. When solvent, this equals full principal.
- YT is subordinate to PT. A claim that would push the escrow below PT coverage
  reverts (the coverage assertion fails), flooring YT at zero during insolvency.
  The holder keeps their banked ledger and can claim once the rate recovers.

**Maturity and post-maturity.** The tokenizer freezes the SY rate at maturity
(snapshotted on the first post-maturity access, or via a permissionless
`freeze_maturity_rate` poke). Redemption and the solvency check use the frozen
rate, so a post-maturity rate move cannot change what PT redeems for. YT freezes
accrual at maturity the same way, so no yield accrues after the term ends;
post-maturity YT claims remain open (a grace window) and pay at the maturity
rate. This assumes the SY rate is flat after maturity, which holds for a real
yield source (accrual stops at maturity) and, for the current admin-set mock
rate, requires the admin not to bump it post-expiry.

**Storage.** YT per-holder yield state is two persistent entries keyed by holder
address: `Checkpoint(holder)` (last settled rate) and `AccruedYield(holder)`
(banked but unclaimed SY). Persistent, not instance, so per-holder data scales
and carries its own TTL. Each YT contract is single-maturity, so the maturity is
implicit in the contract, not part of the key.

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