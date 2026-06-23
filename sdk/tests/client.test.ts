// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, vi } from "vitest";

// A controllable fake of @stellar/stellar-sdk. Operations carry the method name
// and args so the mock RPC can route return values and the tests can assert
// which contract call the client made. State lives on globalThis so tests can
// drive it without import gymnastics through the hoisted factory.
vi.mock("@stellar/stellar-sdk", () => {
  const state = {
    returns: {} as Record<string, unknown>,
    simulationError: null as string | null,
    accountExists: true,
    sendStatus: "PENDING" as string,
    sendHash: "txhash123",
    getTxStatus: "SUCCESS" as string,
    calls: [] as Array<{ method: string; args: unknown[] }>,
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
      return { __tx: xdr, ops: [] as Array<{ method: string; args: unknown[] }> };
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
      if (!state.accountExists) throw new Error("account not found");
      return { accountId: () => addr, sequenceNumber: () => "1" };
    }
    async simulateTransaction(tx: { ops: Array<{ method: string; args: unknown[] }> }) {
      const op = tx.ops[0]!;
      state.calls.push({ method: op.method, args: op.args });
      if (state.simulationError) return { error: state.simulationError };
      return { result: { retval: state.returns[op.method] } };
    }
    async prepareTransaction(tx: { ops: Array<{ method: string }> }) {
      return { toXDR: () => "PREPARED:" + tx.ops.map((o) => o.method).join("+") };
    }
    async sendTransaction() {
      return { status: state.sendStatus, hash: state.sendHash, errorResult: { code: "x" } };
    }
    async getTransaction() {
      return { status: state.getTxStatus };
    }
  }

  return { Contract, Address, nativeToScVal, scValToNative, TransactionBuilder, rpc: { Server, Api } };
});

import { StellarYT } from "../src/index.js";

type MockState = {
  returns: Record<string, unknown>;
  simulationError: string | null;
  accountExists: boolean;
  sendStatus: string;
  sendHash: string;
  getTxStatus: string;
  calls: Array<{ method: string; args: unknown[] }>;
};

const state = () => (globalThis as Record<string, unknown>).__sdkMock as MockState;

const contracts = { sy: "SY", pt: "PT", yt: "YT", tokenizer: "TK", market: "AMM" };

function newClient() {
  return new StellarYT({
    rpcUrl: "http://localhost:8000",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts,
  });
}

beforeEach(() => {
  const s = state();
  s.returns = {};
  s.simulationError = null;
  s.accountExists = true;
  s.sendStatus = "PENDING";
  s.getTxStatus = "SUCCESS";
  s.calls = [];
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
    };
    const m = await newClient().getMarket("mkt");
    expect(m.impliedApyBps).toBe(860n);
    expect(m.spotApyBps).toBe(875n);
    expect(m.twapWarmingUp).toBe(false);
    expect(m.underlying).toBe("USDC");
    expect(m.totalPt).toBe(500n);
    expect(m.totalSy).toBe(700n);
    expect(m.maturity).toBe(2_000_000_000);
  });

  it("rejects when the RPC simulation fails", async () => {
    state().simulationError = "boom";
    await expect(newClient().getMarket("mkt")).rejects.toThrow(/simulation failed/);
  });

  it("rejects when the source account is missing", async () => {
    state().accountExists = false;
    await expect(newClient().getMarket("mkt")).rejects.toThrow(/source account not found/);
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
  it("reads SY share balance, tokenizer position, and claimable yield", async () => {
    state().returns = {
      share_balance: 50n,
      position: { pt_balance: 10n, yt_balance: 20n },
      exchange_rate: 1_000_000_000_000_000_000n,
      preview_claim_yield: 7n,
    };
    const p = await newClient().getPosition("G1", "mkt");
    expect(p.syBalance).toBe(50n);
    expect(p.ptBalance).toBe(10n);
    expect(p.ytBalance).toBe(20n);
    expect(p.claimableYield).toBe(7n);
  });

  it("skips the yield preview when YT balance is zero", async () => {
    state().returns = {
      share_balance: 0n,
      position: { pt_balance: 0n, yt_balance: 0n },
      exchange_rate: 1_000_000_000_000_000_000n,
    };
    const p = await newClient().getPosition("G1", "mkt");
    expect(p.claimableYield).toBe(0n);
    expect(state().calls.some((c) => c.method === "preview_claim_yield")).toBe(false);
  });
});

describe("transaction builders", () => {
  it("buildMint without split deposits only", async () => {
    const env = await newClient().buildMint({
      marketId: "mkt",
      from: "G1",
      underlyingAmount: 100n,
      split: false,
    });
    expect(env.xdr).toBe("PREPARED:deposit");
    expect(env.networkPassphrase).toContain("Test SDF");
  });

  it("buildMint with split batches deposit then split", async () => {
    state().returns = { exchange_rate: 1_000_000_000_000_000_000n };
    const env = await newClient().buildMint({
      marketId: "mkt",
      from: "G1",
      underlyingAmount: 100n,
      split: true,
    });
    expect(env.xdr).toBe("PREPARED:deposit+split");
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
});
