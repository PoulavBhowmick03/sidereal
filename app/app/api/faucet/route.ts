// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Blend faucet only sends Access-Control-Allow-Origin for
// https://testnet.blend.capital, so browsers block a direct fetch from this
// app. This route proxies the request server-side under our own origin.
const DEFAULT_UPSTREAM_URL =
  "https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets";

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

export async function GET(request: Request) {
  if (appConfig().network !== "testnet") {
    return NextResponse.json(
      { error: "Blend faucet is disabled outside testnet" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const userId = new URL(request.url).searchParams.get("userId");
  if (userId === null || !STELLAR_ADDRESS.test(userId)) {
    return NextResponse.json(
      { error: "userId must be a Stellar G-address" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const upstream = new URL(process.env.BLEND_FAUCET_UPSTREAM_URL || DEFAULT_UPSTREAM_URL);
  upstream.searchParams.set("userId", userId);
  const response = await fetch(upstream.toString(), { cache: "no-store" });
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
