// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { stellarExpertNetwork, stellarExpertTxUrl } from "../lib/explorer";

describe("stellarExpertNetwork", () => {
  it("maps the public passphrase to public explorer", () => {
    expect(stellarExpertNetwork("Public Global Stellar Network ; September 2015")).toBe("public");
  });

  it("defaults non-public networks to testnet explorer", () => {
    expect(stellarExpertNetwork("Test SDF Network ; September 2015")).toBe("testnet");
  });
});

describe("stellarExpertTxUrl", () => {
  it("builds a transaction URL", () => {
    expect(stellarExpertTxUrl("abc123", "Test SDF Network ; September 2015")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
  });
});
