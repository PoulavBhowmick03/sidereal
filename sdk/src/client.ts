// SPDX-License-Identifier: Apache-2.0

import { Contract, TransactionBuilder, rpc, scValToNative, nativeToScVal, Address } from "@stellar/stellar-sdk";
import type {
  ContractAddresses,
  MarketState,
  MintArgs,
  Position,
  Quote,
  RedeemArgs,
  StellarYTOptions,
  SwapArgs,
  TransactionEnvelope,
} from "./types.js";
import { BPS_DENOMINATOR } from "./types.js";
import { marketMethodFor, priceImpactBps, secondsToMaturity } from "./routes.js";

/**
 * Typed client for the sidereal protocol.
 *
 * Responsibilities (AGENTS.md §6): encode/decode ScVal <-> JS, quote swaps by
 * simulating against the AMM, and build unsigned transaction envelopes for a
 * wallet to sign. This client NEVER signs and NEVER holds keys.
 */
export class StellarYT {
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;
  private readonly contracts: ContractAddresses;

  constructor(opts: StellarYTOptions) {
    this.server = new rpc.Server(opts.rpcUrl, {
      allowHttp: opts.rpcUrl.startsWith("http://"),
    });
    this.networkPassphrase = opts.networkPassphrase;
    this.contracts = opts.contracts;
  }

  // --- queries -------------------------------------------------------------

  /** Reads current market state from the AMM and SY contracts. */
  async getMarket(marketId: string): Promise<MarketState> {
    const market = new Contract(this.contracts.market);
    const sy = new Contract(this.contracts.sy);

    const [exchangeRate, impliedApyBps, maturity, underlying] = await Promise.all([
      this.simulateRead<bigint>(sy.call("exchange_rate")),
      this.simulateRead<bigint>(market.call("implied_apy")),
      this.simulateRead<bigint>(market.call("maturity")),
      this.simulateRead<string>(sy.call("underlying")),
    ]);

    const maturitySec = Number(maturity);
    const nowSec = Math.floor(Date.now() / 1000);

    // Reserves are not part of the frozen trait surface; codex-1 to confirm the
    // read accessor name. Default to 0n until that binding is pinned on the bus.
    const totalPt = 0n;
    const totalSy = 0n;

    return {
      marketId,
      underlying,
      exchangeRate,
      impliedApyBps,
      maturity: maturitySec,
      secondsToMaturity: secondsToMaturity(maturitySec, nowSec),
      totalPt,
      totalSy,
    };
  }

  /**
   * Simulates a swap and returns expected output, price impact, and the
   * resulting implied APY. Used by the frontend before the user signs.
   */
  async quoteSwap(args: SwapArgs): Promise<Quote> {
    const op = this.swapOperation(args);
    const amountOut = await this.simulateRead<bigint>(op);

    const impliedApyBps = await this.simulateRead<bigint>(
      new Contract(this.contracts.market).call("implied_apy"),
    );

    return {
      assetIn: args.assetIn,
      assetOut: args.assetOut,
      amountIn: args.amountIn,
      amountOut,
      // Refined once codex-1 confirms a reserves accessor; for now derived from
      // realized output vs. the input notional.
      priceImpactBps: priceImpactBps(args.amountIn, amountOut, BPS_DENOMINATOR),
      impliedApyBps,
    };
  }

  /** Reads a holder's SY/PT/YT balances and claimable yield. */
  async getPosition(holder: string, marketId: string): Promise<Position> {
    const sy = new Contract(this.contracts.sy);
    const pt = new Contract(this.contracts.pt);
    const yt = new Contract(this.contracts.yt);
    const holderScVal = new Address(holder).toScVal();

    const [syBalance, ptBalance, ytBalance, claimableYield] = await Promise.all([
      this.simulateRead<bigint>(sy.call("balance", holderScVal)),
      this.simulateRead<bigint>(pt.call("balance", holderScVal)),
      this.simulateRead<bigint>(yt.call("balance", holderScVal)),
      this.simulateRead<bigint>(sy.call("accrued_yield", holderScVal)),
    ]);

    return { holder, marketId, syBalance, ptBalance, ytBalance, claimableYield };
  }

  // --- transaction builders (return unsigned envelopes) --------------------

  /** Builds a deposit (and optional PT+YT split) transaction. */
  async buildMint(args: MintArgs): Promise<TransactionEnvelope> {
    const from = new Address(args.from).toScVal();
    const sy = new Contract(this.contracts.sy);
    const op = args.split
      ? new Contract(this.contracts.tokenizer).call(
          "mint_from_underlying",
          from,
          nativeToScVal(args.underlyingAmount, { type: "i128" }),
        )
      : sy.call("deposit", from, nativeToScVal(args.underlyingAmount, { type: "i128" }));
    return this.buildEnvelope(args.from, op);
  }

  /** Builds a swap transaction matching the frozen Market trait routes. */
  async buildSwap(args: SwapArgs): Promise<TransactionEnvelope> {
    return this.buildEnvelope(args.from, this.swapOperation(args));
  }

  /** Builds a redeem (post-maturity) or recombine (pre-maturity) transaction. */
  async buildRedeem(args: RedeemArgs): Promise<TransactionEnvelope> {
    const from = new Address(args.from).toScVal();
    const amount = nativeToScVal(args.amount, { type: "i128" });
    const op = new Contract(this.contracts.tokenizer).call("redeem", from, amount);
    return this.buildEnvelope(args.from, op);
  }

  // --- internals -----------------------------------------------------------

  /** Maps an (assetIn, assetOut) pair to the right frozen Market route. */
  private swapOperation(args: SwapArgs) {
    const market = new Contract(this.contracts.market);
    const from = new Address(args.from).toScVal();
    const amountIn = nativeToScVal(args.amountIn, { type: "i128" });
    const minOut = nativeToScVal(args.minAmountOut, { type: "i128" });
    const method = marketMethodFor(args.assetIn, args.assetOut);
    return market.call(method, from, amountIn, minOut);
  }

  /** Simulates a read-only call and decodes the ScVal result to a JS value. */
  private async simulateRead<T>(op: ReturnType<Contract["call"]>): Promise<T> {
    const source = await this.server.getAccount(this.contracts.market).catch(() => null);
    if (source === null) {
      throw new Error("cannot simulate: source account not found on RPC");
    }
    const tx = new TransactionBuilder(source, {
      fee: "0",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`simulation failed: ${sim.error}`);
    }
    const retval = sim.result?.retval;
    if (retval === undefined) {
      throw new Error("simulation returned no value");
    }
    return scValToNative(retval) as T;
  }

  /** Assembles an unsigned, simulation-prepared transaction envelope. */
  private async buildEnvelope(
    sourceAccount: string,
    op: ReturnType<Contract["call"]>,
  ): Promise<TransactionEnvelope> {
    const source = await this.server.getAccount(sourceAccount);
    const tx = new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    return {
      xdr: prepared.toXDR(),
      networkPassphrase: this.networkPassphrase,
    };
  }
}
