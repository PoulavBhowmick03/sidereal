// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Market lifecycle" };

export default function LifecyclePage() {
  return (
    <article>
      <DocsHeader
        kicker="Concepts"
        title="Market lifecycle"
        summary="A Sidereal market is born with a fixed end date and settles on it. This page walks the whole arc: what you can do while it lives, what changes at maturity, and what remains open after."
      />

      <div className="docs-prose mt-8">
        <h2>Before maturity: the live market</h2>
        <p>Every action in the protocol is available while the market is live:</p>
        <ul>
          <li>
            <strong>Deposit / withdraw.</strong> Turn USDC into SY or back again, at the current
            exchange rate. Always open, in both directions.
          </li>
          <li>
            <strong>Split.</strong> Lock SY with the protocol and receive equal amounts of PT and
            YT.
          </li>
          <li>
            <strong>Recombine.</strong> Return equal PT and YT and get the SY back. Split and
            recombine are exact opposites, and you can cycle between the two forms freely.
          </li>
          <li>
            <strong>Collect interest.</strong> YT holders collect what has built up so far,
            whenever they like. Collecting early matters: once collected, the interest is yours no
            matter what rates do afterwards.
          </li>
          <li>
            <strong>Trade.</strong> Swap between PT, SY and YT in the shared pool, or deposit into
            the pool as a liquidity provider and earn trading fees.
          </li>
        </ul>
        <p>
          Throughout this phase, the exchange rate drifts upward as Blend interest comes in.
          PT&rsquo;s price climbs toward one dollar, and YT&rsquo;s remaining claim shrinks as the
          time window closes. In the background, the protocol keeps recording the exchange rate at
          every interaction. These recorded snapshots are called <strong>observations</strong>,
          and they decide what happens at the boundary, below.
        </p>

        <h2>At maturity: the rate freezes</h2>
        <p>
          Maturity is a timestamp fixed when the market is created. When it passes, the protocol{" "}
          <strong>freezes</strong> the redemption rate to the last observation recorded at or
          before the maturity instant, never to a reading taken afterwards. The freeze is what
          keeps the split clean at the boundary: interest that arrives <em>after</em> maturity
          belongs to nobody&rsquo;s YT, so it must not sneak into anybody&rsquo;s payout.
        </p>
        <p>From that instant:</p>
        <ul>
          <li>
            <strong>PT pays out one-for-one.</strong> Each PT redeems for its dollar of principal,
            priced at the frozen rate. There is no deadline; redemption stays open.
          </li>
          <li>
            <strong>YT stops earning.</strong> Interest built up before the freeze can still be
            collected. The token itself is worthless from here on.
          </li>
          <li>
            <strong>Splitting stops.</strong> A matured market cannot create new PT or YT. There
            is no future interest left to separate.
          </li>
        </ul>

        <h2>After maturity: wind-down</h2>
        <p>
          The market becomes a settlement window: PT holders redeem, YT holders make their final
          collections, and liquidity providers withdraw. The current mainnet market is a single
          fixed cycle. When a successor market opens, moving into it means redeeming here and
          depositing there; nothing rolls over automatically.
        </p>

        <h2>The arc at a glance</h2>
        <div className="docs-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Live market</th>
                <th>After maturity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Deposit / withdraw USDC ↔ SY</td>
                <td>Yes</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Split SY → PT + YT</td>
                <td>Yes</td>
                <td>No</td>
              </tr>
              <tr>
                <td>Recombine PT + YT → SY</td>
                <td>Yes</td>
                <td>No. Redeem the PT instead</td>
              </tr>
              <tr>
                <td>Collect YT interest</td>
                <td>Yes, as it builds up</td>
                <td>Final collection of pre-freeze interest</td>
              </tr>
              <tr>
                <td>Redeem PT for principal</td>
                <td>No</td>
                <td>Yes, one-for-one at the frozen rate</td>
              </tr>
              <tr>
                <td>Trade / provide liquidity</td>
                <td>Yes</td>
                <td>Withdraw liquidity</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <Callout label="Current market" signal>
          The live mainnet market runs a 30-day cycle over the Blend v2 USDC pool, maturing{" "}
          <strong>2026-08-09 15:39 UTC</strong>. Contract addresses and deployment records are in{" "}
          <Link href="/docs/contracts">Deployed contracts</Link>.
        </Callout>
      </div>

      <div className="docs-prose mt-8">
        <p>
          The freeze mechanics (who records observations, what happens if none lands exactly at
          maturity, and why redemption can never read a post-maturity rate) are covered in{" "}
          <Link href="/docs/settlement">Settlement and maturity</Link>.
        </p>
      </div>

      <DocsPager current="/docs/lifecycle" />
    </article>
  );
}
