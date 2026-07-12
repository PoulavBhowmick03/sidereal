// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Trade PT and YT" };

export default function TradeGuidePage() {
  return (
    <article>
      <DocsHeader
        kicker="Guides"
        title="Trade PT and YT"
        summary="The Trade page is four actions, buy or sell PT and buy or sell YT, all against one shared pool. This guide explains what each action means as a position on interest rates, and how to read the quote."
      />

      <div className="docs-prose mt-8">
        <h2>The four actions, as positions</h2>
        <div className="docs-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>You are saying</th>
                <th>What happens</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Buy PT</strong>
                </td>
                <td>&ldquo;Today&rsquo;s fixed rate is good. I want certainty.&rdquo;</td>
                <td>Your SY becomes PT. Hold to maturity and the fixed rate is yours.</td>
              </tr>
              <tr>
                <td>
                  <strong>Sell PT</strong>
                </td>
                <td>&ldquo;I&rsquo;d rather have flexible SY now than wait for face value.&rdquo;</td>
                <td>Your PT becomes SY, exiting the fixed position early at today&rsquo;s discount.</td>
              </tr>
              <tr>
                <td>
                  <strong>Buy YT</strong>
                </td>
                <td>&ldquo;Interest will run hotter than the market expects.&rdquo;</td>
                <td>Your SY becomes YT, a leveraged bet on the floating rate.</td>
              </tr>
              <tr>
                <td>
                  <strong>Sell YT</strong>
                </td>
                <td>&ldquo;I&rsquo;ll take the future interest as cash, today.&rdquo;</td>
                <td>Your YT becomes SY, converting floating exposure into money now.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          YT trades route through the same PT/SY pool in one atomic step. There is no separate YT
          pool, so YT and PT prices can never disagree with each other. The mechanism is in{" "}
          <Link href="/docs/amm">AMM and YT routing</Link>.
        </p>

        <h2>Reading the numbers</h2>
        <ul>
          <li>
            <strong>Implied APY (TWAP)</strong>: the fixed rate the market is offering, averaged
            over the last 30 minutes. Averaging smooths out any single trade&rsquo;s footprint, so
            this is the trustworthy reference number.
          </li>
          <li>
            <strong>Spot APY</strong>: the same rate at this exact instant. Your trade executes
            against spot, and your own trade moves it.
          </li>
          <li>
            <strong>Maturity</strong>: days remaining. The same price discount over less time
            means a higher yearly rate, so prices get touchier as the clock runs down.
          </li>
          <li>
            <strong>Reserves (SY)</strong>: how much is in the pool. Compare your trade size to
            it. The quote already includes the price impact of your own trade, and in a small pool
            that impact dominates.
          </li>
        </ul>

        <h2>Slippage protection</h2>
        <p>
          Slippage is the gap between the price you were quoted and the price you actually get,
          caused by the market moving in between. Every Sidereal swap carries a floor: the minimum
          you are willing to receive, derived from your quote and a tolerance setting. If the pool
          moves beyond the tolerance before your transaction lands, the transaction cancels itself
          instead of filling at the worse price. A cancelled transaction still costs its (tiny)
          network fee, so in fast-moving conditions, ask for a fresh quote rather than widening
          the tolerance.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Current pool depth" signal>
          The mainnet market is newly seeded and shallow. Small trades work fine; size will move
          the rate sharply against you, and the quote will show it. Splitting and holding (see{" "}
          <Link href="/docs/guides/mint">Deposit and split</Link>) works at any size, no pool
          required.
        </Callout>
      </div>

      <DocsPager current="/docs/guides/trade" />
    </article>
  );
}
