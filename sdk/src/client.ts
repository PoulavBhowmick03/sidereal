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
import { BPS_DENOMINATOR, WAD } from "./types.js";
import { marketMethodFor, quoteMethodFor, priceImpactBps, secondsToMaturity } from "./routes.js";

type Operation = ReturnType<Contract["call"]>;

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

    // Accessors pinned from codex-1's bus reply (feat/amm): twap_apy() is the
    // internal TWAP, spot_apy() the single-block view, reserve_pt/reserve_sy the
    // pool balances. APY reads return zero at/after maturity.
    const [exchangeRate, twapApyBps, spotApyBps, twapWarmingUp, maturity, underlying, totalPt, totalSy] =
      await Promise.all([
        this.simulateRead<bigint>(sy.call("exchange_rate")),
        this.simulateRead<bigint>(market.call("twap_apy")),
        this.simulateRead<bigint>(market.call("spot_apy")),
        this.simulateRead<boolean>(market.call("twap_warming_up")),
        this.simulateRead<bigint>(market.call("maturity")),
        this.simulateRead<string>(sy.call("underlying")),
        this.simulateRead<bigint>(market.call("reserve_pt")),
        this.simulateRead<bigint>(market.call("reserve_sy")),
      ]);

    const maturitySec = Number(maturity);
    const nowSec = Math.floor(Date.now() / 1000);

    return {
      marketId,
      underlying,
      exchangeRate,
      impliedApyBps: twapApyBps,
      spotApyBps,
      twapWarmingUp,
      maturity: maturitySec,
      secondsToMaturity: secondsToMaturity(maturitySec, nowSec),
      totalPt,
      totalSy,
    };
  }

  /**
   * Quotes a swap via the AMM's read-only quote accessors and returns expected
   * output, price impact, and the post-trade TWAP implied APY. Used by the
   * frontend before the user signs. These accessors return typed contract
   * errors (InvalidAmount / MarketNotSeeded / MarketMatured), not panics.
   */
  async quoteSwap(args: SwapArgs): Promise<Quote> {
    const market = new Contract(this.contracts.market);
    const quoteMethod = quoteMethodFor(args.assetIn, args.assetOut);
    const amountIn = nativeToScVal(args.amountIn, { type: "i128" });

    const [amountOut, impliedApyBps] = await Promise.all([
      this.simulateRead<bigint>(market.call(quoteMethod, amountIn)),
      this.simulateRead<bigint>(market.call("twap_apy")),
    ]);

    return {
      assetIn: args.assetIn,
      assetOut: args.assetOut,
      amountIn: args.amountIn,
      amountOut,
      priceImpactBps: priceImpactBps(args.amountIn, amountOut, BPS_DENOMINATOR),
      impliedApyBps,
    };
  }

  /**
   * Reads a holder's SY/PT/YT balances and claimable yield.
   *
   * PT/YT balances live in the tokenizer's per-holder Position accounting
   * (codex-2's feat/tokenization), not on the token contracts. SY balance is
   * the wrapper's share_balance. Claimable yield uses YT's preview_claim_yield,
   * which needs the holder's YT balance and the current SY exchange rate.
   */
  async getPosition(holder: string, marketId: string): Promise<Position> {
    const sy = new Contract(this.contracts.sy);
    const tokenizer = new Contract(this.contracts.tokenizer);
    const holderScVal = new Address(holder).toScVal();

    const [syBalance, position, exchangeRate] = await Promise.all([
      this.simulateRead<bigint>(sy.call("share_balance", holderScVal)),
      this.simulateRead<{ pt_balance: bigint; yt_balance: bigint }>(
        tokenizer.call("position", holderScVal),
      ),
      this.simulateRead<bigint>(sy.call("exchange_rate")),
    ]);

    const ptBalance = position.pt_balance;
    const ytBalance = position.yt_balance;

    // preview_claim_yield rejects a non-positive YT balance, so short-circuit.
    const claimableYield =
      ytBalance > 0n
        ? await this.simulateRead<bigint>(
            new Contract(this.contracts.yt).call(
              "preview_claim_yield",
              holderScVal,
              nativeToScVal(ytBalance, { type: "i128" }),
              nativeToScVal(exchangeRate, { type: "i128" }),
            ),
          )
        : 0n;

    return { holder, marketId, syBalance, ptBalance, ytBalance, claimableYield };
  }

  // --- transaction builders (return unsigned envelopes) --------------------

  /**
   * Builds a deposit (and optional PT+YT split) transaction.
   *
   * Without `split`: a single SY deposit. With `split`: the deposit plus a
   * tokenizer split in one envelope, using the exact SY mint preview
   * (shares = amount * WAD / exchangeRate). codex-2 to confirm the deposit ->
   * split atomic co-sign path; flagged on the bus.
   */
  async buildMint(args: MintArgs): Promise<TransactionEnvelope> {
    const from = new Address(args.from).toScVal();
    const sy = new Contract(this.contracts.sy);
    const amount = nativeToScVal(args.underlyingAmount, { type: "i128" });
    const depositOp = sy.call("deposit", from, amount);

    if (!args.split) {
      return this.buildEnvelope(args.from, [depositOp]);
    }

    const exchangeRate = await this.simulateRead<bigint>(sy.call("exchange_rate"));
    const syMinted = (args.underlyingAmount * WAD) / exchangeRate;
    const splitOp = new Contract(this.contracts.tokenizer).call(
      "split",
      from,
      nativeToScVal(syMinted, { type: "i128" }),
    );
    return this.buildEnvelope(args.from, [depositOp, splitOp]);
  }

  /** Builds a swap transaction matching the frozen Market trait routes. */
  async buildSwap(args: SwapArgs): Promise<TransactionEnvelope> {
    return this.buildEnvelope(args.from, [this.swapOperation(args)]);
  }

  /**
   * Builds a redeem transaction. After maturity, redeems `amount` PT 1:1 for SY
   * via redeem_at_maturity. Before maturity, recombines `amount` PT + `amount`
   * YT back into SY via recombine (the tokenizer requires pt == yt).
   */
  async buildRedeem(args: RedeemArgs): Promise<TransactionEnvelope> {
    const from = new Address(args.from).toScVal();
    const amount = nativeToScVal(args.amount, { type: "i128" });
    const tokenizer = new Contract(this.contracts.tokenizer);

    const matured = await this.simulateRead<boolean>(tokenizer.call("is_matured"));
    const op = matured
      ? tokenizer.call("redeem_at_maturity", from, amount)
      : tokenizer.call("recombine", from, amount, amount);
    return this.buildEnvelope(args.from, [op]);
  }

  // --- submit --------------------------------------------------------------

  /**
   * Broadcasts a transaction the user has already signed in their wallet and
   * waits for it to land. This is not signing: the SDK never holds keys; it
   * only relays the signed envelope and polls for the result.
   */
  async submit(signedXdr: string): Promise<{ hash: string; status: string }> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === "ERROR") {
      throw new Error(`submit rejected: ${JSON.stringify(sent.errorResult)}`);
    }

    let result = await this.server.getTransaction(sent.hash);
    const deadline = Date.now() + 30_000;
    while (
      result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await this.server.getTransaction(sent.hash);
    }

    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`transaction ${sent.hash} did not succeed: ${result.status}`);
    }
    return { hash: sent.hash, status: result.status };
  }

  // --- internals -----------------------------------------------------------

  /** Maps an (assetIn, assetOut) pair to the right frozen Market route. */
  private swapOperation(args: SwapArgs): Operation {
    const market = new Contract(this.contracts.market);
    const from = new Address(args.from).toScVal();
    const amountIn = nativeToScVal(args.amountIn, { type: "i128" });
    const minOut = nativeToScVal(args.minAmountOut, { type: "i128" });
    const method = marketMethodFor(args.assetIn, args.assetOut);
    return market.call(method, from, amountIn, minOut);
  }

  /** Simulates a read-only call and decodes the ScVal result to a JS value. */
  private async simulateRead<T>(op: Operation): Promise<T> {
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
    ops: Operation[],
  ): Promise<TransactionEnvelope> {
    const source = await this.server.getAccount(sourceAccount);
    const builder = new TransactionBuilder(source, {
      fee: "1000000",
      networkPassphrase: this.networkPassphrase,
    }).setTimeout(120);
    for (const op of ops) {
      builder.addOperation(op);
    }
    const tx = builder.build();

    const prepared = await this.server.prepareTransaction(tx);
    return {
      xdr: prepared.toXDR(),
      networkPassphrase: this.networkPassphrase,
    };
  }
}
