# Multi-wallet cohort simulation, Stellar testnet, 2026-07-04

An agent-driven simulation of real user behavior against the live Sidereal
testnet deployment (`deployments/testnet.toml`, deployed 2026-07-03). Eight
autonomous agents ran four epochs starting 13:26 local, onboarding thirteen
fresh wallets and exercising the Tier 1 settlement core exactly as a user
would: through `stellar contract invoke` with their own keys, no deployer
identity, no mock auth, no AMM calls (Tier 2 stays gated per AGENTS.md).

This is synthetic QA activity. It is evidence the deployment works, not user
traction, and must never be presented as organic usage.

Per-step logs with every command and transaction hash were captured in the
session scratchpad (epoch1-a/b, epoch2-c/d); the headline numbers below are
reproducible from the wallet histories on testnet Horizon.

## The cohort

| Wallet | Joined | Story |
|---|---|---|
| GDSZLAE3...N5Z72 | epoch 1 | Happy path: deposit 500 USDC, split 300, claim, recombine. Returned in epoch 2 for a second deposit, a long-accrual claim, and an SY transfer. |
| GBX7RABZ...PBZD5 | epoch 1 | Edge amounts (12.3456789 deposit, 7.7777777 split); gave away its YT and stranded its PT. Rescued in epoch 2. |
| GATR7IWO...LZIJ2G | epoch 1 | Received YT cross-account with zero trustline setup; claimed on it. |
| GB3BPGZL...OUBZ4M | epoch 2 | Deposited 400, split 200, sent both legs of half to a stranger. |
| GBBKV3IV...FM2M3JI | epoch 2 | Recombined legs it never split, unwrapped the SY to USDC (Horizon-verified 1000 -> 1100.0001905), then ran its own deposit and split. |
| GAE2YKCA...RTN4JKEU | epoch 2 | Deposited 300, split 150, donated YT for the rescue trade, split SY received from another wallet. |
| GC4DQPK4...OPVIEB | epoch 3 | Guardrail prober: six expected-failure checks, then a full round trip out ending flat (SY/PT/YT zero) at +22 base units net. |
| GC4UWHHJ...A5AUS | epoch 3 | Whale: aggregated 2600 USDC from two peers, deposited 2500 in one transaction, split 2000, distributed thirds of both legs. |
| GBURZXHM...GDGWS | epoch 3 | Funded the whale, received legs back, recombined and unwrapped to USDC (Horizon-verified, +2 base units over face). |
| GCCVCQ64...WSRVNV3F | epoch 3 | Funded the whale, held its legs; in epoch 4 sold its whole PT block OTC and became a pure yield holder, 98% of principal recovered. |
| GA6DVF2A...4V5XWW77 | epoch 4 | Fixed-rate buyer: bought a 666.67-face PT block OTC at 0.98 per unit face (8.37% implied simple APR, 89 days to par). |
| GDPYCI2F...FT53MGIT | epoch 4 | Churner: eight rapid split/recombine cycles to measure rounding drift, then a clean full exit at +5 base units net. |
| GAALBLVY...GQ6S5KRNX | epoch 4 | Probe wallet that never held YT; used to test the unguarded claim path. |

## What landed

Roughly 80 confirmed transactions across four epochs, zero unexpected on-chain
failures. Coverage:

- **Deposit** x5, including a second deposit by a returning wallet at a higher exchange rate (correctly minted fewer SY per USDC) and an odd 123456789-base-unit amount.
- **Split** x6, including splitting SY received from another account (provenance-agnostic, as designed).
- **Transfers**: YT x2, PT x1, SY x1, all cross-account, no trustline setup needed for the Soroban tokens.
- **Claim yield** x4, paying real Blend v2 interest out of escrow in SY: payouts of 1, 0, 9, and 20 base units, scaling with position size and accrual time. No mock rates anywhere.
- **Recombine** x5, including with a leg acquired from a third party and the stranded-PT rescue: PT and YT from different mints recombined cleanly, proving fungibility across epochs.
- **Wrapper unwrap** x1: recombined SY redeemed to USDC, verified against classic Horizon balances.
- **Negative checks, all passed (9 total)**: pre-maturity `redeem_at_maturity` rejected (tokenizer `Error #8 LiveMarket`), zero-amount deposit and split rejected (`InvalidAmount`), overdrawn deposit rejected by the USDC SAC, split without SY and over-split rejected by the wrapper, over-recombine and over-transfer rejected by the PT token's balance guard, negative deposit rejected contract-side. All caught in simulation; nothing invalid landed on chain.
- **Epoch 3 additions**: a 2500 USDC single-transaction deposit (2.5x the previous maximum) behaved identically to small sizes; a whale distributed both legs three ways with face conserved exactly; a prober's full round trip out (recombine everything, unwrap everything) ended flat at +22 base units net, real accrual outpacing the ~20-unit flooring cost.
- **Epoch 4 additions**: a bilateral OTC PT sale settled in two legs (USDC classic payment plus PT transfer), turning one wallet into a pure fixed-rate holder (0.98 per unit face, 8.37% implied simple APR over 89 days) and the seller into a pure yield holder whose accrual continued undisturbed; eight rapid split/recombine churn cycles characterized the rounding loss (1 base unit per round trip, scaling with rate movement while open, no compounding); two more full exits ended flat, both slightly positive net of real accrual.
- **Reconciliation exact to the base unit on every wallet after every epoch.** Every USDC/SY/PT/YT balance was derived from the action history and matched the on-chain read.
- **Global census (epoch 5)**: an independent read-only audit re-derived all 13 wallets from the epoch history and found 13/13 exact, then verified the protocol's global invariants externally: PT total supply equals YT total supply to the base unit (29,147,532,805 at a quiescent double-read), and the escrow covers PT supply at the current exchange rate with a surplus. Face held by non-cohort testnet users and the AMM was attributed exactly, no leakage.
- **Retention wave (epoch 5)**: the day-one wallet returned after ~11 hours and claimed 1,734 base units of accrued Blend interest, then made its third deposit; a new user ran the guided flow with preview-gated claiming (claim withheld at preview 0, executed at preview 28, paid exactly 28); and a cross-epoch YT gift confirmed checkpoint settlement on transfer (the receiver's preview read 0 thirteen seconds after receipt, then accrued normally).
- **Onboarding wave (epoch 6)**: four new users went from key generation through faucet, deposit, split, and cross-transfers in about 4.5 minutes with zero failures and no faucet interference across back-to-back grants. Personas seeded: a pure SY parker, a minimum-viable 50 USDC user (whose split floored to an off-round face, a display case UIs should expect), and two mixed positions from PT and YT gifts. Reconciliation exact on all 16 lines.
- **Census #2 (after epoch 6)**: both global invariants re-verified with the cohort at 20 wallets: PT total supply still equals YT total supply exactly (40,397,538,464), with the entire growth since census #1 attributed split-by-split, and escrow coverage holding with a grown surplus. A 7-wallet spot census matched the roster exactly. The census also decoded the cancelled agent's on-chain history from Horizon XDR, which is what surfaced the allowance-TTL finding above.
- **Growth mode (epoch 8 onward)**: the cohort is being grown toward 50+ wallets in waves of 4 to 6 varied personas per epoch. Epoch 8 added six wallets and 23 transactions in ~6.5 minutes with zero failures (24/24 reconciliation lines exact), including the smallest deposit yet (25 USDC), a two-tranche depositor funded by a peer gift, and a fast in-and-out tourist whose round trip netted minus 2 base units, an honest datapoint that sub-minute holds do not cover rounding. Six sequential faucet grants in ~40 seconds showed no interference.

## Findings for the team, ranked

00. **PT/YT allowances expire silently long before the requested expiration** (design-level; mechanism confirmed in source, live TTL probe not completed). Observed: an on-chain PT `approve` read back as allowance 0 roughly 114k ledgers before its stated expiration ledger, with nothing having spent it. Confirmed in source: `approve` writes the allowance to temporary storage (`contracts/pt-token/src/lib.rs:172-178`; same shape in yt-token) and only bumps the contract *instance* TTL (`bump_instance_ttl`, line 171), never the allowance entry's own TTL, so the entry archives at the network's default temporary lifetime and an archived entry reads back as 0. The `expiration_ledger` is stored as data inside the value but does not govern the entry's actual lifetime. Consequence: any approve/transfer_from integration silently breaks within hours, and unit tests cannot catch it because test-environment TTLs do not tick. Fix shape: `extend_ttl` on the allowance entry key to cover `expiration_ledger` (the per-entry pattern used for balances at line 264 is the template), in both pt-token and yt-token, plus a testnet-time verification. Contracts-column work, awaiting implementation.
0. **RESOLVED (docs corrected): the escrow-coverage invariant is not asserted on-chain, by design.** The tokenizer retired the `Insolvent` gate deliberately: with a Blend-derived rate the escrow has zero slack at mint and Blend's bToken burn rounding can tick the rate down by dust, so the coverage gate froze the market (every claim reverted). Shortfalls are priced instead of blocked: pro-rata caps on redemption and recombine, and YT settle math that pays zero unless the rate rose past the holder's checkpoint (`contracts/tokenizer/src/lib.rs:314-323`). README and ARCHITECTURE.md now describe this model; the invariant remains verified off-chain by the 10k-step property test and external reads (this census's method).
1. **claim_yield has no YT-balance or owed>0 guard** (`contracts/tokenizer/src/lib.rs:304-325`, deliberate per the in-source comment). A wallet that never held YT can land a successful zero-return claim and burn the fee (~0.245 XLM observed). Not a solvency issue, but it invites griefing-by-confusion and wasted fees; worth a team decision on a cheap owed==0 early revert, and in any case the UI must gate the claim button on preview > 0. This asymmetry is notable: every other invalid action was rejected free at simulation time, while no-op claims land and cost money.
2. **preview_claim_yield is an estimate, not a promise** (six datapoints: usually claim = preview + 1 at one-second gaps, but one same-second pair matched exactly). The offset is rate accrual between simulation and execution plus flooring, not a systematic bug. UI copy should say "estimated".
3. **Transferring YT alone strands the matching PT** until the holder re-acquires YT (the rescue trade works). Worth a UI note on the transfer/trade path. This is inherent to the design, not a bug.
4. **SAC balance reads trap for accounts without the classic trustline** (`Error #13`) instead of returning 0, unlike the Soroban-native PT/YT/SY. The frontend must special-case underlying-balance reads; this is the same family as the /mint faucet bug found earlier today (faucet offered to wallets it cannot fund; see that diagnosis for the fix set).
5. **Contract errors surface as bare numbers** (`Error(Contract, #8)`). An SDK-level map to symbolic names (`LiveMarket`, `InvalidAmount`) would improve every error path downstream.
6. **The Blend faucet XDR is sequence-fragile**: fetch, sign, and submit must be one quick pipe or Horizon rejects with TxBadSeq. Relevant to the /mint faucet flow's retry story.
7. **UI copy note**: PT/YT face is denominated in asset units and scales up from the SY amount at the current exchange rate (split 77777777 SY -> 77777924 PT/YT at rate ~1.0000019). Any copy that says "split N SY, get N PT" is wrong whenever the rate is above 1.
8. **Rounding behaves well under churn**: a split/recombine round trip costs 1 base unit, the loss scales with rate movement while the position is open rather than with cycle count, and it never compounds. Three full-exit wallets ended slightly net positive because real accrual outpaced flooring. Good numbers to cite when someone asks about dust leakage.
9. **Non-atomic OTC settlement is observably risky** (a buyer was out 653 USDC between the two legs of a bilateral PT sale, with nothing on-chain linking them). This is the concrete user-level argument for the gated AMM's atomic swap once its auth tree is proven.

## Honest one-paragraph summary (safe to cite in an SCF form)

On 2026-07-04 we ran an automated multi-wallet simulation against our live
Stellar testnet deployment: thirteen freshly created wallets executed roughly
80 transactions covering the full settlement lifecycle (deposits from 12 to
2500 USDC, splits, cross-account transfers of all three tokens, a bilateral
OTC PT sale, yield claims paying real Blend v2 interest, recombination
including third-party legs, and full exits back to USDC verified on Horizon),
with every balance reconciling exactly against the token contracts and all
negative checks (pre-maturity redeem, zero, negative, and overdrawn amounts)
rejecting as designed. The simulation also surfaced one design-level finding
(unguarded no-op yield claims) and a ranked list of UX findings, now on the
backlog. All transaction hashes are public and reproducible from the wallet
histories.
