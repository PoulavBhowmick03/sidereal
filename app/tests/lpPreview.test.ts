// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { previewAddLiquidity, previewRemoveLiquidity } from "../lib/lpPreview";

describe("previewAddLiquidity", () => {
  it("mints LP from the limiting PT side and leaves excess SY unused", () => {
    expect(
      previewAddLiquidity({
        ptIn: 100n,
        syIn: 500n,
        totalPt: 1_000n,
        totalSy: 2_000n,
        totalLp: 1_000n,
      }),
    ).toMatchObject({
      lpOut: 100n,
      ptUsed: 100n,
      syUsed: 200n,
      ptUnused: 0n,
      syUnused: 300n,
      limitingSide: "PT",
      shareBpsAfter: 909n,
      reason: "ok",
    });
  });

  it("rounds actual token usage up like the contract", () => {
    expect(
      previewAddLiquidity({
        ptIn: 10n,
        syIn: 10n,
        totalPt: 101n,
        totalSy: 103n,
        totalLp: 100n,
      }),
    ).toMatchObject({
      lpOut: 9n,
      ptUsed: 10n,
      syUsed: 10n,
      limitingSide: "balanced",
    });
  });

  it("reports degenerate states without fabricating a first seed preview", () => {
    expect(
      previewAddLiquidity({
        ptIn: 10n,
        syIn: 10n,
        totalPt: 0n,
        totalSy: 0n,
        totalLp: 0n,
      }).reason,
    ).toBe("empty-pool");
    expect(
      previewAddLiquidity({
        ptIn: 0n,
        syIn: 10n,
        totalPt: 1n,
        totalSy: 1n,
        totalLp: 1n,
      }).reason,
    ).toBe("invalid-input");
  });
});

describe("previewRemoveLiquidity", () => {
  it("returns pro-rata PT and SY rounded down", () => {
    expect(
      previewRemoveLiquidity({
        lpIn: 123n,
        totalPt: 1_001n,
        totalSy: 2_003n,
        totalLp: 400n,
      }),
    ).toMatchObject({
      lpIn: 123n,
      ptOut: 307n,
      syOut: 615n,
      shareBps: 3_075n,
      reason: "ok",
    });
  });

  it("handles empty pools and zero LP inputs", () => {
    expect(
      previewRemoveLiquidity({
        lpIn: 1n,
        totalPt: 0n,
        totalSy: 0n,
        totalLp: 0n,
      }).reason,
    ).toBe("empty-pool");
    expect(
      previewRemoveLiquidity({
        lpIn: 0n,
        totalPt: 10n,
        totalSy: 10n,
        totalLp: 10n,
      }).reason,
    ).toBe("invalid-input");
  });
});
