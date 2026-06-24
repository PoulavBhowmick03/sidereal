# sidereal

> Yield tokenization on Stellar. Split yield-bearing assets into fixed-income and variable-yield instruments. Trade them in a time-decay AMM.

**Status:** in active development as part of the Stellar Build Station 2026 sprint. Testnet only. Not yet audited. Do not deposit real funds.

---

## What this is

A protocol that takes a yield-bearing asset on Stellar (initially USDC deposited into a [Blend](https://docs.blend.capital/) lending pool) and splits it into two tradable tokens:

- **PT (Principal Token)** — redeemable 1:1 for the underlying at maturity. Buy at a discount, hold to maturity, lock in a fixed yield.
- **YT (Yield Token)** — claims all the variable yield the underlying generates between now and maturity. Expires worthless at maturity.

`PT + YT = SY` (Standardized Yield) at all times. You can always recombine.

The two tokens trade against the SY wrapper in a single time-aware AMM, modeled on [Pendle V2's market math](https://docs.pendle.finance/ProtocolMechanics/LiquidityEngines/AMM) (itself adapted from Notional Finance's AMM). YT swaps route through the same pool via flash swap, so all three markets share one liquidity book.

## Why Stellar, why now

Stellar's DeFi base has the substrate for a fixed-income market:

- Blend's USDC pool currently yields ~8.6% with ~$95M TVL ([source](https://defillama.com/protocol/blend))
- Centrifuge's tokenized treasuries (deJTRSY, deJAAA) launched on Stellar in early 2026 ([source](https://stellar.org/blog/ecosystem/what-the-defi-is-happening-on-stellar))
- RWA on Stellar crossed $2B in Q1 2026

What's missing is the layer that lets institutional users hedge that yield and lets traders express views on its direction. That's this protocol.

## What's built

| Component | Status |
|---|---|
| SY wrapper (shares, exchange rate, accrued yield) | ✅ built, 4 tests |
| Tokenizer (split, recombine, redeem at maturity) | ✅ built, 10 tests |
| PT / YT tokens | ✅ built, 3 tests each |
| Time-decay AMM (PT/SY pool, TWAP, quotes) | ✅ built, 15 tests incl. property suite |
| TypeScript SDK (typed client, quote, build, submit) | ✅ built, 11 tests |
| Frontend (mint, trade, redeem, wallet connect) | ✅ built, 12 tests |
| Cross-contract integration tests | ✅ 3 tests (deposit/split/recombine, redeem, AMM) |
| Integrated workspace (everything builds together) | ✅ `cargo`, SDK, and `next build` green |
| Testnet deploy script | ✅ `scripts/deploy-testnet.sh` |
| Live testnet end-to-end demo | 🚧 needs token settlement (plan in [docs/REMAINING.md](./docs/REMAINING.md)) |

All layers compile and test together on one branch. The remaining work for a
live on-chain demo is documented under [Limitations](#current-limitations).

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the protocol design, math, and Soroban-specific decisions.

## Local development

Prerequisites:

```bash
# Rust toolchain and the Soroban wasm target (SDK 26 needs wasm32v1-none)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# Stellar CLI (only needed to deploy)
cargo install --locked stellar-cli

# Node and pnpm
nvm install 20
npm install -g pnpm
```

Clone, build, and test the whole monorepo with the Makefile:

```bash
git clone https://github.com/PoulavBhowmick03/sidereal
cd sidereal

make install   # install JS workspace deps
make test      # contracts + SDK + app test suites
make build     # wasm contracts, SDK, and a production app build
make dev       # run the frontend dev server
```

Deploy to testnet and wire the frontend:

```bash
make deploy    # or: bash scripts/deploy-testnet.sh
```

This builds the contracts to wasm, generates and funds a deployer identity (no
hardcoded keys), deploys SY/PT/YT/tokenizer/AMM, initializes them in dependency
order, and writes the contract addresses to `app/.env.local`.

## Deploying the frontend (Vercel)

Set the Vercel project's **Root Directory to `app`** (Settings > General > Root
Directory). Vercel then detects Next.js and reads `app/vercel.json`, which
builds the workspace SDK before the app (`pnpm --filter @sidereal/sdk build &&
next build`). Vercel runs the install at the pnpm workspace root automatically,
so `@sidereal/sdk` resolves. Use Node 20+.

Set the contract addresses as environment variables in the Vercel project (all
public `NEXT_PUBLIC_*`, no secrets); see `app/.env.example` for the full list.
Without them the site builds and runs but shows the "no market configured"
banner.

## Testing

```bash
make contracts-test   # cargo test --workspace
make sdk-test         # SDK typecheck + vitest
make app-test         # app typecheck + vitest
```

The AMM has property tests verifying that `PT + YT = SY` holds across random
swap sequences. If a contract change causes any of those to fail, the change
does not ship. CI (`.github/workflows/ci.yml`) runs all three layers on every PR.

## Current limitations

The protocol compiles, tests, and is wired end to end, with two known gaps
before a live on-chain demo:

1. **Token settlement.** The SY wrapper, tokenizer, and AMM currently track
   balances with internal accounting rather than moving real SEP-41 tokens
   between contracts. A deploy will run and the UI will drive it, but value is
   not yet custodied or transferred on chain.
2. **YT flash route.** `swap_sy_for_yt` / `swap_yt_for_sy` depend on the
   cross-contract settlement surface above, so YT trades are wired in the SDK
   and UI but not yet functional on chain. PT/SY swaps, mint, and redeem are
   complete paths.

The detailed plan to close both gaps (six workstreams, ownership, sequencing,
and acceptance criteria) is in [`docs/REMAINING.md`](./docs/REMAINING.md).

## Contributing

The repo is public from day one and we welcome external eyes. A few notes:

- The build is happening across four parallel agents (2 Codex, 2 Claude Code) per the spec in [`AGENTS.md`](./AGENTS.md). If you want to contribute, that file is the place to start.
- Open an issue before opening a large PR. Scope is tight by design (see §12 of `AGENTS.md`).
- Security findings: please report privately via GitHub's "Report a vulnerability" (Security tab, private advisory) rather than opening a public issue. See [`SECURITY.md`](./SECURITY.md).

## Influences and prior art

- [Pendle V2](https://docs.pendle.finance/) — the canonical yield tokenization protocol. ~$5B TVL, the design we're adapting.
- [Spectra](https://docs.spectra.finance/) — EVM yield tokenization built on ERC-4626. Their permissionless-pool experience informed our decision to launch with curated pools first.
- [Notional Finance](https://docs.notional.finance/) — the AMM math root.
- [OpenZeppelin Soroban](https://docs.openzeppelin.com/stellar-contracts/) — the Vault extension is what makes the SY wrapper feasible on Soroban without a year of foundational work.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

## Acknowledgments

Built during the [Stellar Build Station Kolkata 2026](https://stellar.org/) sprint. Thanks to the SCF team, OpenZeppelin's Stellar group, and the Blend, Centrifuge, and Aquarius teams whose work this builds on.