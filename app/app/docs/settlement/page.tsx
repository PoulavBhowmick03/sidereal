// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Settlement and maturity" };

export default function SettlementPage() {
  return (
    <article>
      <DocsHeader
        kicker="Protocol design"
        title="Settlement and maturity"
        summary="Maturity is where a fixed-income protocol either keeps its promises or doesn't. This page covers the rate freeze, who can trigger it, who gets paid first if the money falls short, and what stays open afterwards."
      />

      <div className="docs-prose mt-8">
        <h2>The problem the freeze solves</h2>
        <p>
          Blend doesn&rsquo;t know Sidereal&rsquo;s maturity date exists. The lending pool keeps
          earning interest right past it. If PT redemption naively read the live rate whenever
          each holder showed up, interest earned <em>after</em> maturity would leak into payouts,
          and two people redeeming the same claim on different days would get different amounts.
          The boundary that defines the whole product (before maturity is YT&rsquo;s, at maturity
          is PT&rsquo;s) would be blurry exactly where it must be sharp.
        </p>

        <h2>Freezing to an observed rate</h2>
        <p>
          The protocol records the exchange rate at every interaction: splits, collections,
          recombines, even plain YT transfers report their rate through the same path. Each
          recording is an <strong>observation</strong>. At maturity, the redemption rate freezes
          to <strong>the last observation made at or before the maturity instant</strong>, never
          to a reading taken afterwards. The snapshot happens automatically on the first
          post-maturity interaction, or anyone can trigger it explicitly by calling{" "}
          <code>freeze_maturity_rate</code>.
        </p>
        <p>
          &ldquo;Anyone&rdquo; is deliberate. Both maintenance calls, <code>observe_rate</code>{" "}
          before maturity and <code>freeze_maturity_rate</code> after, are open to any caller: a
          bot, the team, or a YT holder protecting their own interest. Whoever calls, the effect
          is the same, so there is nothing to abuse. Frequent observations near the boundary pin
          the frozen rate as close to the maturity instant as possible.
        </p>
        <p>
          And if the market goes quiet and the last observation lands early? The small tail of
          unrecorded interest stays in the escrow behind the principal, resolving{" "}
          <strong>predictably in PT&rsquo;s favor</strong>. The failure mode is a known, bounded
          lean toward the senior claim. It is never a race where the fastest claimant wins.
        </p>

        <h2>Who gets paid first</h2>
        <p>
          Settlement enforces a strict order on the escrow: the full PT principal is reserved{" "}
          <em>before</em> any YT interest is paid. In normal operation this ordering is invisible,
          because the escrow covers both sides in full (see the{" "}
          <Link href="/docs/tokenizer">tokenizer&rsquo;s coverage rule</Link>). It only bites if
          the underlying pool genuinely loses money:
        </p>
        <ul>
          <li>
            <strong>PT holders</strong> share any shortfall proportionally. Each redemption is
            capped at that holder&rsquo;s fair share of the escrow, so being first in line buys
            nothing and there is no bank-run dynamic on the senior side.
          </li>
          <li>
            <strong>YT holders</strong> stand behind PT and are paid from whatever remains above
            the principal reservation. Within that junior slice, collections during an active
            shortfall are served in the order they arrive. Splitting that slice proportionally
            instead is a documented v2 item; it needs an extra piece of shared bookkeeping the
            contracts don&rsquo;t carry today.
          </li>
        </ul>

        <h2>What stays open after maturity</h2>
        <ul>
          <li>
            <strong>PT redemption</strong>: open indefinitely, always at the frozen rate. There is
            no deadline to beat and nothing gained or lost by redeeming late.
          </li>
          <li>
            <strong>Final YT collections</strong>: interest earned up to the freeze remains
            collectible through a grace window, paid at the frozen rate. Nothing new accrues.
          </li>
          <li>
            <strong>SY withdrawal</strong>: unwrapping SY to USDC has no maturity attached. It
            works before, at, and after.
          </li>
          <li>
            <strong>LP withdrawal</strong>: liquidity providers can exit; the pool&rsquo;s PT has
            finished its glide to face value by then.
          </li>
        </ul>

        <h2>Long-lived storage</h2>
        <p>
          On Stellar, contract data pays rent: each stored entry has a time-to-live that must be
          topped up. Per-holder interest ledgers and LP balances live in persistent storage, and
          if an entry&rsquo;s time-to-live ever runs out, the network <em>archives</em> it rather
          than deleting it. A standard network operation restores archived entries without needing
          anything special from the contracts. The app tops entries up automatically, and the
          restore path is the documented recovery for dormant ones. Funds cannot be lost to an
          expired timer.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Verified live" signal>
          The freeze isn&rsquo;t just designed, it is proven against real Blend interest: in live
          testing, the freeze pinned the last pre-maturity observation and ignored a higher live
          post-maturity rate, confirmed by an independent read. The full settlement sequence
          (observe, freeze, redeem PT, final YT collection) has run end to end on-chain.
        </Callout>
      </div>

      <DocsPager current="/docs/settlement" />
    </article>
  );
}
