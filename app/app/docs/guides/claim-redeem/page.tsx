// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Claim and redeem" };

export default function ClaimRedeemGuidePage() {
  return (
    <article>
      <DocsHeader
        kicker="Guides"
        title="Claim and redeem"
        summary="Everything that pays out lives on the Portfolio page: collecting YT interest, recombining back to SY, redeeming PT after maturity, and unwrapping SY to USDC."
      />

      <div className="docs-prose mt-8">
        <h2>Claim YT interest, anytime</h2>
        <p>
          Interest builds up on your YT continuously as the Blend rate ticks along. The Portfolio
          page shows what is collectible right now. Claiming pays it out of the protocol&rsquo;s
          escrow as SY, which you can hold or unwrap to USDC. There is no schedule and no
          deadline. One thing worth knowing: claimed interest is <em>realized</em>. Once
          collected, it is yours no matter what happens to rates afterwards.
        </p>
        <p>
          The claimable figure is a snapshot of a live rate, so the executed amount can differ
          slightly from the preview, always equal to it or in your favor, since the rate only
          rises. If nothing has built up since your last claim, the page says{" "}
          <strong>No yield to claim</strong> rather than letting you pay a fee for an empty
          transaction.
        </p>

        <h2>Recombine PT + YT, before maturity</h2>
        <p>
          Equal amounts of PT and YT recombine back into SY at any time before maturity, undoing
          the split exactly. Enter the amount under <strong>Recombine to SY</strong>. The protocol
          burns both tokens, credits any interest your YT had earned to your ledger first, and
          releases the locked SY. Holding unequal amounts? Recombine as much as the smaller side
          allows, then trade the leftover on the <Link href="/docs/guides/trade">Trade page</Link>.
        </p>

        <h2>Redeem PT, after maturity</h2>
        <p>
          Once the market matures, <strong>Redeem PT</strong> pays one USDC of principal per PT,
          priced at the rate frozen at maturity. Redemption stays open indefinitely and the frozen
          rate can never change, so there is no race and nothing gained by rushing. Before
          maturity the button is unavailable; selling PT on the Trade page is the early exit.
        </p>

        <h2>Redeem SY, anytime</h2>
        <p>
          <strong>Redeem SY to underlying</strong> unwraps SY back to USDC at the current exchange
          rate, straight out of the Blend position. This has no maturity attached. It works
          before, at, and after.
        </p>

        <h2>Which action, when</h2>
        <div className="docs-table-scroll">
          <table>
            <thead>
              <tr>
                <th>You hold</th>
                <th>Before maturity</th>
                <th>After maturity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>YT with built-up interest</td>
                <td>Claim as you go</td>
                <td>Final claim of pre-freeze interest</td>
              </tr>
              <tr>
                <td>Equal PT + YT</td>
                <td>Recombine to SY</td>
                <td>Redeem the PT; final-claim the YT</td>
              </tr>
              <tr>
                <td>PT only</td>
                <td>Sell on Trade, or wait</td>
                <td>Redeem one-for-one</td>
              </tr>
              <tr>
                <td>SY</td>
                <td>Unwrap to USDC anytime</td>
                <td>Unwrap to USDC anytime</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <Callout label="Maturity date" signal>
          The live market matures <strong>2026-08-09 15:39 UTC</strong>. YT stops earning at that
          instant; PT redemption opens from it. The freeze mechanics are covered in{" "}
          <Link href="/docs/settlement">Settlement and maturity</Link>.
        </Callout>
      </div>

      <DocsPager current="/docs/guides/claim-redeem" />
    </article>
  );
}
