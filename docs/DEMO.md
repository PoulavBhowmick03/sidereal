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
make test      # 38 Rust tests (35 contract + 3 integration), 29 SDK, 12 app
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

Then seed the fresh market with core activity (a deposit and a split) so the
demo shows real balances:

```bash
make seed
```

By default `make seed` seeds only the Tier 1 core (deposit + split). It does not
seed AMM liquidity, because the AMM/YT flash route is experimental and its auth
is not yet proven on testnet. Once that verification passes, opt in with
`SEED_AMM=1 make seed` to add PT/SY liquidity for the AMM demo.

## 3. Run the frontend

```bash
make dev   # http://localhost:3000
```

Connect a testnet wallet (Freighter, xBull, Albedo, Lobstr, or Hana) with the
button in the top right.

## 4. Core demo script (real settlement)

This is the demo to record for Build Station / Instaward. Every step moves real
SEP-41 tokens; show the balance and the explorer link at each step.

1. Deploy the underlying token (a Stellar Asset Contract on testnet).
2. Deploy the SY wrapper.
3. Deploy PT and YT.
4. Deploy the tokenizer and wire it to SY/PT/YT.
5. **Deposit** underlying into SY. Show the vault's underlying balance rise and
   the user's SY balance appear.
6. **Split** SY into PT + YT. Show equal PT and YT minted to the user and the
   tokenizer now custodying the SY.
7. **Increase the mock exchange rate** (admin testnet knob) to simulate yield.
8. **Claim yield** with YT. Show the payout against the real YT balance.
9. **Recombine** PT + YT before maturity. Show SY returned and PT/YT burned.
10. **Split** again to set up the maturity path.
11. **Advance maturity** (testnet time control / a short maturity).
12. **Redeem PT** 1:1. Show underlying returned and PT burned.
13. Show final balances and the explorer links for each transaction.

Every action runs the same path: the SDK builds an unsigned transaction, the
wallet signs it, and the SDK submits and waits for confirmation. The SDK never
holds keys.

## 5. AMM demo (future milestone, gated)

The PT/SY AMM and the YT flash route are **not** part of the core demo. They are
implemented but only proven under `mock_all_auths`; the nested authorization
tree has not been verified on testnet. Do not show or claim the AMM/YT flash
route as working until that verification passes. Track the gate in
[`docs/REMAINING.md`](./REMAINING.md) section 2.

## Current limitations

See the [Limitations section in the README](../README.md#current-limitations).
The core lifecycle (deposit, split, recombine, redeem, claim) settles real
SEP-41 tokens. The AMM and YT flash route are experimental and pending testnet
auth verification, so they are excluded from the demo above.
