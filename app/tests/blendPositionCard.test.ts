// SPDX-License-Identifier: Apache-2.0

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BlendPosition, BlendRates } from "@sidereal/sdk";
import { describe, expect, it } from "vitest";
import { BlendPositionCard } from "../components/BlendPositionCard";

const blendSource = {
  kind: "blend" as const,
  name: "Blend v2 USDC pool",
  poolAddress: "CPOOL",
  reserveAddress: "CUSDC",
  reserveAsset: "USDC:GISSUER",
  docsUrl: "https://testnet.blend.capital",
};

const mockSource = {
  ...blendSource,
  kind: "mock" as const,
  name: "Simulated rate",
};

const position: BlendPosition = {
  supplyBTokens: 0n,
  collateralBTokens: 0n,
  supplyValue: 12_0000000n,
  collateralValue: 0n,
  underlyingValue: 12_0000000n,
  borrowedValue: 0n,
};

const rates: BlendRates = {
  utilization: 0n,
  borrowApr: 0n,
  supplyApr: 100_000n,
  totalSupplied: 0n,
  totalBorrowed: 0n,
};

function renderCard(
  props: Partial<Parameters<typeof BlendPositionCard>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(BlendPositionCard, {
      source: blendSource,
      position,
      rates: null,
      decimals: 7,
      ...props,
    }),
  );
}

describe("BlendPositionCard", () => {
  it("renders nothing for non-Blend markets", () => {
    expect(renderCard({ source: mockSource })).toBe("");
  });

  it("renders nothing without a positive position", () => {
    expect(renderCard({ position: null })).toBe("");
    expect(renderCard({ position: { ...position, underlyingValue: 0n } })).toBe("");
  });

  it("renders the banner variant with the fallback rate copy", () => {
    const html = renderCard({ variant: "banner" });

    expect(html).toContain("Blend position detected");
    expect(html).toContain("12 USDC");
    expect(html).toContain("a variable rate");
    expect(html).toContain('href="/mint"');
  });

  it("renders the banner variant with live Blend rates", () => {
    const html = renderCard({ variant: "banner", rates });

    expect(html).toContain("1.00%");
    expect(html).not.toContain("a variable rate");
  });

  it("keeps the full variant copy for portfolio and mint surfaces", () => {
    const html = renderCard({ variant: "full", rates });

    expect(html).toContain("Your position in Blend v2 USDC pool");
    expect(html).toContain("Tokenize this position");
    expect(html).toContain("1.00%");
  });
});
