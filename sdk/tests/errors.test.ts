// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { ContractError, parseContractErrorCode } from "../src/index.js";

describe("parseContractErrorCode", () => {
  it("extracts the code from the standard Soroban diagnostic", () => {
    expect(parseContractErrorCode("HostError: Error(Contract, #4) invalid amount")).toBe(4);
    expect(parseContractErrorCode("Error(Contract, #10)")).toBe(10);
  });

  it("handles a bare hash code", () => {
    expect(parseContractErrorCode("contract call reverted #9")).toBe(9);
  });

  it("returns null when there is no contract code", () => {
    expect(parseContractErrorCode("connection refused")).toBeNull();
  });
});

describe("ContractError", () => {
  it("uses the code in its message when present", () => {
    const err = new ContractError("Error(Contract, #11)", 11);
    expect(err.name).toBe("ContractError");
    expect(err.code).toBe(11);
    expect(err.message).toMatch(/#11/);
    expect(err instanceof Error).toBe(true);
  });

  it("falls back to the raw diagnostic when there is no code", () => {
    const err = new ContractError("transport error", null);
    expect(err.code).toBeNull();
    expect(err.message).toMatch(/transport error/);
  });
});
