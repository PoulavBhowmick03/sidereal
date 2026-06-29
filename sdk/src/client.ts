// SPDX-License-Identifier: Apache-2.0

import {
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  nativeToScVal,
  Address,
  StrKey,
} from "@stellar/stellar-sdk";
import type {
  AddLiquidityArgs,
  ContractAddresses,
  MarketState,
  MintArgs,
  SplitArgs,
  Position,
  Quote,
  RedeemArgs,
  RedeemSyArgs,
  ClaimArgs,
  RemoveLiquidityArgs,
  StellarYTOptions,
  SwapArgs,
  TransactionEnvelope,
} from "./types.js";
import { BPS_DENOMINATOR } from "./types.js";
import { marketMethodFor, quoteMethodFor, priceImpactBps, secondsToMaturity } from "./routes.js";
import { ContractError, parseContractErrorCode } from "./errors.js";

type Operation = ReturnType<Contract["call"]>;
type SourceAccount = Awaited<ReturnType<rpc.Server["getAccount"]>>;
type SubmittedTransaction = ReturnType<typeof TransactionBuilder.fromXDR>;

/** Fails fast on a non-positive amount so we never build a doomed transaction. */
function requirePositive(label: string, value: bigint): void {
  if (value <= 0n) {
    throw new Error(`${label} must be a positive amount`);
  }
}

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
  private readonly simulationSourceAccount: string;
  private readonly contracts: ContractAddresses;
  private static readonly sequenceFloorBySource = new Map<string, bigint>();

  constructor(opts: StellarYTOptions) {
    this.server = new rpc.Server(opts.rpcUrl, {
      allowHttp: opts.rpcUrl.startsWith("http://"),
    });
    this.networkPassphrase = opts.networkPassphrase;
    this.simulationSourceAccount = opts.simulationSourceAccount;
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
    requirePositive("amountIn", args.amountIn);
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
   * PT and YT are real SEP-41 tokens now, so tokenizer.position reads the
   * holder's on-chain PT/YT balances and SY balance is the wrapper's
   * share_balance. Claimable yield uses YT's preview_claim_yield, which reads
   * the holder's real YT balance and the SY exchange rate itself (no caller
   * supplied rate), and returns the claimable amount in SY shares. LP balance
   * comes from the AMM's per-holder accounting.
   */
  async getPosition(holder: string, marketId: string): Promise<Position> {
    const sy = new Contract(this.contracts.sy);
    const tokenizer = new Contract(this.contracts.tokenizer);
    const market = new Contract(this.contracts.market);
    const holderScVal = new Address(holder).toScVal();

    const [syBalance, position, lpBalance] = await Promise.all([
      this.simulateRead<bigint>(sy.call("share_balance", holderScVal)),
      this.simulateRead<{ pt_balance: bigint; yt_balance: bigint }>(
        tokenizer.call("position", holderScVal),
      ),
      this.simulateRead<bigint>(market.call("lp_balance", holderScVal)),
    ]);

    const ptBalance = position.pt_balance;
    const ytBalance = position.yt_balance;

    // preview_claim_yield rejects a non-positive YT balance, so short-circuit.
    const claimableYield =
      ytBalance > 0n
        ? await this.simulateRead<bigint>(
            new Contract(this.contracts.yt).call("preview_claim_yield", holderScVal),
          )
        : 0n;

    return {
      holder,
      marketId,
      syBalance,
      ptBalance,
      ytBalance,
      claimableYield,
      lpBalance,
    };
  }

  /**
   * Builds a claim transaction. The tokenizer settles the holder's accrued YT
   * yield and pays it in SY out of escrow. Reverts (Insolvent) if the rate has
   * regressed below PT coverage, which leaves the holder's banked yield intact.
   */
  async buildClaimYield(args: ClaimArgs): Promise<TransactionEnvelope> {
    const op = new Contract(this.contracts.tokenizer).call(
      "claim_yield",
      new Address(args.from).toScVal(),
    );
    return this.buildEnvelope(args.from, [op]);
  }

  // --- transaction builders (return unsigned envelopes) --------------------

  /**
   * Builds a single SY deposit transaction (one host-function op).
   *
   * Deposit and split must be separate transactions: a Soroban transaction
   * carries exactly one InvokeHostFunction op, so they cannot be batched. The
   * UI deposits first, waits for confirmation, then calls `buildSplit` with the
   * exact SY the deposit minted.
   */
  async buildDeposit(args: MintArgs): Promise<TransactionEnvelope> {
    requirePositive("underlyingAmount", args.underlyingAmount);
    const from = new Address(args.from).toScVal();
    const amount = nativeToScVal(args.underlyingAmount, { type: "i128" });
    const depositOp = new Contract(this.contracts.sy).call("deposit", from, amount);
    return this.buildEnvelope(args.from, [depositOp]);
  }

  /**
   * Builds a single tokenizer split transaction (one host-function op) for an
   * exact SY amount. The tokenizer pulls `syAmount` SY and mints
   * `syAmount * rate / WAD` of PT and YT. Build this only after the deposit it
   * depends on has confirmed, so the holder's SY balance covers `syAmount`.
   */
  async buildSplit(args: SplitArgs): Promise<TransactionEnvelope> {
    requirePositive("syAmount", args.syAmount);
    const splitOp = new Contract(this.contracts.tokenizer).call(
      "split",
      new Address(args.from).toScVal(),
      nativeToScVal(args.syAmount, { type: "i128" }),
    );
    return this.buildEnvelope(args.from, [splitOp]);
  }

  /** Builds a swap transaction matching the frozen Market trait routes. */
  async buildSwap(args: SwapArgs): Promise<TransactionEnvelope> {
    requirePositive("amountIn", args.amountIn);
    return this.buildEnvelope(args.from, [this.swapOperation(args)]);
  }

  /**
   * Builds a redeem transaction. After maturity, redeems `amount` PT 1:1 for SY
   * via redeem_at_maturity. Before maturity, recombines `amount` PT + `amount`
   * YT back into SY via recombine (the tokenizer requires pt == yt).
   */
  async buildRedeem(args: RedeemArgs): Promise<TransactionEnvelope> {
    requirePositive("amount", args.amount);
    const from = new Address(args.from).toScVal();
    const amount = nativeToScVal(args.amount, { type: "i128" });
    const tokenizer = new Contract(this.contracts.tokenizer);

    const matured = await this.simulateRead<boolean>(tokenizer.call("is_matured"));
    const op = matured
      ? tokenizer.call("redeem_at_maturity", from, amount)
      : tokenizer.call("recombine", from, amount, amount);
    return this.buildEnvelope(args.from, [op]);
  }

  /** Burns SY shares and returns the corresponding underlying from the vault. */
  async buildRedeemSy(args: RedeemSyArgs): Promise<TransactionEnvelope> {
    requirePositive("syAmount", args.syAmount);
    const op = new Contract(this.contracts.sy).call(
      "redeem",
      new Address(args.from).toScVal(),
      nativeToScVal(args.syAmount, { type: "i128" }),
    );
    return this.buildEnvelope(args.from, [op]);
  }

  /** Builds a transaction that adds PT/SY liquidity and mints LP tokens. */
  async buildAddLiquidity(args: AddLiquidityArgs): Promise<TransactionEnvelope> {
    requirePositive("ptIn", args.ptIn);
    requirePositive("syIn", args.syIn);
    const op = new Contract(this.contracts.market).call(
      "add_liquidity",
      new Address(args.from).toScVal(),
      nativeToScVal(args.ptIn, { type: "i128" }),
      nativeToScVal(args.syIn, { type: "i128" }),
    );
    return this.buildEnvelope(args.from, [op]);
  }

  /** Builds a transaction that burns LP tokens and withdraws PT and SY. */
  async buildRemoveLiquidity(args: RemoveLiquidityArgs): Promise<TransactionEnvelope> {
    requirePositive("lpIn", args.lpIn);
    const op = new Contract(this.contracts.market).call(
      "remove_liquidity",
      new Address(args.from).toScVal(),
      nativeToScVal(args.lpIn, { type: "i128" }),
    );
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

    // The transaction-result store can report SUCCESS before the account-state
    // view catches up to the consumed sequence. A follow-up build in the same
    // flow (e.g. split right after deposit) calls getAccount and would read a
    // stale sequence, then fail on submit with txBadSeq. Wait until getAccount
    // reflects this transaction's sequence before returning, so the next build
    // picks up the advanced value.
    const consumed = tx as unknown as {
      source?: string;
      _source?: string;
      sequence?: string;
      _sequence?: string;
    };
    const consumedSource = consumed.source ?? consumed._source;
    const envelopeSource = StellarYT.envelopeSource(tx);
    const consumedSequence =
      consumed.sequence ?? consumed._sequence ?? StellarYT.envelopeSequence(tx);
    StellarYT.rememberSequence(consumedSource, consumedSequence);
    StellarYT.rememberSequence(envelopeSource, consumedSequence);
    await this.waitForSequence(envelopeSource ?? consumedSource, consumedSequence);

    return { hash: sent.hash, status: result.status };
  }

  /**
   * Polls getAccount until the source account's on-chain sequence has reached
   * `sequence` (the value the just-confirmed transaction consumed). Best effort:
   * returns once the sequence is observed or a short deadline passes, so a
   * lagging RPC view cannot make the next sequential build reuse a stale number.
   */
  private async waitForSequence(source?: string, sequence?: string): Promise<void> {
    if (!source || !sequence) return;
    const target = BigInt(sequence);
    const deadline = Date.now() + 30_000;
    let observed = 0;
    while (Date.now() < deadline) {
      const account = await this.server.getAccount(source).catch(() => null);
      if (account !== null && BigInt(account.sequenceNumber()) >= target) {
        observed += 1;
        if (observed >= 2) return;
      } else {
        observed = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private static rememberSequence(source?: string, sequence?: string): void {
    if (!source || !sequence) return;
    const target = BigInt(sequence);
    const current = StellarYT.sequenceFloorBySource.get(source);
    if (current === undefined || target > current) {
      StellarYT.sequenceFloorBySource.set(source, target);
    }
  }

  private static applySequenceFloor(source: SourceAccount): void {
    const floor = StellarYT.sequenceFloorBySource.get(source.accountId());
    if (floor === undefined) return;
    while (BigInt(source.sequenceNumber()) < floor) {
      source.incrementSequenceNumber();
    }
  }

  private static envelopeSource(tx: SubmittedTransaction): string | undefined {
    try {
      const source = tx.toEnvelope().v1().tx().sourceAccount();
      if (source.switch().name === "keyTypeEd25519") {
        return StrKey.encodeEd25519PublicKey(source.ed25519());
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private static envelopeSequence(tx: SubmittedTransaction): string | undefined {
    try {
      return tx.toEnvelope().v1().tx().seqNum().toString();
    } catch {
      return undefined;
    }
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
    // Soroban simulations require a funded G-account for the transaction
    // source. A contract C-address is not an account and RPC rejects it. The
    // caller supplies the connected wallet when available, or a public funded
    // fallback account for reads before a wallet is connected. This address is
    // never used to sign or submit a transaction.
    const source = await this.server.getAccount(this.simulationSourceAccount).catch(() => null);
    if (source === null) {
      throw new Error(
        `cannot simulate: source account not found on RPC: ${this.simulationSourceAccount}`,
      );
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
      throw new ContractError(sim.error, parseContractErrorCode(sim.error));
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
    StellarYT.applySequenceFloor(source);
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
