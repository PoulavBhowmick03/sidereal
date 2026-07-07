// SPDX-License-Identifier: Apache-2.0

import {
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  nativeToScVal,
  Address,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  AddLiquidityArgs,
  BlendWithdrawArgs,
  ContractAddresses,
  LpPosition,
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
import {
  BLEND_REQUEST_WITHDRAW,
  BLEND_REQUEST_WITHDRAW_COLLATERAL,
  BLEND_RESERVE_TOKEN_LIABILITY,
  BLEND_RESERVE_TOKEN_SUPPLY,
  blendReserveTokenIndex,
  blendPositionFor,
  blendRates,
  encodeBlendRequest,
  decodeBlendPositions,
  decodeBlendReserve,
  decodeBlendReserveEmission,
  type BlendPosition,
  type BlendRates,
  type BlendReserveEmissionScan,
} from "./blend.js";

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
 * Encodes and decodes ScVal values, quotes swaps by simulating against the AMM,
 * and builds unsigned transaction envelopes for a wallet to sign. This client
 * never signs and never holds keys.
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

    // twap_apy() is the internal TWAP, spot_apy() is the single-block view, and
    // reserve_pt/reserve_sy are the pool balances. APY reads return zero at or
    // after maturity.
    const [
      exchangeRate,
      twapApyBps,
      spotApyBps,
      twapWarmingUp,
      maturity,
      underlying,
      totalPt,
      totalSy,
      totalLp,
      config,
    ] = await Promise.all([
      this.simulateRead<bigint>(sy.call("exchange_rate")),
      this.simulateRead<bigint>(market.call("twap_apy")),
      this.simulateRead<bigint>(market.call("spot_apy")),
      this.simulateRead<boolean>(market.call("twap_warming_up")),
      this.simulateRead<bigint>(market.call("maturity")),
      this.simulateRead<string>(sy.call("underlying")),
      this.simulateRead<bigint>(market.call("reserve_pt")),
      this.simulateRead<bigint>(market.call("reserve_sy")),
      this.simulateRead<bigint>(market.call("total_lp")),
      this.simulateRead<{ fee_bps: bigint | number }>(market.call("config")),
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
      totalLp,
      feeBps: BigInt(config.fee_bps),
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

    // Always read preview_claim_yield. It returns banked yield plus what a
    // settle at the current rate would add, and banked yield survives a zero YT
    // balance: a holder can bank yield (a transfer settles them) and then send
    // or recombine away all their YT while still being owed SY. A YT-balance
    // short-circuit would report that owed SY as zero even though a claim would
    // pay out. pending_yield contributes zero at a zero balance, so the read is
    // safe to make unconditionally.
    const claimableYield = await this.simulateRead<bigint>(
      new Contract(this.contracts.yt).call("preview_claim_yield", holderScVal),
    );

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
   * Reads a holder's LP balance plus the pro-rata PT/SY claim represented by
   * that LP. Payout math matches remove_liquidity: floor against current pool
   * reserves, zero when the pool has no LP supply.
   */
  async getLpPosition(holder: string, marketId: string): Promise<LpPosition> {
    const market = new Contract(this.contracts.market);
    const holderScVal = new Address(holder).toScVal();

    const [marketState, lpBalance] = await Promise.all([
      this.getMarket(marketId),
      this.simulateRead<bigint>(market.call("lp_balance", holderScVal)),
    ]);

    const totalLp = marketState.totalLp;
    const shareBps = totalLp > 0n ? (lpBalance * BPS_DENOMINATOR) / totalLp : 0n;
    const ptValue = totalLp > 0n ? (lpBalance * marketState.totalPt) / totalLp : 0n;
    const syValue = totalLp > 0n ? (lpBalance * marketState.totalSy) / totalLp : 0n;

    return {
      holder,
      marketId,
      lpBalance,
      totalLp,
      shareBps,
      ptValue,
      syValue,
    };
  }

  /** Reads a SEP-41/SAC token balance for a holder. Used for wallet-visible assets. */
  async getTokenBalance(tokenContract: string, holder: string): Promise<bigint> {
    return this.simulateRead<bigint>(
      new Contract(tokenContract).call("balance", new Address(holder).toScVal()),
    );
  }

  /**
   * Reads a Blend v2 reserve's live rate curve: utilization, borrow APR, and
   * the supply APR a depositor earns right now. This is the variable rate the
   * SY wrapper's derived exchange rate tracks, shown next to the AMM's implied
   * fixed APY so a user can see what they are locking in against.
   */
  async getBlendRates(pool: string, asset: string): Promise<BlendRates> {
    const poolContract = new Contract(pool);
    const [reserveRaw, poolConfig] = await Promise.all([
      this.simulateRead<Parameters<typeof decodeBlendReserve>[0]>(
        poolContract.call("get_reserve", new Address(asset).toScVal()),
      ),
      this.simulateRead<{ bstop_rate: number }>(poolContract.call("get_config")),
    ]);
    return blendRates(decodeBlendReserve(reserveRaw), BigInt(poolConfig.bstop_rate));
  }

  /**
   * Reads reserve-token emission slots for a Blend reserve. The pool identifies
   * liabilities as `reserve_index * 2` and supply/collateral bTokens as
   * `reserve_index * 2 + 1`. Use this to verify whether a wrapper supplier can
   * earn BLND before building reward-passthrough contracts.
   */
  async getBlendReserveEmissionScan(
    pool: string,
    asset: string,
    slotCount = 8,
  ): Promise<BlendReserveEmissionScan> {
    const poolContract = new Contract(pool);
    const reserveRaw = await this.simulateRead<Parameters<typeof decodeBlendReserve>[0]>(
      poolContract.call("get_reserve", new Address(asset).toScVal()),
    );
    const reserve = decodeBlendReserve(reserveRaw);
    const liabilityTokenIndex = blendReserveTokenIndex(
      reserve.config.index,
      BLEND_RESERVE_TOKEN_LIABILITY,
    );
    const supplyTokenIndex = blendReserveTokenIndex(
      reserve.config.index,
      BLEND_RESERVE_TOKEN_SUPPLY,
    );
    const effectiveSlotCount = Math.max(slotCount, supplyTokenIndex + 1);
    const slots = await Promise.all(
      Array.from({ length: effectiveSlotCount }, async (_unused, reserveTokenIndex) => ({
        reserveTokenIndex,
        emission: decodeBlendReserveEmission(
          await this.simulateRead<Parameters<typeof decodeBlendReserveEmission>[0]>(
            poolContract.call(
              "get_reserve_emissions",
              nativeToScVal(reserveTokenIndex, { type: "u32" }),
            ),
          ),
        ),
      })),
    );

    return {
      reserve,
      liabilityTokenIndex,
      supplyTokenIndex,
      liability: slots[liabilityTokenIndex]?.emission ?? null,
      supply: slots[supplyTokenIndex]?.emission ?? null,
      slots,
    };
  }

  /**
   * Reads a holder's existing position in a Blend reserve, valued at the
   * current interest indexes. This is how a Blend lender sees the deposit
   * they could tokenize: supply and collateral bTokens both earn b_rate, but
   * they migrate with different withdraw request types, so both are reported.
   */
  async getBlendPosition(pool: string, asset: string, holder: string): Promise<BlendPosition> {
    const poolContract = new Contract(pool);
    const [reserveRaw, positionsRaw] = await Promise.all([
      this.simulateRead<Parameters<typeof decodeBlendReserve>[0]>(
        poolContract.call("get_reserve", new Address(asset).toScVal()),
      ),
      this.simulateRead<Parameters<typeof decodeBlendPositions>[0]>(
        poolContract.call("get_positions", new Address(holder).toScVal()),
      ),
    ]);
    return blendPositionFor(decodeBlendReserve(reserveRaw), decodeBlendPositions(positionsRaw));
  }

  /**
   * Builds a claim transaction. The tokenizer settles the holder's accrued YT
   * yield and pays it in SY out of escrow. It does not gate on escrow coverage:
   * the YT settle math pays zero when the rate has not risen past the holder's
   * checkpoint, and a genuine shortfall is priced pro-rata at redemption rather
   * than blocking the claim, so a claim no longer reverts under a rate
   * regression.
   *
   * The contract deliberately has no owed>0 guard, so a zero-value claim would
   * land on chain and burn fees for nothing. We guard against that here with a
   * network read: preview_claim_yield reads the holder's real YT balance and the
   * SY rate itself (no caller-supplied rate) and returns the claimable SY shares,
   * so if it is not positive we refuse to build rather than return a fee-burning
   * envelope. This matches the SDK's other read-then-build guards (buildRedeem
   * reads is_matured before choosing the route) and the input-guard error style
   * (a plain Error with a clear message, like buildBlendWithdraw's empty case).
   */
  async buildClaimYield(args: ClaimArgs): Promise<TransactionEnvelope> {
    const claimable = await this.simulateRead<bigint>(
      new Contract(this.contracts.yt).call(
        "preview_claim_yield",
        new Address(args.from).toScVal(),
      ),
    );
    if (claimable <= 0n) {
      throw new Error("nothing to claim: previewed yield is zero");
    }
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

  /**
   * Builds a user-signed withdraw from a Blend pool, the first step of
   * migrating an existing Blend deposit into the protocol (Blend bTokens are
   * not transferable, so a position moves by withdraw-then-deposit). Liquid
   * supply and posted collateral are separate buckets with separate request
   * types; both can be drained in one transaction. The pool clamps each
   * request to the holder's actual balance, and a withdraw can return less
   * than requested when pool liquidity is tight, so the follow-up deposit must
   * be sized from the wallet balance after this confirms, not from the request.
   */
  async buildBlendWithdraw(args: BlendWithdrawArgs): Promise<TransactionEnvelope> {
    const requests: xdr.ScVal[] = [];
    if (args.supplyAmount > 0n) {
      requests.push(encodeBlendRequest(args.asset, BLEND_REQUEST_WITHDRAW, args.supplyAmount));
    }
    if (args.collateralAmount > 0n) {
      requests.push(
        encodeBlendRequest(args.asset, BLEND_REQUEST_WITHDRAW_COLLATERAL, args.collateralAmount),
      );
    }
    if (requests.length === 0) {
      throw new Error("nothing to withdraw: both bucket amounts are zero");
    }
    const from = new Address(args.from).toScVal();
    const op = new Contract(args.pool).call(
      "submit",
      from,
      from,
      from,
      xdr.ScVal.scvVec(requests),
    );
    return this.buildEnvelope(args.from, [op]);
  }

  /**
   * Builds a transaction that adds PT/SY liquidity and mints LP tokens.
   *
   * Argument order matches the AMM entrypoint
   * `add_liquidity(from, pt_in, sy_in, min_lp_out)`: min_lp_out comes after
   * sy_in. The bound is caller-supplied and must be a slippage-adjusted value
   * from a preview (the SDK does not compute a default); the AMM reverts the
   * entire invocation with SlippageExceeded if the LP minted is below it.
   */
  async buildAddLiquidity(args: AddLiquidityArgs): Promise<TransactionEnvelope> {
    requirePositive("ptIn", args.ptIn);
    requirePositive("syIn", args.syIn);
    const op = new Contract(this.contracts.market).call(
      "add_liquidity",
      new Address(args.from).toScVal(),
      nativeToScVal(args.ptIn, { type: "i128" }),
      nativeToScVal(args.syIn, { type: "i128" }),
      nativeToScVal(args.minLpOut, { type: "i128" }),
    );
    return this.buildEnvelope(args.from, [op]);
  }

  /**
   * Builds a transaction that burns LP tokens and withdraws PT and SY.
   *
   * Argument order matches the AMM entrypoint
   * `remove_liquidity(from, lp_in, min_pt_out, min_sy_out)`: min_pt_out then
   * min_sy_out come after lp_in. Both bounds are caller-supplied slippage-adjusted
   * values from a preview; a violation on either leg reverts the whole invocation
   * with SlippageExceeded.
   */
  async buildRemoveLiquidity(args: RemoveLiquidityArgs): Promise<TransactionEnvelope> {
    requirePositive("lpIn", args.lpIn);
    const op = new Contract(this.contracts.market).call(
      "remove_liquidity",
      new Address(args.from).toScVal(),
      nativeToScVal(args.lpIn, { type: "i128" }),
      nativeToScVal(args.minPtOut, { type: "i128" }),
      nativeToScVal(args.minSyOut, { type: "i128" }),
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
