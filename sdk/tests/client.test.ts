// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, vi } from "vitest";

// A controllable fake of @stellar/stellar-sdk. Operations carry the method name
// and args so the mock RPC can route return values and the tests can assert
// which contract call the client made. State lives on globalThis so tests can
// drive it without import gymnastics through the hoisted factory.
vi.mock("@stellar/stellar-sdk", () => {
  const fromUrl = <T>(map: Record<string, T>, url: string, fallback: T): T =>
    Object.prototype.hasOwnProperty.call(map, url) ? map[url]! : fallback;

  const state = {
    returns: {} as Record<string, unknown>,
    returnsByUrl: {} as Record<string, Record<string, unknown>>,
    simulationError: null as string | null,
    simulationErrorByUrl: {} as Record<string, string | null>,
    simulateThrowByUrl: {} as Record<string, string>,
    accountExists: true,
    accountExistsByUrl: {} as Record<string, boolean>,
    accountSequenceByUrl: {} as Record<string, string>,
    sendStatus: "PENDING" as string,
    sendStatusByUrl: {} as Record<string, string>,
    sendHash: "txhash123",
    sendErrorByUrl: {} as Record<string, string>,
    getTxStatus: "SUCCESS" as string,
    getTxStatusByUrl: {} as Record<string, string>,
    getTxErrorByUrl: {} as Record<string, string>,
    prepareErrorByUrl: {} as Record<string, string>,
    calls: [] as Array<{ method: string; args: unknown[] }>,
    accountRequests: [] as string[],
    accountRequestLog: [] as Array<{ url: string; account: string }>,
    sendRequests: [] as string[],
    getTransactionRequests: [] as string[],
  };
  (globalThis as Record<string, unknown>).__sdkMock = state;

  class Contract {
    constructor(public address: string) {}
    call(method: string, ...args: unknown[]) {
      return { __op: true, contract: this.address, method, args };
    }
  }
  class Address {
    constructor(public addr: string) {}
    toScVal() {
      return { __scAddress: this.addr };
    }
  }
  const nativeToScVal = (v: unknown, opts?: { type?: string }) => ({ __sc: v, type: opts?.type });
  const scValToNative = (v: unknown) => v;

  class TransactionBuilder {
    ops: Array<{ method: string; args: unknown[] }> = [];
    constructor(
      public source: unknown,
      public opts: unknown,
    ) {}
    addOperation(op: { method: string; args: unknown[] }) {
      this.ops.push(op);
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { ops: this.ops };
    }
    static fromXDR(xdr: string) {
      return {
        __tx: xdr,
        ops: [] as Array<{ method: string; args: unknown[] }>,
        source: "GSIGNERSOURCE",
        sequence: "1",
      };
    }
  }

  const Api = {
    isSimulationError: (sim: { error?: unknown }) => sim != null && "error" in sim,
    GetTransactionStatus: { SUCCESS: "SUCCESS", NOT_FOUND: "NOT_FOUND", FAILED: "FAILED" },
  };

  class Server {
    constructor(
      public url: string,
      public opts?: unknown,
    ) {}
    async getAccount(addr: string) {
      state.accountRequests.push(addr);
      state.accountRequestLog.push({ url: this.url, account: addr });
      if (!fromUrl(state.accountExistsByUrl, this.url, state.accountExists)) {
        throw new Error("account not found");
      }
      let sequence = fromUrl(state.accountSequenceByUrl, this.url, "1");
      return {
        accountId: () => addr,
        sequenceNumber: () => sequence,
        incrementSequenceNumber: () => {
          sequence = (BigInt(sequence) + 1n).toString();
        },
      };
    }
    async simulateTransaction(tx: { ops: Array<{ method: string; args: unknown[] }> }) {
      const op = tx.ops[0]!;
      state.calls.push({ method: op.method, args: op.args });
      const simulateThrow = state.simulateThrowByUrl[this.url];
      if (simulateThrow) throw new Error(simulateThrow);
      const simulationError = fromUrl(
        state.simulationErrorByUrl,
        this.url,
        state.simulationError,
      );
      if (simulationError) return { error: simulationError };
      const perUrlReturns = state.returnsByUrl[this.url] ?? {};
      const value = Object.prototype.hasOwnProperty.call(perUrlReturns, op.method)
        ? perUrlReturns[op.method]
        : state.returns[op.method];
      return { result: { retval: Array.isArray(value) ? value.shift() : value } };
    }
    async prepareTransaction(tx: { ops: Array<{ method: string; args: unknown[] }> }) {
      const prepareError = state.prepareErrorByUrl[this.url];
      if (prepareError) throw new Error(prepareError);
      for (const op of tx.ops) state.calls.push({ method: op.method, args: op.args });
      return { toXDR: () => "PREPARED:" + tx.ops.map((o) => o.method).join("+") };
    }
    async sendTransaction() {
      state.sendRequests.push(this.url);
      const sendError = state.sendErrorByUrl[this.url];
      if (sendError) throw new Error(sendError);
      return {
        status: fromUrl(state.sendStatusByUrl, this.url, state.sendStatus),
        hash: state.sendHash,
        errorResult: { code: "x" },
      };
    }
    async getTransaction() {
      state.getTransactionRequests.push(this.url);
      const getTxError = state.getTxErrorByUrl[this.url];
      if (getTxError) throw new Error(getTxError);
      return { status: fromUrl(state.getTxStatusByUrl, this.url, state.getTxStatus) };
    }
  }

  const xdr = { ScVal: { scvVec: (items: unknown[]) => ({ __scVec: items }) } };

  return { Contract, Address, nativeToScVal, scValToNative, TransactionBuilder, rpc: { Server, Api }, xdr };
});

import { StellarYT } from "../src/index.js";

type MockState = {
  returns: Record<string, unknown>;
  returnsByUrl: Record<string, Record<string, unknown>>;
  simulationError: string | null;
  simulationErrorByUrl: Record<string, string | null>;
  simulateThrowByUrl: Record<string, string>;
  accountExists: boolean;
  accountExistsByUrl: Record<string, boolean>;
  accountSequenceByUrl: Record<string, string>;
  sendStatus: string;
  sendStatusByUrl: Record<string, string>;
  sendHash: string;
  sendErrorByUrl: Record<string, string>;
  getTxStatus: string;
  getTxStatusByUrl: Record<string, string>;
  getTxErrorByUrl: Record<string, string>;
  prepareErrorByUrl: Record<string, string>;
  calls: Array<{ method: string; args: unknown[] }>;
  accountRequests: string[];
  accountRequestLog: Array<{ url: string; account: string }>;
  sendRequests: string[];
  getTransactionRequests: string[];
};

const state = () => (globalThis as Record<string, unknown>).__sdkMock as MockState;

const contracts = { sy: "SY", pt: "PT", yt: "YT", tokenizer: "TK", market: "AMM" };
const simulationSourceAccount = "GSIMULATIONSOURCE";

function newClient(
  overrides: Partial<{
    rpcUrl: string;
    rpcFallbackUrls: string[];
  }> = {},
) {
  return new StellarYT({
    rpcUrl: overrides.rpcUrl ?? "http://localhost:8000",
    rpcFallbackUrls: overrides.rpcFallbackUrls,
    networkPassphrase: "Test SDF Network ; September 2015",
    simulationSourceAccount,
    contracts,
  });
}

beforeEach(() => {
  const s = state();
  s.returns = {};
  s.returnsByUrl = {};
  s.simulationError = null;
  s.simulationErrorByUrl = {};
  s.simulateThrowByUrl = {};
  s.accountExists = true;
  s.accountExistsByUrl = {};
  s.accountSequenceByUrl = {};
  s.sendStatus = "PENDING";
  s.sendStatusByUrl = {};
  s.sendHash = "txhash123";
  s.sendErrorByUrl = {};
  s.getTxStatus = "SUCCESS";
  s.getTxStatusByUrl = {};
  s.getTxErrorByUrl = {};
  s.prepareErrorByUrl = {};
  s.calls = [];
  s.accountRequests = [];
  s.accountRequestLog = [];
  s.sendRequests = [];
  s.getTransactionRequests = [];
});

describe("getMarket", () => {
  it("maps the AMM and SY accessors into market state", async () => {
    state().returns = {
      exchange_rate: 1_000_000_000_000_000_000n,
      twap_apy: 860n,
      spot_apy: 875n,
      twap_warming_up: false,
      maturity: 2_000_000_000n,
      underlying: "USDC",
      reserve_pt: 500n,
      reserve_sy: 700n,
      total_lp: 1_000n,
      config: { fee_bps: 10n },
    };
    const m = await newClient().getMarket("mkt");
    expect(m.impliedApyBps).toBe(860n);
    expect(m.spotApyBps).toBe(875n);
    expect(m.twapWarmingUp).toBe(false);
    expect(m.underlying).toBe("USDC");
    expect(m.totalPt).toBe(500n);
    expect(m.totalSy).toBe(700n);
    expect(m.totalLp).toBe(1_000n);
    expect(m.feeBps).toBe(10n);
    expect(m.maturity).toBe(2_000_000_000);
  });

  it("rejects with a typed ContractError carrying the contract code", async () => {
    state().simulationError = "HostError: Error(Contract, #10) market matured";
    await expect(newClient().getMarket("mkt")).rejects.toMatchObject({
      name: "ContractError",
      code: 10,
    });
  });

  it("rejects when the source account is missing", async () => {
    state().accountExists = false;
    await expect(newClient().getMarket("mkt")).rejects.toThrow(/source account not found/);
  });

  it("uses the configured funded account instead of the market contract", async () => {
    state().returns = {
      exchange_rate: 1_000_000_000_000_000_000n,
      twap_apy: 860n,
      spot_apy: 875n,
      twap_warming_up: false,
      maturity: 2_000_000_000n,
      underlying: "USDC",
      reserve_pt: 500n,
      reserve_sy: 700n,
      total_lp: 1_000n,
      config: { fee_bps: 10n },
    };

    await newClient().getMarket("mkt");

    expect(state().accountRequests).not.toContain(contracts.market);
    expect(state().accountRequests).toHaveLength(1);
    expect(state().accountRequests.every((account) => account === simulationSourceAccount)).toBe(
      true,
    );
  });

  it("fails over to a secondary RPC when the primary cannot simulate", async () => {
    state().simulateThrowByUrl["http://localhost:8000"] = "fetch failed";
    state().returnsByUrl["http://localhost:8001"] = {
      exchange_rate: 1_000_000_000_000_000_000n,
      twap_apy: 860n,
      spot_apy: 875n,
      twap_warming_up: false,
      maturity: 2_000_000_000n,
      underlying: "USDC",
      reserve_pt: 500n,
      reserve_sy: 700n,
      total_lp: 1_000n,
      config: { fee_bps: 10n },
    };

    const market = await newClient({ rpcFallbackUrls: ["http://localhost:8001"] }).getMarket("mkt");

    expect(market.underlying).toBe("USDC");
    expect(state().accountRequestLog.some((entry) => entry.url === "http://localhost:8001")).toBe(
      true,
    );
  });
});

describe("quoteSwap", () => {
  it("calls the matching quote accessor and computes price impact", async () => {
    state().returns = { quote_sy_for_pt: 95n, twap_apy: 500n };
    const q = await newClient().quoteSwap({
      marketId: "mkt",
      from: "G1",
      assetIn: "SY",
      assetOut: "PT",
      amountIn: 100n,
      minAmountOut: 0n,
    });
    expect(q.amountOut).toBe(95n);
    expect(q.priceImpactBps).toBe(500n); // (100-95)/100 = 5% = 500bps
    expect(q.impliedApyBps).toBe(500n);
    expect(state().calls.some((c) => c.method === "quote_sy_for_pt")).toBe(true);
  });

  it("rejects an unsupported route before touching the network", async () => {
    await expect(
      newClient().quoteSwap({
        marketId: "mkt",
        from: "G1",
        assetIn: "SY",
        assetOut: "SY",
        amountIn: 100n,
        minAmountOut: 0n,
      }),
    ).rejects.toThrow(/unsupported swap route/);
  });
});

describe("getPosition", () => {
  it("reads SY balance, position, claimable yield, and LP balance", async () => {
    state().returns = {
      share_balance: 50n,
      position: { pt_balance: 10n, yt_balance: 20n },
      lp_balance: 3n,
      preview_claim_yield: 7n,
    };
    const p = await newClient().getPosition("G1", "mkt");
    expect(p.syBalance).toBe(50n);
    expect(p.ptBalance).toBe(10n);
    expect(p.ytBalance).toBe(20n);
    expect(p.claimableYield).toBe(7n);
    expect(p.lpBalance).toBe(3n);
    // preview_claim_yield is called with the holder only, no rate argument.
    const preview = state().calls.find((c) => c.method === "preview_claim_yield");
    expect(preview?.args).toHaveLength(1);
  });

  it("reads banked yield even when YT balance is zero", async () => {
    state().returns = {
      share_balance: 0n,
      position: { pt_balance: 0n, yt_balance: 0n },
      lp_balance: 0n,
      preview_claim_yield: 11n,
    };
    const p = await newClient().getPosition("G1", "mkt");
    expect(p.claimableYield).toBe(11n);
    expect(state().calls.some((c) => c.method === "preview_claim_yield")).toBe(true);
  });

  it("returns the YT preview result when zero YT has no banked yield", async () => {
    state().returns = {
      share_balance: 0n,
      position: { pt_balance: 0n, yt_balance: 0n },
      lp_balance: 0n,
      preview_claim_yield: 0n,
    };
    const p = await newClient().getPosition("G1", "mkt");
    expect(p.claimableYield).toBe(0n);
    expect(state().calls.some((c) => c.method === "preview_claim_yield")).toBe(true);
  });

  it("does not pass a caller-supplied rate to yield preview when YT is zero", async () => {
    state().returns = {
      share_balance: 0n,
      position: { pt_balance: 0n, yt_balance: 0n },
      lp_balance: 0n,
      preview_claim_yield: 5n,
    };
    await newClient().getPosition("G1", "mkt");
    const preview = state().calls.find((c) => c.method === "preview_claim_yield");
    expect(preview?.args).toHaveLength(1);
  });
});

describe("getLpPosition", () => {
  it("reads LP balance and derives pro-rata pool value", async () => {
    state().returns = {
      exchange_rate: 1_000_000_000_000_000_000n,
      twap_apy: 860n,
      spot_apy: 875n,
      twap_warming_up: false,
      maturity: 2_000_000_000n,
      underlying: "USDC",
      reserve_pt: 1_001n,
      reserve_sy: 2_003n,
      total_lp: 400n,
      config: { fee_bps: 10n },
      lp_balance: 123n,
    };

    const p = await newClient().getLpPosition("G1", "mkt");

    expect(p).toMatchObject({
      holder: "G1",
      marketId: "mkt",
      lpBalance: 123n,
      totalLp: 400n,
      shareBps: 3_075n,
      ptValue: 307n,
      syValue: 615n,
    });
    expect(state().calls.some((c) => c.method === "lp_balance")).toBe(true);
  });

  it("returns zero share and value for an unseeded pool", async () => {
    state().returns = {
      exchange_rate: 1_000_000_000_000_000_000n,
      twap_apy: 0n,
      spot_apy: 0n,
      twap_warming_up: false,
      maturity: 2_000_000_000n,
      underlying: "USDC",
      reserve_pt: 0n,
      reserve_sy: 0n,
      total_lp: 0n,
      config: { fee_bps: 10n },
      lp_balance: 0n,
    };

    const p = await newClient().getLpPosition("G1", "mkt");

    expect(p.shareBps).toBe(0n);
    expect(p.ptValue).toBe(0n);
    expect(p.syValue).toBe(0n);
  });
});

describe("getBlendReserveEmissionScan", () => {
  it("scans reserve emissions and identifies liability and supply slots", async () => {
    state().returns = {
      get_reserve: {
        asset: "USDC",
        config: {
          index: 3,
          decimals: 7,
          util: 7_000_000,
          max_util: 9_500_000,
          r_base: 5_000,
          r_one: 300_000,
          r_two: 1_000_000,
          r_three: 10_000_000,
        },
        data: {
          b_rate: 1_000_000_000_000n,
          b_supply: 0n,
          d_rate: 1_000_000_000_000n,
          d_supply: 0n,
          ir_mod: 1_000_000n,
          last_time: 0n,
        },
      },
      get_reserve_emissions: [
        null,
        null,
        null,
        null,
        null,
        null,
        { expiration: 9n, eps: 7n, index: 5n, last_time: 3n },
        null,
      ],
    };

    const scan = await newClient().getBlendReserveEmissionScan("POOL", "USDC", 8);

    expect(scan.reserve.config.index).toBe(3);
    expect(scan.liabilityTokenIndex).toBe(6);
    expect(scan.supplyTokenIndex).toBe(7);
    expect(scan.liability).toMatchObject({ eps: 7n, expiration: 9n });
    expect(scan.supply).toBeNull();
    expect(scan.slots).toHaveLength(8);
    expect(state().calls.filter((c) => c.method === "get_reserve_emissions")).toHaveLength(8);
  });
});

describe("transaction builders", () => {
  it("buildDeposit builds a single deposit op", async () => {
    const env = await newClient().buildDeposit({
      marketId: "mkt",
      from: "G1",
      underlyingAmount: 100n,
    });
    // One host-function op per Soroban tx: deposit and split cannot be batched.
    expect(env.xdr).toBe("PREPARED:deposit");
    expect(env.networkPassphrase).toContain("Test SDF");
  });

  it("buildDeposit falls back when the primary RPC cannot prepare the tx", async () => {
    state().prepareErrorByUrl["http://localhost:8000"] = "503 service unavailable";

    const env = await newClient({ rpcFallbackUrls: ["http://localhost:8001"] }).buildDeposit({
      marketId: "mkt",
      from: "G1",
      underlyingAmount: 100n,
    });

    expect(env.xdr).toBe("PREPARED:deposit");
    expect(state().accountRequestLog.some((entry) => entry.url === "http://localhost:8001")).toBe(
      true,
    );
  });

  it("buildSplit builds a single split op", async () => {
    const env = await newClient().buildSplit({ from: "G1", syAmount: 100n });
    expect(env.xdr).toBe("PREPARED:split");
  });

  it("buildSwap routes through the matching Market method", async () => {
    const env = await newClient().buildSwap({
      marketId: "mkt",
      from: "G1",
      assetIn: "PT",
      assetOut: "SY",
      amountIn: 10n,
      minAmountOut: 1n,
    });
    expect(env.xdr).toBe("PREPARED:swap_pt_for_sy");
  });

  it("buildRedeem recombines before maturity and redeems after", async () => {
    state().returns = { is_matured: false };
    const pre = await newClient().buildRedeem({ marketId: "mkt", from: "G1", amount: 5n });
    expect(pre.xdr).toBe("PREPARED:recombine");

    state().returns = { is_matured: true };
    const post = await newClient().buildRedeem({ marketId: "mkt", from: "G1", amount: 5n });
    expect(post.xdr).toBe("PREPARED:redeem_at_maturity");
  });

  it("buildClaimYield targets the tokenizer claim_yield entrypoint", async () => {
    // The guard reads preview_claim_yield first; a positive preview lets it build.
    state().returns = { preview_claim_yield: 7n };
    const env = await newClient().buildClaimYield({ marketId: "mkt", from: "G1" });
    expect(env.xdr).toBe("PREPARED:claim_yield");
    const preview = state().calls.find((c) => c.method === "preview_claim_yield");
    expect(preview).toBeDefined();
  });

  it("buildClaimYield refuses to build a zero-value (fee-burning) claim", async () => {
    state().returns = { preview_claim_yield: 0n };
    await expect(
      newClient().buildClaimYield({ marketId: "mkt", from: "G1" }),
    ).rejects.toThrow(/nothing to claim/);
    // It must not fall through to building the tokenizer op.
    expect(state().calls.some((c) => c.method === "claim_yield")).toBe(false);
  });

  it("buildRedeemSy targets the SY wrapper redeem entrypoint", async () => {
    const env = await newClient().buildRedeemSy({
      marketId: "mkt",
      from: "G1",
      syAmount: 5n,
    });
    expect(env.xdr).toBe("PREPARED:redeem");
  });

  it("buildAddLiquidity and buildRemoveLiquidity hit the Market methods", async () => {
    const add = await newClient().buildAddLiquidity({
      marketId: "mkt",
      from: "G1",
      ptIn: 10n,
      syIn: 10n,
      minLpOut: 9n,
    });
    expect(add.xdr).toBe("PREPARED:add_liquidity");

    const remove = await newClient().buildRemoveLiquidity({
      marketId: "mkt",
      from: "G1",
      lpIn: 5n,
      minPtOut: 4n,
      minSyOut: 4n,
    });
    expect(remove.xdr).toBe("PREPARED:remove_liquidity");
  });

  it("passes the LP slippage bounds in the contract's positional order", async () => {
    await newClient().buildAddLiquidity({
      marketId: "mkt",
      from: "G1",
      ptIn: 10n,
      syIn: 20n,
      minLpOut: 9n,
    });
    // add_liquidity(from, pt_in, sy_in, min_lp_out)
    const add = state().calls.find((c) => c.method === "add_liquidity");
    expect(add?.args).toHaveLength(4);
    expect((add!.args[1] as { __sc: unknown }).__sc).toBe(10n);
    expect((add!.args[2] as { __sc: unknown }).__sc).toBe(20n);
    expect((add!.args[3] as { __sc: unknown }).__sc).toBe(9n);

    await newClient().buildRemoveLiquidity({
      marketId: "mkt",
      from: "G1",
      lpIn: 5n,
      minPtOut: 4n,
      minSyOut: 7n,
    });
    // remove_liquidity(from, lp_in, min_pt_out, min_sy_out)
    const remove = state().calls.find((c) => c.method === "remove_liquidity");
    expect(remove?.args).toHaveLength(4);
    expect((remove!.args[1] as { __sc: unknown }).__sc).toBe(5n);
    expect((remove!.args[2] as { __sc: unknown }).__sc).toBe(4n);
    expect((remove!.args[3] as { __sc: unknown }).__sc).toBe(7n);
  });

  it("rejects non-positive amounts before building", async () => {
    const c = newClient();
    await expect(c.buildDeposit({ marketId: "mkt", from: "G1", underlyingAmount: 0n })).rejects.toThrow(/positive/);
    await expect(c.buildSplit({ from: "G1", syAmount: 0n })).rejects.toThrow(/positive/);
    await expect(
      c.buildSwap({ marketId: "mkt", from: "G1", assetIn: "PT", assetOut: "SY", amountIn: -1n, minAmountOut: 0n }),
    ).rejects.toThrow(/positive/);
    await expect(c.buildRedeem({ marketId: "mkt", from: "G1", amount: 0n })).rejects.toThrow(/positive/);
    await expect(c.buildRedeemSy({ marketId: "mkt", from: "G1", syAmount: 0n })).rejects.toThrow(/positive/);
    await expect(c.buildRemoveLiquidity({ marketId: "mkt", from: "G1", lpIn: 0n })).rejects.toThrow(/positive/);
  });
});

describe("submit", () => {
  it("returns the hash once the transaction succeeds", async () => {
    state().sendStatus = "PENDING";
    state().getTxStatus = "SUCCESS";
    const res = await newClient().submit("SIGNEDXDR");
    expect(res.hash).toBe("txhash123");
    expect(res.status).toBe("SUCCESS");
  });

  it("throws when the network rejects the submission", async () => {
    state().sendStatus = "ERROR";
    await expect(newClient().submit("SIGNEDXDR")).rejects.toThrow(/submit rejected/);
  });

  it("waits for the account sequence to advance before returning", async () => {
    state().sendStatus = "PENDING";
    state().getTxStatus = "SUCCESS";
    await newClient().submit("SIGNEDXDR");
    // After confirmation it re-reads the signer account so a follow-up build
    // (e.g. split after deposit) cannot pick up a stale sequence (txBadSeq).
    expect(state().accountRequests).toContain("GSIGNERSOURCE");
  });

  it("submits on a fallback RPC when the primary send fails", async () => {
    state().sendErrorByUrl["http://localhost:8000"] = "fetch failed";
    state().sendStatusByUrl["http://localhost:8001"] = "PENDING";
    state().getTxStatusByUrl["http://localhost:8001"] = "SUCCESS";

    const res = await newClient({ rpcFallbackUrls: ["http://localhost:8001"] }).submit("SIGNEDXDR");

    expect(res.hash).toBe("txhash123");
    expect(state().sendRequests).toEqual(["http://localhost:8000", "http://localhost:8001"]);
  });

  it("polls other RPCs when the accepting provider has not indexed the tx yet", async () => {
    state().sendStatusByUrl["http://localhost:8000"] = "PENDING";
    state().getTxStatusByUrl["http://localhost:8000"] = "NOT_FOUND";
    state().getTxStatusByUrl["http://localhost:8001"] = "SUCCESS";

    const res = await newClient({ rpcFallbackUrls: ["http://localhost:8001"] }).submit("SIGNEDXDR");

    expect(res.status).toBe("SUCCESS");
    expect(state().getTransactionRequests).toContain("http://localhost:8001");
  });

  it("treats TRY_AGAIN_LATER as transient and accepts DUPLICATE on another RPC", async () => {
    state().sendStatusByUrl["http://localhost:8000"] = "TRY_AGAIN_LATER";
    state().sendStatusByUrl["http://localhost:8001"] = "DUPLICATE";
    state().getTxStatusByUrl["http://localhost:8001"] = "SUCCESS";

    const res = await newClient({ rpcFallbackUrls: ["http://localhost:8001"] }).submit("SIGNEDXDR");

    expect(res.hash).toBe("txhash123");
    expect(state().sendRequests).toEqual(["http://localhost:8000", "http://localhost:8001"]);
  });
});

describe("buildBlendWithdraw", () => {
  it("submits from, spender, and to as the holder with one request per bucket", async () => {
    const env = await newClient().buildBlendWithdraw({
      from: "GUSER",
      pool: "POOL",
      asset: "USDC",
      supplyAmount: 5n,
      collateralAmount: 7n,
    });
    expect(env.xdr).toBe("PREPARED:submit");

    const call = state().calls.find((c) => c.method === "submit");
    expect(call).toBeDefined();
    const [from, spender, to, requests] = call!.args as [
      { __scAddress: string },
      { __scAddress: string },
      { __scAddress: string },
      { __scVec: unknown[] },
    ];
    expect(from.__scAddress).toBe("GUSER");
    expect(spender.__scAddress).toBe("GUSER");
    expect(to.__scAddress).toBe("GUSER");
    expect(requests.__scVec).toHaveLength(2);
  });

  it("skips empty buckets and rejects an all-zero withdraw", async () => {
    const env = await newClient().buildBlendWithdraw({
      from: "GUSER",
      pool: "POOL",
      asset: "USDC",
      supplyAmount: 0n,
      collateralAmount: 7n,
    });
    expect(env.xdr).toBe("PREPARED:submit");
    const call = state().calls.find((c) => c.method === "submit");
    expect((call!.args[3] as { __scVec: unknown[] }).__scVec).toHaveLength(1);

    await expect(
      newClient().buildBlendWithdraw({
        from: "GUSER",
        pool: "POOL",
        asset: "USDC",
        supplyAmount: 0n,
        collateralAmount: 0n,
      }),
    ).rejects.toThrow(/nothing to withdraw/);
  });
});
