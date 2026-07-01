# sidereal

> Real-settlement yield tokenization on Stellar. Split yield-bearing vault shares into principal and yield tokens, then recombine or redeem them through Soroban contracts.

**Status:** active Stellar Build Station / Instaward prototype. Testnet only. Not audited. Do not deposit real funds. The core lifecycle (deposit, split, recombine, redeem, claim) settles real SEP-41 tokens. The PT/SY AMM and the YT flash route are experimental and pending testnet auth verification (see [Current limitations](#current-limitations)).

---

## What this is

A protocol that takes a yield-bearing asset on Stellar and splits it into two tradable tokens:

- **PT (Principal Token)**, redeems for its principal in the underlying at maturity (`amount * WAD / maturity_rate` of SY). Buy at a discount, hold to maturity, lock in a fixed yield.
- **YT (Yield Token)**, claims all the variable yield the underlying generates between now and maturity, paid in SY out of escrow on claim. Expires worthless at maturity.

The SY wrapper supports idle mock custody for contract tests and live [Blend](https://docs.blend.capital/) v2 plain-supply custody for testnet. Blend-backed wrappers derive their read-only exchange rate from the wrapper's bToken position and reject the admin rate setter.

`PT + YT = SY` (Standardized Yield) at all times. You can always recombine.

The two tokens trade against the SY wrapper in a single time-aware AMM, modeled on [Pendle V2's market math](https://docs.pendle.finance/ProtocolMechanics/LiquidityEngines/AMM) (itself adapted from Notional Finance's AMM). YT swaps route through the same pool via flash swap, so all three markets share one liquidity book.

## Why Stellar, why now

Stellar's DeFi base has the substrate for a fixed-income market:

- Blend's USDC pool currently yields ~8.6% with ~$95M TVL ([source](https://defillama.com/protocol/blend))
- Centrifuge's tokenized treasuries (deJTRSY, deJAAA) launched on Stellar in early 2026 ([source](https://stellar.org/blog/ecosystem/what-the-defi-is-happening-on-stellar))
- RWA on Stellar crossed $2B in Q1 2026

What's missing is the layer that lets institutional users hedge that yield and lets traders express views on its direction. That's this protocol.

## What's built

Status legend: **built** (real settlement, tested) · **experimental** (works under test mocks, auth not yet proven) · **pending testnet verification** · **planned**.

| Component | Status |
|---|---|
| SY wrapper real vault (real underlying transfer in/out, share mint/burn) | ✅ built |
| PT SEP-41 token (balance/transfer/allowance, tokenizer-gated mint/burn) | ✅ built |
| YT SEP-41 token (balance/transfer/allowance, per-holder yield checkpoints) | ✅ built |
| Tokenizer split / recombine / redeem (asset-unit PT/YT, principal redemption) | ✅ built |
| YT yield claim (pays accrued yield in SY out of escrow, transfer-safe) | ✅ built |
| Insolvency guard + escrow-coverage invariant (pro-rata cap, YT subordinated) | ✅ built |
| Checked tokenization math + initialize gates (audit M2/M3) | ✅ built |
| AMM integer fixed-point math (no float opcodes) + CI guard | ✅ built |
| TypeScript SDK (typed client, quote, build, claim, submit) | ✅ built |
| Frontend (mint, split, recombine, redeem, claim) | ✅ built |
| PT/SY AMM (custody, swaps, TWAP, time decay) | ⚠️ experimental, mock-auth only |
| YT flash route (split/recombine through tokenizer in one tx) | ⚠️ experimental, auth not proven |
| Cross-contract integration tests | ✅ real-balance journeys + 10k-case economics property test; YT flash under permissive auth mock |
| Testnet deploy script | ✅ `scripts/deploy-testnet.sh` (now passes `--yt_token`, pins source commit) |
| Live testnet end-to-end demo | 🚧 pending testnet deploy + verification |

The core settlement lifecycle moves real SEP-41 tokens and is covered by tests
that reconcile balances against the actual token contracts. The AMM and YT flash
route compile and pass under `mock_all_auths`, but the nested authorization tree
has not been proven without permissive mocks or on testnet, so they are not
demo-ready. See [Current limitations](#current-limitations).

## Architecture

```
                 User
                  | deposit underlying
                  v
          SY Wrapper / Vault   (real SEP-41 underlying in, SY shares out)
                  | mint SY
                  v
              Tokenizer        (custodies SY, drives PT/YT)
               /        \
              v          v
          PT Token    YT Token
              |           |
           Redeem      Claim yield
        (1:1 at maturity)  (variable, reads real YT balance)

  Optional / experimental, gated until auth is proven on testnet:
          PT/SY AMM  --  YT flash route (split/recombine via tokenizer)
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the protocol design, math, and Soroban-specific decisions, and [`docs/SETTLEMENT.md`](./docs/SETTLEMENT.md) for the real-token settlement model.

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
make deploy    # or: bash scripts/deploy-testnet-resilient.sh
```

This builds the contracts to wasm, generates and funds a deployer identity (no
hardcoded keys), deploys SY/PT/YT/tokenizer/AMM, initializes them in dependency
order, writes the contract addresses to `app/.env.local`, and emits a public
deployment manifest at `deployments/testnet.toml`.

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

The AMM has property tests verifying `PT + YT = SY` across random swap sequences,
and the economics suite runs a 10,000-case conservation property test over random
split/transfer/claim/recombine/redeem sequences with rate changes. These run on
the native target. Because the AMM curve math compiles differently for native
(where it once used floats) than for the wasm VM (which rejects float opcodes),
CI also builds every contract to `wasm32v1-none` and fails if any float opcode
appears (`scripts/check-wasm-floats.sh`). That guard, not the property tests, is
what catches a float regression before it reaches a deploy. CI
(`.github/workflows/ci.yml`) runs all three layers on every PR.

## Current limitations

1. **Core settlement is real, not internal accounting.** The SY wrapper,
   PT/YT tokens, and tokenizer move real SEP-41 tokens. Deposit pulls underlying
   into the vault, split/recombine custody SY and mint/burn PT and YT, and
   redeem returns underlying at maturity. Tests reconcile balances against the
   actual token contracts. This is the demo-ready path.
2. **AMM and YT flash route are experimental.** The PT/SY AMM custodies tokens
   and the YT flash route settles through the tokenizer in one transaction, but
   both rely on a nested `authorize_as_current_contract` tree that is only
   exercised under `mock_all_auths`. The authorization tree has not been proven
   without permissive mocks or on testnet. Do not present these as production
   or grant ready until that verification passes. The UI surfaces a warning on
   YT routes.
3. **Testnet deployment is required before grant submission.** The contracts
   build to wasm and the deploy script exists, but a live testnet run that
   reconciles real balances has not yet been recorded.
4. **Not audited, testnet only.** No third-party audit. Do not use real funds.

The completed settlement work, remaining AMM/auth work, the testnet verification
checklist, and known risks are tracked in
[`docs/REMAINING.md`](./docs/REMAINING.md). The three-week execution plan is in
[`docs/ROADMAP.md`](./docs/ROADMAP.md).

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
