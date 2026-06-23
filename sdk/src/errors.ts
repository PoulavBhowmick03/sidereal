// SPDX-License-Identifier: Apache-2.0

/**
 * Typed error for a failed contract call. Soroban surfaces contract `Err`
 * returns in the simulation/diagnostic string as `Error(Contract, #N)`, where
 * N is the contract's error enum discriminant. We extract that code so callers
 * can branch on it instead of string-matching, while keeping the raw diagnostic
 * for debugging.
 */
export class ContractError extends Error {
  readonly code: number | null;
  readonly raw: string;

  constructor(raw: string, code: number | null) {
    super(
      code !== null
        ? `contract call failed with error #${code}`
        : `contract call failed: ${raw}`,
    );
    this.name = "ContractError";
    this.code = code;
    this.raw = raw;
  }
}

/**
 * Best-effort extraction of a Soroban contract error code from a diagnostic
 * string. Returns null when no code is present (e.g. a transport error).
 */
export function parseContractErrorCode(raw: string): number | null {
  const patterns = [
    /Error\(Contract,\s*#?(\d+)\)/i,
    /\bcontract\b[^#]*#(\d+)/i,
    /#(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match) return Number(match[1]);
  }
  return null;
}
