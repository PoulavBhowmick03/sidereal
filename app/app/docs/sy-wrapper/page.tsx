// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "SY wrapper" };

export default function SyWrapperPage() {
  return (
    <article>
      <DocsHeader
        kicker="Protocol design"
        title="SY wrapper"
        summary="The bottom layer: a vault that turns an interest-earning deposit into a standardized token, so everything above it never needs to know where the interest comes from."
      />

      <div className="docs-prose mt-8">
        <h2>What it does</h2>
        <p>
          The SY wrapper accepts USDC, lends it into the Blend v2 USDC pool, and issues SY tokens
          against the position. Withdrawals do the reverse: burn SY, pull the USDC back out of
          Blend. The design follows OpenZeppelin&rsquo;s Soroban Vault extension, which is the
          Stellar version of a widely used vault standard from Ethereum (ERC-4626).
        </p>
        <p>
          The wrapper&rsquo;s one important export is <code>exchange_rate()</code>: how much USDC
          one SY is worth right now. As the Blend pool earns interest, the rate ticks up. Your SY
          balance never changes by itself; the value of each SY does.
        </p>

        <h2>Where the rate comes from</h2>
        <p>
          The exchange rate is read <strong>directly from the wrapper&rsquo;s position in Blend,
          fresh on every interaction</strong>. It is never cached, and no admin can set it: the
          deployment tooling refuses to record a mainnet deployment configured with a manual rate.
          If the number is wrong, Blend itself is wrong. There is no second data source (no
          &ldquo;oracle&rdquo;, in DeFi terms) that could be manipulated separately.
        </p>
        <p>
          Because the position only lends and never borrows, the rate is one-directional in normal
          operation: interest accrues, so it rises. The case where the underlying pool itself
          suffers a loss is handled explicitly; see{" "}
          <Link href="/docs/settlement">Settlement and maturity</Link> for how a falling rate is
          priced in rather than causing a freeze-up.
        </p>

        <h2>Why wrap at all?</h2>
        <p>
          Blend&rsquo;s own deposit token doesn&rsquo;t expose a clean, vault-style interface, and
          the next yield source (a tokenized treasury fund, a different pool) won&rsquo;t look
          like Blend either. The wrapper flattens every underlying into one simple surface: a
          token count and an exchange rate. The <Link href="/docs/tokenizer">tokenizer</Link> and
          the <Link href="/docs/amm">AMM</Link> are written against that surface only. Neither of
          them knows Blend exists.
        </p>
        <p>
          One SY contract exists per underlying. The live deployment has exactly one:{" "}
          <code>SY-blendUSDC</code>. Adding a future yield source means deploying a new wrapper
          that speaks the same interface, and nothing above it changes.
        </p>

        <h2>Layering</h2>
        <pre>{`Frontend / SDK
      |
  AMM (prices PT, SY, YT)
      |
  Tokenizer (issues PT and YT against locked SY)
      |
  SY wrapper (this page)
      |
  Blend v2 USDC pool`}</pre>
        <p>
          Dependencies flow strictly downward. The wrapper doesn&rsquo;t know about the AMM, and
          the AMM doesn&rsquo;t know about Blend. If an underlying ever fails, the damage stops at
          the wrapper for that one underlying. It cannot spread to other markets.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Rounding behavior">
          Deposits round down by a dust-sized amount in the vault&rsquo;s favor, by design (about
          120 millionths of a USDC on a 0.31 USDC deposit, in live testing). This is standard
          vault hygiene: rounding toward the vault means rounding can never be farmed against it.
        </Callout>
      </div>

      <DocsPager current="/docs/sy-wrapper" />
    </article>
  );
}
