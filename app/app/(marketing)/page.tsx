// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";

// A single, centered, full-height hero in the style of a minimal product
// teaser: a status pill, one editorial headline, a short subhead, and a single
// call to action.
export default function LandingPage() {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-neutral-600">
        <span className="h-1.5 w-1.5 rounded-full bg-neutral-900" />
        Now in development
      </span>

      <h1 className="mt-8 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
        Split Stellar yield into principal and yield.
      </h1>

      <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-600">
        Sidereal tokenizes a yield-bearing asset into a Principal Token that redeems 1:1 at
        maturity and a Yield Token that streams the yield. Trade either on a time-decay AMM priced
        by an internal TWAP.
      </p>

      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/trade"
          className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-6 py-3 text-base font-medium text-white transition hover:bg-neutral-700"
        >
          Launch App
          <span aria-hidden>→</span>
        </Link>
        <span className="font-mono text-sm text-neutral-400">PT + YT = SY</span>
      </div>
    </section>
  );
}
