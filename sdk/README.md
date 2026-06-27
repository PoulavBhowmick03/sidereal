# @sidereal/sdk

TypeScript client for the [sidereal](../README.md) yield-tokenization protocol
on Stellar. Wraps the Soroban contracts in typed methods that encode/decode
ScVal, quote swaps, and build unsigned transactions for a wallet to sign.

The SDK never holds keys and never signs. It builds unsigned transaction
envelopes and (after the wallet signs) relays them to the network.

## Install

```bash
pnpm add @sidereal/sdk @stellar/stellar-sdk
```

## Usage

```ts
import { StellarYT } from "@sidereal/sdk";

const client = new StellarYT({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  simulationSourceAccount, // funded public G-account, never used for signing
  contracts: { sy, pt, yt, tokenizer, market }, // deployed addresses
});

// Read market state (reserves, TWAP implied APY, maturity).
const market = await client.getMarket("blend-usdc-q3");

// Quote a swap before signing.
const quote = await client.quoteSwap({
  marketId: "blend-usdc-q3",
  from: address,
  assetIn: "SY",
  assetOut: "PT",
  amountIn: 100_0000000n, // base units (7 decimals)
  minAmountOut: 0n,
});

// Build -> sign (in the wallet) -> submit.
const env = await client.buildSwap({ /* ...SwapArgs */ });
const signedXdr = await wallet.signTransaction(env.xdr);
const { hash } = await client.submit(signedXdr);
```

## API

- `getMarket(marketId)` reserves, exchange rate, TWAP and spot APY, maturity.
- `quoteSwap(args)` expected output, price impact, implied APY.
- `getPosition(holder, marketId)` SY/PT/YT balances and claimable yield.
- `buildMint(args)` deposit, optionally split into PT + YT.
- `buildSwap(args)` PT/SY swaps and YT flash routes.
- `buildRedeem(args)` recombine before maturity, redeem PT after.
- `buildAddLiquidity(args)` / `buildRemoveLiquidity(args)` provide or withdraw PT/SY liquidity.
- `submit(signedXdr)` broadcast a wallet-signed transaction and await it.

All amounts are `bigint` base units. APYs and price impact are basis points.
Failed contract calls throw a `ContractError` carrying the contract error code.

## License

Apache-2.0.
