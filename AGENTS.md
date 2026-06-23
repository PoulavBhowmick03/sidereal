# AGENTS.md — sidereal

> Single source of truth for all coding agents working on this repository.
> Both Codex and Claude Code read this file first, every session.
> If a sub-directory has its own `AGENTS.md`, the deeper file wins for that directory.

---

## 0. What we are building

A yield tokenization protocol on Stellar that splits yield-bearing assets into Principal Tokens (PT) and Yield Tokens (YT), traded through a time-decay AMM. Modeled on Pendle V2 and Spectra, adapted for Soroban.

**Why this exists:** Stellar has $2B+ in tokenized RWA and Blend lending pools paying ~8.6% on USDC, but no way to lock in a fixed rate or speculate on yield direction. We are building that primitive.

**The MVP target:** one underlying (Blend USDC), one maturity (3 months), one PT/SY pool with working flash-swap routing for YT, one frontend that lets a user mint, swap, and redeem end-to-end on testnet. Everything else is post-MVP.

**Maturity hardcoded for v1:** the next quarterly expiry date. Pick one. Stick with it. Do not parameterize across multiple maturities until v2.

---

## 1. The non-negotiables

Read these before writing any code. Violations get reverted, no exceptions.

1. **Internal TWAP for the AMM. No external oracles in the pricing path.** The whole point of this design is that PT prices converge to par at maturity through the AMM curve itself, not through a price feed. Stellar's February 2026 YieldBlox exploit was an oracle manipulation. We are not repeating that.
2. **PT + YT = SY is a hard invariant.** Every code path that touches tokenization must preserve this. If you cannot recombine 1 PT + 1 YT into 1 SY at any time before maturity, the code is wrong.
3. **One liquidity pool, three markets.** PT/SY pool, with YT trades routed via flash swap. Do not add a separate YT/SY pool. This is the design that makes the protocol work on Stellar's smaller liquidity base.
4. **Code-first, deploy-second.** The frontend never auto-signs or auto-deploys anything that locks user funds. All transactions are reviewed and signed client-side. No exceptions for "developer convenience".
5. **No hardcoded private keys, anywhere, ever.** Not in tests, not in scripts, not in `.env.example`. Test keys come from `soroban-cli keys generate` and live in `.env.local` which is gitignored.
6. **Apache-2.0 license.** Every source file gets the SPDX header. No copyleft dependencies.
7. **No unsourced numbers in docs or commits.** If a doc says "Blend USDC yields 8.6%", it cites where and when. If you do not have a source, do not write the number.

---

## 2. Repo structure

```
sidereal/
├── AGENTS.md                    # this file
├── README.md                    # public-facing, build-in-public
├── ARCHITECTURE.md              # protocol design deep-dive
├── CLAUDE.md                    # → see AGENTS.md
├── .codex/instructions.md       # → see AGENTS.md
├── .claude/commands/            # slash commands for Claude Code
│
├── contracts/                   # Soroban contracts (Rust)
│   ├── sy-wrapper/              # Standardized Yield wrapper (ERC-4626-style)
│   ├── pt-token/                # Principal Token (SEP-41)
│   ├── yt-token/                # Yield Token (SEP-41)
│   ├── tokenizer/               # mints/redeems PT+YT from SY
│   ├── amm/                     # time-decay AMM (the hard one)
│   └── shared/                  # math, errors, events, types
│
├── sdk/                         # TypeScript SDK
│   ├── src/
│   └── tests/
│
├── app/                         # Next.js frontend
│   ├── app/
│   ├── components/
│   └── lib/
│
├── scripts/                     # deployment, devnet helpers
└── docs/                        # protocol docs, walkthroughs
```

Each contract directory has its own `AGENTS.md` with contract-specific invariants.

---

## 3. Agent assignments

Four agents working in parallel. Each owns one column. Do not edit outside your column without leaving a comment explaining why.

| Agent | Owns | Touches read-only | Hands off |
|---|---|---|---|
| **Codex-1: AMM** | `contracts/amm/`, `contracts/shared/math/` | `contracts/shared/types/` | exports market interface to Codex-2 |
| **Codex-2: Tokenization** | `contracts/sy-wrapper/`, `contracts/tokenizer/`, `contracts/pt-token/`, `contracts/yt-token/` | `contracts/shared/` | exports SY/PT/YT interfaces to Codex-1 and Claude-1 |
| **Claude-1: SDK** | `sdk/` | all of `contracts/` (read interfaces only) | exports typed client to Claude-2 |
| **Claude-2: Frontend + tests** | `app/`, `tests/e2e/` | `sdk/` | end-to-end demo |

**The two interface contracts that gate parallelism.** Both must be frozen in commit `feat: freeze interfaces` before any agent writes implementation code. They are defined in `contracts/shared/types/src/lib.rs`. Editing them after freeze requires a coordination commit that updates all four columns in one PR.

```rust
// SY token interface (Codex-2 → Codex-1, Claude-1)
pub trait StandardizedYield {
    fn deposit(env: &Env, from: Address, amount: i128) -> i128;          // returns SY minted
    fn redeem(env: &Env, from: Address, sy_amount: i128) -> i128;        // returns underlying out
    fn exchange_rate(env: &Env) -> i128;                                  // SY per underlying, 18 decimals
    fn underlying(env: &Env) -> Address;
    fn accrued_yield(env: &Env, holder: Address) -> i128;
}

// Market interface (Codex-1 → Claude-1)
pub trait Market {
    fn swap_pt_for_sy(env: &Env, from: Address, pt_in: i128, min_sy_out: i128) -> i128;
    fn swap_sy_for_pt(env: &Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128;
    fn swap_sy_for_yt(env: &Env, from: Address, sy_in: i128, min_yt_out: i128) -> i128; // flash
    fn swap_yt_for_sy(env: &Env, from: Address, yt_in: i128, min_sy_out: i128) -> i128; // flash
    fn add_liquidity(env: &Env, from: Address, pt_in: i128, sy_in: i128) -> i128;       // returns LP
    fn remove_liquidity(env: &Env, from: Address, lp_in: i128) -> (i128, i128);         // PT, SY out
    fn implied_apy(env: &Env) -> i128;                                                  // basis points
    fn maturity(env: &Env) -> u64;                                                       // unix seconds
}
```

---

## 4. The AMM (Codex-1's territory — the hardest part)

This is adapted from Pendle V2, which adapted Notional Finance's AMM. The full math is in `ARCHITECTURE.md`. Key constraints for the implementation:

- **Pricing curve is a function of time-to-maturity.** As `t → maturity`, PT price → 1.0 in SY units. Use a rate scalar that grows monotonically as maturity approaches.
- **Concentrated liquidity around the expected yield range.** PT does not trade across the full [0, ∞) range like a spot asset. It trades in a yield-bounded band (for Blend USDC, roughly 3–15% APY). The curve concentrates capital there.
- **Internal TWAP.** Every swap updates an exponentially-weighted moving average of the implied APY. This is what external integrators read, and what protects against single-block manipulation.
- **Flash-swap path for YT.** When a user wants to buy YT, the pool flash-borrows SY against incoming PT, mints PT+YT from SY via the tokenizer, returns PT to the pool, and sends YT to the user. Atomicity is enforced by Soroban auth — if any step fails, the whole transaction reverts.

**Test coverage requirement:** the AMM must have property tests (using `proptest` or equivalent) that verify the PT+YT=SY invariant holds across 10,000 random swap sequences. Not unit tests with hand-picked values. Property tests.

**Reference implementations to study, not copy:**
- Pendle V2 `MarketMathCore` — https://github.com/pendle-finance/pendle-core-v2-public
- Spectra core — https://github.com/perspectivefi/spectra-core
- Notional V3 (the original math) — https://github.com/notional-finance/contracts-v3

Do not copy code verbatim. License compatibility, naming, and Soroban-specific constraints all require a clean reimplementation. But the math is solved — do not reinvent the curve.

---

## 5. Tokenization (Codex-2's territory)

Three contracts, tightly coupled:

**`sy-wrapper`** — wraps an underlying yield-bearing asset (initially a Blend pool position) into a standardized yield-accruing share. Pattern: OpenZeppelin's Soroban Vault extension (`stellar-tokens::fungible::extensions::vault`). One SY contract per underlying.

**`tokenizer`** — takes SY, mints equal amounts of PT and YT, both tagged with the same maturity timestamp. At maturity, PT redeems 1:1 for SY (and from there, for the underlying). After maturity, YT is permanently worthless and the contract refuses to mint new YT.

**`pt-token` / `yt-token`** — both SEP-41-compatible (the Stellar fungible token interface). PT additionally implements a `redeem_at_maturity` function. YT additionally implements a `claim_yield` function that distributes accrued underlying yield to YT holders, pro-rata, between issuance and maturity.

**The accrual model for YT.** This is the subtle part. YT does not auto-compound. Instead, each `claim_yield` call computes `(current_sy_exchange_rate - last_claim_exchange_rate) * yt_balance` and transfers the resulting SY to the holder, then updates the holder's last-claim checkpoint. This means YT holders must claim periodically; unclaimed yield is not lost, but it does not accrue interest on interest. Match Pendle's behavior here.

**Storage segregation.** Stateful per-holder data (YT last-claim checkpoints, in particular) is keyed by `(holder_address, maturity)`, never by holder alone. This matters when v2 adds multiple maturities.

---

## 6. SDK (Claude-1's territory)

TypeScript, published as `@sidereal/sdk`. Wraps the contract calls in typed methods. Has three responsibilities:

1. **Encode/decode.** Soroban ScVal ↔ JS types. Use `@stellar/stellar-sdk` ≥ latest stable.
2. **Quote.** Given a swap intent, simulate against the AMM and return expected output, price impact, implied APY. Used by the frontend before the user signs.
3. **Build transactions.** Return a Soroban transaction envelope that the frontend hands to a wallet for signing. Never sign in the SDK.

Public API surface:

```typescript
class StellarYT {
  constructor(opts: { rpcUrl: string; networkPassphrase: string; contracts: ContractAddresses });

  // queries
  async getMarket(marketId: string): Promise<MarketState>;
  async quoteSwap(args: SwapArgs): Promise<Quote>;
  async getPosition(holder: string, marketId: string): Promise<Position>;

  // transaction builders (return unsigned envelopes)
  buildMint(args: MintArgs): Promise<TransactionEnvelope>;
  buildSwap(args: SwapArgs): Promise<TransactionEnvelope>;
  buildRedeem(args: RedeemArgs): Promise<TransactionEnvelope>;
}
```

**Hard rule:** the SDK has zero React/Vue/framework dependencies. It is plain TypeScript. The frontend imports it; the SDK does not import the frontend.

---

## 7. Frontend (Claude-2's territory)

Next.js 14+, App Router, Tailwind. Wallet connection via `@creit.tech/stellar-wallets-kit` (the standard kit for Soroban smart-account wallets, including Freighter, Albedo, xBull, Lobstr, and C-address-cohort wallets).

Four pages for the MVP:

1. **`/`** — landing. Explains the protocol in 3 sentences, links to docs, shows current pool stats (TVL, implied APY, days to maturity).
2. **`/mint`** — deposit USDC, get SY, optionally split into PT + YT.
3. **`/trade`** — swap between PT, YT, and SY. Shows quote, price impact, implied APY.
4. **`/redeem`** — at or after maturity, redeem PT for underlying. Before maturity, recombine PT+YT into SY.

**Design constraints:**
- Mobile-first. Half of LATAM Stellar wallet users are on phones.
- All transactions show a human-readable preview before signing. "You will deposit 100 USDC and receive 100 SY-blendUSDC" — not raw XDR.
- Every quote displays the implied APY in basis points and the underlying APY for comparison. A user should understand whether they are buying at a premium or discount.
- No dark patterns. No countdown timers, no "X people just bought" notifications, no urgency manipulation.

---

## 8. Testing requirements

| Layer | Tool | Threshold |
|---|---|---|
| Contracts unit | `soroban-cli` test runner | 90% line coverage, no exceptions for math files |
| Contracts property | `proptest` | 10k iterations on PT+YT=SY invariant, no failures |
| SDK | `vitest` | All public methods have happy + error path tests |
| Frontend | `playwright` | Full mint → split → swap → redeem flow on testnet |
| Integration | custom harness | Deploys all contracts to local Soroban network, runs scripted scenarios |

CI runs all four on every PR. A PR with failing tests cannot merge. If a test is wrong, fix the test in a separate commit with a reason in the message — do not disable it.

---

## 9. Commit and PR discipline

- **Conventional commits.** `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`. The first line is ≤72 chars. Body explains *why*, not *what*.
- **One logical change per commit.** A commit that changes the AMM curve and also reformats the SDK is two commits.
- **Atomic PRs.** If a PR touches two columns from §3, it needs a coordination note in the description.
- **No "WIP" commits on `main`.** Use feature branches. `main` is always green.
- **Reference the agent.** Commit trailer: `Agent: codex-1` or `Agent: claude-2`. Helps when debugging which agent introduced a regression.

---

## 10. Environment

- **Rust:** stable, edition 2021. Pinned via `rust-toolchain.toml`.
- **Soroban SDK:** latest stable at start of sprint, pinned in `Cargo.toml`. Do not bump mid-sprint.
- **Node:** ≥ 20 LTS, pnpm as package manager.
- **Soroban CLI:** latest stable.
- **Network:** Stellar testnet for all dev work. Futurenet is too unstable; mainnet is not in scope for the MVP.

Local setup is in `README.md`. If the setup commands there do not work, file an issue — do not silently work around it.

---

## 11. What to do when stuck

In order:

1. **Check `ARCHITECTURE.md`.** Most "how does X work" questions are answered there with sources.
2. **Read the Pendle V2 docs.** Linked in §4. They are the canonical reference for this design.
3. **Ask the human.** The human is responsible for product decisions, ambiguous protocol choices, anything involving SCF strategy, and anything that requires talking to OpenZeppelin/Tyler/SDF. Do not make these calls yourself.
4. **If genuinely blocked for >30 min,** post a blocker comment in the PR and switch to a different task. Do not spin.

---

## 12. What is explicitly out of scope for this sprint

To prevent scope creep, here is the explicit no list:

- Multiple maturities on the same underlying. One maturity, period.
- Multiple underlyings. Blend USDC only. deJTRSY/YLDS come post-MVP.
- A governance token (vePENDLE-style). Designed in `ARCHITECTURE.md`, not built.
- Limit orders. Pendle has them; we do not, yet.
- Cross-chain. SODAX/NEAR Intents integration is a v2 conversation.
- Mainnet deployment. The MVP is testnet end-to-end.
- An audit. The audit is post-funding, run through SCF's Audit Bank.

If a feature is not in §4–7, it is out of scope. Anyone can request a scope change, but it goes through the human, not into a side branch.

---

## 13. Sources this design is grounded in

Everything in this spec is traceable. Primary sources:

- Pendle V2 AMM: https://docs.pendle.finance/ProtocolMechanics/LiquidityEngines/AMM
- Pendle Market contracts: https://docs.pendle.finance/pendle-v2/Developers/Contracts/PendleMarket
- Spectra docs: https://docs.spectra.finance/
- Spectra core (GitHub): https://github.com/perspectivefi/spectra-core
- Notional V3 AMM (the math root): https://github.com/notional-finance/contracts-v3
- Blend protocol docs: https://docs.blend.capital/
- Blend TVL/yield data: https://defillama.com/protocol/blend
- OpenZeppelin Soroban Vault extension: https://docs.openzeppelin.com/stellar-contracts/tokens/fungible
- Stellar DeFi 2026 ecosystem post: https://stellar.org/blog/ecosystem/what-the-defi-is-happening-on-stellar
- YieldBlox oracle exploit (why internal TWAP matters): https://medium.com/@cryip/10-8m-oracle-manipulation-exploit-on-stellars-blend-protocol-6bdcbb1568c0

If you find a more authoritative source for any claim in this spec, open a PR to update the link.

---

## 14. Build-in-public expectations

This repo is public from day one. Commit history will be read by SCF reviewers, OpenZeppelin's team, and Pendle's. Behave accordingly:

- Real names or stable pseudonyms in commits.
- No "test commit", "asdf", "fix stuff" messages. Write real ones.
- The README has a working demo link by end of week 1.
- A 2-minute demo video by end of week 2.
- Issues and discussions stay public. If something is sensitive (a security finding, a private conversation with OZ), that goes in an encrypted note, not a closed issue.