// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE } from "../lib/config";
import {
  stellarExpertAccountUrl,
  stellarExpertContractUrl,
  stellarExpertNetwork,
  stellarExpertTxUrl,
} from "../lib/explorer";

const HASH = "d4cecc93e0ba947ff4d913b30bf230315995e25abb056ab710bda073a3004583";

describe("stellarExpertNetwork", () => {
  it("maps the testnet passphrase to testnet", () => {
    expect(stellarExpertNetwork(TESTNET_PASSPHRASE)).toBe("testnet");
  });

  it("maps the public passphrase to public", () => {
    expect(stellarExpertNetwork(PUBLIC_PASSPHRASE)).toBe("public");
  });

  it("falls back to testnet for unknown passphrases", () => {
    expect(stellarExpertNetwork("Standalone Network ; February 2017")).toBe("testnet");
  });
});

describe("stellarExpertTxUrl", () => {
  it("builds a testnet tx link", () => {
    expect(stellarExpertTxUrl(HASH, TESTNET_PASSPHRASE)).toBe(
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
  });

  it("builds a public tx link", () => {
    expect(stellarExpertTxUrl(HASH, PUBLIC_PASSPHRASE)).toBe(
      `https://stellar.expert/explorer/public/tx/${HASH}`,
    );
  });
});

describe("stellarExpertAccountUrl", () => {
  it("builds a testnet account link", () => {
    const g = "GBGHELMOABS7WCYOMJTWQRGQ6VZYLYXXMLE7JJAHJ6I4WW7FMJSDERN3";
    expect(stellarExpertAccountUrl(g, TESTNET_PASSPHRASE)).toBe(
      `https://stellar.expert/explorer/testnet/account/${g}`,
    );
  });

  it("builds a public contract link", () => {
    const c = "CCLFK26PU5GNMCUAGBBBGKVXE6GWYA2PB3RFTC7Y5HRVPPBRGWYUZKUU";
    expect(stellarExpertContractUrl(c, PUBLIC_PASSPHRASE)).toBe(
      `https://stellar.expert/explorer/public/contract/${c}`,
    );
  });
});
