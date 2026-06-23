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
| SY wrapper (Blend USDC) | 🚧 |
| Tokenizer (PT/YT mint, redeem) | 🚧 |
| Time-decay AMM | 🚧 |
| TypeScript SDK | 🚧 |
| Frontend (mint, trade, redeem) | 🚧 |
| End-to-end testnet demo | 🚧 |

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the protocol design, math, and Soroban-specific decisions.

## Local development

Prerequisites:

```bash
# Rust + Soroban
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install --locked soroban-cli

# Node + pnpm
nvm install 20
npm install -g pnpm
```

Clone and build:

```bash
git clone https://github.com/<TODO-org>/sidereal
cd sidereal

# Contracts
cd contracts
cargo build --target wasm32-unknown-unknown --release

# SDK + frontend
cd ..
pnpm install
pnpm -F sdk build
pnpm -F app dev
```

Deploy to testnet:

```bash
./scripts/deploy-testnet.sh
```

This creates a fresh testnet account, deploys all contracts, configures a Blend USDC SY wrapper, and prints the contract addresses for the frontend's `.env.local`.

## Testing

```bash
# Contract unit + property tests
cd contracts && cargo test

# SDK
pnpm -F sdk test

# End-to-end (deploys to local Soroban network)
pnpm -F app test:e2e
```

The AMM has property tests verifying that `PT + YT = SY` holds across 10,000 random swap sequences. If a contract change causes any of those to fail, the change does not ship.

## Contributing

The repo is public from day one and we welcome external eyes. A few notes:

- The build is happening across four parallel agents (2 Codex, 2 Claude Code) per the spec in [`AGENTS.md`](./AGENTS.md). If you want to contribute, that file is the place to start.
- Open an issue before opening a large PR. Scope is tight by design (see §12 of `AGENTS.md`).
- Security findings: please email `<TODO-security-email>` rather than opening a public issue.

## Influences and prior art

- [Pendle V2](https://docs.pendle.finance/) — the canonical yield tokenization protocol. ~$5B TVL, the design we're adapting.
- [Spectra](https://docs.spectra.finance/) — EVM yield tokenization built on ERC-4626. Their permissionless-pool experience informed our decision to launch with curated pools first.
- [Notional Finance](https://docs.notional.finance/) — the AMM math root.
- [OpenZeppelin Soroban](https://docs.openzeppelin.com/stellar-contracts/) — the Vault extension is what makes the SY wrapper feasible on Soroban without a year of foundational work.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

## Acknowledgments

Built during the [Stellar Build Station Kolkata 2026](https://stellar.org/) sprint. Thanks to the SCF team, OpenZeppelin's Stellar group, and the Blend, Centrifuge, and Aquarius teams whose work this builds on.