# sidereal demo walkthrough

A step by step run of the protocol end to end on Stellar testnet. This is the
script behind the build-in-public demo. It assumes a clean checkout.

## 0. Prerequisites

```bash
rustup target add wasm32v1-none      # Soroban SDK 26 target
cargo install --locked stellar-cli   # deploy + invoke
npm install -g pnpm                   # JS workspace
```

## 1. Build and test everything

```bash
make install   # JS deps
make test      # 35 contract tests, 29 SDK tests, 12 app tests
make build     # wasm contracts + SDK + production app build
```

Expected: every suite green, five `.wasm` artifacts under
`target/wasm32v1-none/release/`, and a successful `next build`.

## 2. Deploy to testnet

```bash
make deploy
```

This generates and funds a deployer identity (no hardcoded keys), deploys the
SY wrapper, PT, YT, tokenizer, and AMM, initializes them in dependency order
with a 90 day maturity, and writes the addresses to `app/.env.local`. The
deployer public key and all five contract IDs are printed.

## 3. Run the frontend

```bash
make dev   # http://localhost:3000
```

Connect a testnet wallet (Freighter, xBull, Albedo, Lobstr, or Hana) with the
button in the top right.

## 4. The user journey

1. **Home** shows live pool stats read from the AMM: SY and PT reserves, the
   TWAP implied APY (with the spot rate and a "stabilizing" note while the TWAP
   window fills), and days to maturity.
2. **Mint** deposits USDC for SY and, with split enabled, mints equal PT and YT.
   A human readable preview ("you will receive ~N PT and ~N YT") is shown before
   you sign.
3. **Trade** swaps between PT, YT, and SY. Pick a direction (buy/sell PT or YT),
   enter an amount, and a live quote shows expected output, price impact, the
   implied APY, and the minimum received at 0.5% slippage.
4. **Redeem** reads your position and either recombines PT + YT back into SY
   (before maturity) or redeems PT 1:1 (after maturity).

Every action runs the same path: the SDK builds an unsigned transaction, the
wallet signs it, and the SDK submits and waits for confirmation. The SDK never
holds keys.

## Current limitations

See the [Limitations section in the README](../README.md#current-limitations).
In short: the contracts use internal accounting rather than real SEP-41 token
transfers between contracts, so a deploy runs and the UI drives on chain state,
but external token value is not yet custodied and the YT flash route does not
settle yet. PT/SY mint, swap, and redeem are complete paths.
