// SPDX-License-Identifier: Apache-2.0

export const TOUR_STORAGE_KEY = "sidereal.tour.v1";
export const TOUR_REPLAY_EVENT = "sidereal:tour-replay";
export const TOUR_VISIBILITY_EVENT = "sidereal:tour-visibility";

export type TourPreference = "dismissed" | "done" | null;

export interface TourState {
  address: string | null;
  pathname: string;
  preference: TourPreference;
  goalChosen: boolean;
  blendPosition: { underlyingValue: bigint } | null;
  position: { syBalance: bigint; ptBalance: bigint; ytBalance: bigint } | null;
}

export interface TourStep {
  id: "connect" | "find-yield" | "choose-goal" | "sign" | "manage";
  index: number;
  total: number;
  title: string;
  instruction: string;
  target: string;
  fallbackTarget?: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const TOTAL_STEPS = 5;

function hasBlendPosition(state: Pick<TourState, "blendPosition">): boolean {
  return (state.blendPosition?.underlyingValue ?? 0n) > 0n;
}

export function hasProtocolPosition(state: Pick<TourState, "position">): boolean {
  const position = state.position;
  return (
    position !== null &&
    (position.syBalance > 0n || position.ptBalance > 0n || position.ytBalance > 0n)
  );
}

export function isTourComplete(state: TourState): boolean {
  return (
    state.address !== null &&
    hasProtocolPosition(state) &&
    normalizePathname(state.pathname) === "/portfolio"
  );
}

export function normalizePathname(pathname: string): string {
  if (pathname === "") return "/";
  return pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
}

export function resolveTourStep(state: TourState): TourStep | null {
  if (state.preference !== null || isTourComplete(state)) return null;

  const pathname = normalizePathname(state.pathname);
  const hasBlend = hasBlendPosition(state);
  const hasPosition = hasProtocolPosition(state);

  if (state.address === null) {
      return {
        id: "connect",
        index: 1,
        total: TOTAL_STEPS,
        title: "Connect a wallet",
        instruction:
          "Start with a wallet on this market's network so Sidereal can read your Blend and protocol balances.",
        target: "wallet",
      };
    }

  if (!hasPosition && pathname !== "/mint") {
    return {
      id: "find-yield",
      index: 2,
      total: TOTAL_STEPS,
      title: hasBlend ? "Tokenize your Blend yield" : "Start from Mint",
      instruction: hasBlend
        ? "Sidereal found your Blend deposit. Open the guided tokenization panel from this banner."
        : "No Blend deposit is visible yet. Use Mint to deposit USDC, or return after supplying on Blend.",
      target: hasBlend ? "blend-position-tokenize" : "nav-mint",
      fallbackTarget: "nav-mint",
    };
  }

  if (!hasPosition && !state.goalChosen) {
    return {
      id: "choose-goal",
      index: 3,
      total: TOTAL_STEPS,
      title: hasBlend ? "Choose fixed or variable" : "Enter a USDC amount",
      instruction: hasBlend
        ? "Pick whether to keep PT plus YT, or sell the new YT to lock the fixed side."
        : "Enter the amount you want to wrap into SY, then choose deposit only or deposit plus split.",
      target: hasBlend ? "tokenize-goal" : "mint-amount",
      fallbackTarget: "nav-mint",
    };
  }

  if (!hasPosition) {
    return {
      id: "sign",
      index: 4,
      total: TOTAL_STEPS,
      title: "Sign the transaction",
      instruction: hasBlend
        ? "Follow the wallet prompts. Each signature lands one step of the Blend migration."
        : "Submit the mint flow once the preview looks right. The wallet signs the on-chain action.",
      target: hasBlend ? "tokenize-submit" : "mint-submit",
      fallbackTarget: hasBlend ? "tokenize-goal" : "mint-amount",
    };
  }

  if (pathname !== "/portfolio") {
    return {
      id: "manage",
      index: 5,
      total: TOTAL_STEPS,
      title: "Manage it in Portfolio",
      instruction: "Portfolio is where you claim yield, recombine PT and YT, or redeem SY.",
      target: "nav-portfolio",
    };
  }

  return null;
}

export function readTourPreference(storage: StorageLike | null | undefined): TourPreference {
  if (!storage) return null;
  const value = storage.getItem(TOUR_STORAGE_KEY);
  return value === "dismissed" || value === "done" ? value : null;
}

export function writeTourPreference(
  storage: StorageLike | null | undefined,
  preference: Exclude<TourPreference, null>,
): void {
  storage?.setItem(TOUR_STORAGE_KEY, preference);
}

export function clearTourPreference(storage: StorageLike | null | undefined): void {
  storage?.removeItem(TOUR_STORAGE_KEY);
}
