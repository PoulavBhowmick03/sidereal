// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "sidereal-demo-runner",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
