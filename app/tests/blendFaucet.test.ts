// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBlendFaucetTransaction,
  fundWithFriendbot,
  submitClassicTransaction,
} from "../lib/blendFaucet";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Blend faucet", () => {
  it("returns the quoted base64 transaction and adds the user query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify("AAAAFAUCETXDR"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchBlendFaucetTransaction("https://faucet.example/getAssets", "GUSER"),
    ).resolves.toEqual({ kind: "transaction", xdr: "AAAAFAUCETXDR" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://faucet.example/getAssets?userId=GUSER",
    );
  });

  it("resolves a relative proxy path against the current origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify("AAAAFAUCETXDR"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBlendFaucetTransaction("/api/faucet", "GUSER")).resolves.toEqual({
      kind: "transaction",
      xdr: "AAAAFAUCETXDR",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/faucet?userId=GUSER");
  });

  it("reports an unfunded account without treating it as faucet downtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Not Found" }), { status: 404 }),
      ),
    );

    await expect(
      fetchBlendFaucetTransaction("https://faucet.example/getAssets", "GUSER"),
    ).resolves.toEqual({ kind: "account_not_found" });
  });

  it("funds the exact account through friendbot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fundWithFriendbot("https://friendbot.example", "GUSER");

    expect(fetchMock).toHaveBeenCalledWith("https://friendbot.example/?addr=GUSER");
  });

  it("submits signed XDR to the configured Horizon", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hash: "txhash" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitClassicTransaction("SIGNEDXDR", "https://horizon.example"),
    ).resolves.toBe("txhash");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://horizon.example/transactions",
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({ tx: "SIGNEDXDR" }),
      }),
    );
  });

  it("surfaces Horizon submission errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ extras: { result_codes: { transaction: "tx_bad_seq" } } }),
          { status: 400 },
        ),
      ),
    );

    await expect(
      submitClassicTransaction("SIGNEDXDR", "https://horizon.example"),
    ).rejects.toThrow(/tx_bad_seq/);
  });
});
