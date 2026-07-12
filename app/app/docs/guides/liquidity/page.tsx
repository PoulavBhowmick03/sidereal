// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Provide liquidity" };

export default function LiquidityGuidePage() {
  return (
    <article>
      <DocsHeader
        kicker="Guides"
        title="Provide liquidity"
        summary="Liquidity providers fill the pool that everyone else trades against, and earn fees for it. This guide covers adding and removing liquidity on the Pool page, what LPs earn, and the honest risks."
      />

      <div className="docs-prose mt-8">
        <h2>What providing liquidity means</h2>
        <p>
          The trading pool needs inventory of both PT and SY to quote prices. Anyone can deposit
          that inventory. In exchange you receive <strong>LP tokens</strong>, a receipt for your
          share of the pool, and every trade that flows through pays a small fee that accrues to
          the pool you now co-own.
        </p>

        <h2>Adding liquidity</h2>
        <p>
          Deposits go in at the pool&rsquo;s current ratio of PT to SY. On the Pool page, enter
          either side (<strong>PT amount</strong> or <strong>SY amount</strong>) and the form
          computes the other. The <strong>Limiting side</strong> label tells you which of your two
          balances runs out first. The preview shows <strong>LP minted</strong>, your{" "}
          <strong>New share</strong> of the pool, and what stays in your wallet.
        </p>
        <p>
          Need PT to pair with your SY? Split some SY first (see{" "}
          <Link href="/docs/guides/mint">Deposit and split</Link>). One split produces the PT leg
          and leaves SY for the other side.
        </p>

        <h2>What LPs earn</h2>
        <ul>
          <li>
            <strong>Trading fees</strong> on every swap in the book, including YT trades, which
            pass through the pool twice and pay twice.
          </li>
          <li>
            <strong>PT&rsquo;s glide to face value.</strong> The PT half of the pool appreciates
            toward one dollar as maturity approaches, by construction. An LP who stays to maturity
            receives the full underlying value of the initial deposit. The temporary paper loss
            that ordinary AMM pools suffer when prices move (known as impermanent loss) exists
            here <em>during</em> the term, but it converges to zero by maturity.
          </li>
        </ul>

        <h2>Removing liquidity</h2>
        <p>
          Enter an <strong>LP amount</strong> (your <strong>LP balance</strong> is shown) and the
          preview quotes <strong>PT received</strong>, <strong>SY received</strong>, and the{" "}
          <strong>Pool share burned</strong>. Withdrawals carry the same protection as swaps: a
          minimum-you-will-accept floor. If trading moves the pool past your tolerance between
          quote and submission, the whole withdrawal cancels itself. There are no partial fills.
        </p>
        <p>
          A cancelled withdrawal still costs its small network fee. If the pool is busy, ask for a
          fresh quote instead of resubmitting a stale one.
        </p>

        <h2>Holding LP across maturity</h2>
        <p>
          At maturity the pool&rsquo;s PT equals SY by definition, so withdrawing at that point is
          clean. Nothing forces you out at the boundary; LP positions can be withdrawn during the
          wind-down after maturity too. LP balances live in rent-paying persistent storage, which
          the app keeps topped up, and even a lapsed entry is archived rather than deleted and can
          be restored (see <Link href="/docs/settlement">Settlement and maturity</Link>).
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Early-market economics" signal>
          In a shallow pool, fees scale with trading volume, and volume is small today. Early LP
          returns come mostly from PT&rsquo;s glide, not fees. The flip side: early liquidity is
          what makes the market usable at all, and your share of the pool is largest while the
          pool is small.
        </Callout>
      </div>

      <DocsPager current="/docs/guides/liquidity" />
    </article>
  );
}
