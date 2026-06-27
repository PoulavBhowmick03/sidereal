// SPDX-License-Identifier: Apache-2.0

import type { ContractError } from "@sidereal/sdk";

// Which contract a user action talks to, so a numeric error code maps to the
// right message (codes are per-contract enums and overlap across contracts).
export type ErrorContext = "amm" | "tokenizer" | "sy";

const MESSAGES: Record<ErrorContext, Record<number, string>> = {
  amm: {
    4: "Enter a valid amount.",
    9: "This market has no liquidity yet.",
    10: "This market has matured.",
    11: "Price moved beyond your slippage tolerance. Try again.",
    12: "Not enough liquidity for this trade.",
  },
  tokenizer: {
    3: "Invalid maturity.",
    4: "Enter a valid amount.",
    5: "PT and YT amounts must match.",
    6: "This market has matured.",
    7: "You do not hold enough PT and YT.",
    8: "The market is still live.",
    9: "Amount is too large.",
  },
  sy: {
    3: "Enter a valid amount.",
    4: "Invalid exchange rate.",
    5: "Insufficient balance.",
    6: "Amount is too large.",
  },
};

function isContractError(err: unknown): err is ContractError {
  return err instanceof Error && err.name === "ContractError";
}

/** Turns any thrown value into a user-facing message for the given context. */
export function describeError(err: unknown, ctx: ErrorContext): string {
  if (isContractError(err)) {
    const { code } = err;
    if (code !== null) {
      return MESSAGES[ctx][code] ?? `Transaction failed (error #${code}).`;
    }
    return err.raw;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
