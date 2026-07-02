// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  TOUR_STORAGE_KEY,
  clearTourPreference,
  readTourPreference,
  resolveTourStep,
  writeTourPreference,
  type TourPreference,
  type TourState,
} from "../lib/tour";

function state(overrides: Partial<TourState> = {}): TourState {
  return {
    address: null,
    pathname: "/trade",
    preference: null,
    goalChosen: false,
    blendPosition: null,
    position: null,
    ...overrides,
  };
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(TOUR_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("resolveTourStep", () => {
  it("starts by asking for a wallet", () => {
    expect(resolveTourStep(state())?.id).toBe("connect");
  });

  it("guides a connected Blend lender to the detected position banner", () => {
    const step = resolveTourStep(
      state({
        address: "GUSER",
        blendPosition: { underlyingValue: 10n },
      }),
    );

    expect(step).toMatchObject({
      id: "find-yield",
      target: "blend-position-tokenize",
      fallbackTarget: "nav-mint",
    });
  });

  it("guides a connected wallet without a Blend position to mint", () => {
    expect(resolveTourStep(state({ address: "GUSER" }))).toMatchObject({
      id: "find-yield",
      target: "nav-mint",
    });
  });

  it("targets the amount field on the fresh mint path", () => {
    expect(resolveTourStep(state({ address: "GUSER", pathname: "/mint" }))).toMatchObject({
      id: "choose-goal",
      target: "mint-amount",
    });
  });

  it("advances to signing after a goal is chosen", () => {
    expect(
      resolveTourStep(state({ address: "GUSER", pathname: "/mint", goalChosen: true })),
    ).toMatchObject({
      id: "sign",
      target: "mint-submit",
    });
  });

  it("sends users with balances to portfolio", () => {
    expect(
      resolveTourStep(
        state({
          address: "GUSER",
          pathname: "/mint",
          position: { syBalance: 1n, ptBalance: 0n, ytBalance: 0n },
        }),
      ),
    ).toMatchObject({
      id: "manage",
      target: "nav-portfolio",
    });
  });

  it("returns null once dismissed or complete", () => {
    expect(resolveTourStep(state({ preference: "dismissed" }))).toBeNull();
    expect(
      resolveTourStep(
        state({
          address: "GUSER",
          pathname: "/portfolio",
          position: { syBalance: 0n, ptBalance: 1n, ytBalance: 1n },
        }),
      ),
    ).toBeNull();
  });
});

describe("tour storage helpers", () => {
  it("reads only known preferences", () => {
    expect(readTourPreference(memoryStorage("dismissed"))).toBe<TourPreference>("dismissed");
    expect(readTourPreference(memoryStorage("done"))).toBe<TourPreference>("done");
    expect(readTourPreference(memoryStorage("unknown"))).toBeNull();
  });

  it("writes and clears the stored preference", () => {
    const storage = memoryStorage();
    writeTourPreference(storage, "dismissed");
    expect(readTourPreference(storage)).toBe("dismissed");
    clearTourPreference(storage);
    expect(readTourPreference(storage)).toBeNull();
  });
});
