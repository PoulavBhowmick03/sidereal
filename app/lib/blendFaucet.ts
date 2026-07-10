// SPDX-License-Identifier: Apache-2.0

type FaucetResponse = string | { error?: string };

export type FaucetResult =
  | { kind: "transaction"; xdr: string }
  | { kind: "account_not_found" };

function responseMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.error === "string") return record.error;
    const extras = record.extras as Record<string, unknown> | undefined;
    if (extras?.result_codes) return JSON.stringify(extras.result_codes);
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Fetches the wallet-signed classic transaction prepared by Blend's faucet. */
export async function fetchBlendFaucetTransaction(
  faucetUrl: string,
  address: string,
): Promise<FaucetResult> {
  // The default faucet URL is a same-origin proxy path (/api/faucet), so
  // resolve relative URLs against the current origin (or a stand-in base
  // outside the browser). Absolute URLs ignore the base.
  const url = new URL(
    faucetUrl,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  url.searchParams.set("userId", address);
  const response = await fetch(url.toString());
  const body = (await readJson(response)) as FaucetResponse | null;

  if (typeof body === "object" && body?.error === "Not Found") {
    return { kind: "account_not_found" };
  }
  if (!response.ok) {
    throw new Error(`Blend faucet failed: ${responseMessage(body, response.statusText)}`);
  }
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("Blend faucet returned no transaction to sign.");
  }
  return { kind: "transaction", xdr: body };
}

/** Funds an unfunded G-account through the configured Friendbot endpoint. */
export async function fundWithFriendbot(friendbotUrl: string, address: string): Promise<void> {
  const url = new URL(friendbotUrl);
  url.searchParams.set("addr", address);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await readJson(response);
    throw new Error(`Friendbot failed: ${responseMessage(body, response.statusText)}`);
  }
}

/** Submits a signed classic transaction envelope to the configured Horizon. */
export async function submitClassicTransaction(
  signedXdr: string,
  horizonUrl: string,
): Promise<string> {
  const response = await fetch(new URL("/transactions", horizonUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: signedXdr }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Faucet transaction failed: ${responseMessage(body, response.statusText)}`);
  }
  if (typeof body !== "object" || body === null || typeof (body as { hash?: unknown }).hash !== "string") {
    throw new Error("Horizon accepted the faucet transaction without returning its hash.");
  }
  return (body as { hash: string }).hash;
}
