// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Introduction" };

export default function IntroductionPage() {
  return (
    <article>
      <DocsHeader
        kicker="Overview"
        title="What is Sidereal?"
        summary="Sidereal is a protocol on Stellar that takes a deposit earning interest and splits it into two tokens you can trade separately: one that locks in a fixed rate, and one that collects the interest as it comes in."
      />

      <div className="docs-prose mt-8">
        <p>
          Start with something familiar. Put money in a savings account and you own two things at
          once: the money you put in (the <strong>principal</strong>) and the stream of interest it
          earns (the <strong>yield</strong>). The interest rate floats. Some months it pays more,
          some months less, and you have no say in it. As long as the two are bundled together, you
          hold both, whether you want both or not.
        </p>
        <p>Sidereal unbundles them. A deposit is split into two tokens:</p>
        <ul>
          <li>
            <strong>PT (Principal Token)</strong> is the deposit itself. Each PT pays back exactly
            one dollar of principal on a fixed date, called the <strong>maturity</strong>. Until
            that date it sells for slightly less than a dollar, so buying PT and simply waiting
            earns a <strong>fixed</strong>, known return. No guessing about where rates go.
          </li>
          <li>
            <strong>YT (Yield Token)</strong> is the interest stream. It collects all the{" "}
            <strong>variable</strong> interest the deposit earns between now and maturity, and you
            can collect it as you go. When maturity arrives the stream ends, and from then on YT is
            worth nothing.
          </li>
        </ul>
        <p>
          Both tokens trade freely, which turns interest rates themselves into something you can
          take a position on. Think rates will fall? Buy PT and lock in today&rsquo;s rate. Think
          rates will rise? Buy YT and collect the upside.
        </p>

        <h2>The one rule everything follows</h2>
        <p>
          Splitting starts from <strong>SY (Standardized Yield)</strong>, which is simply your
          deposit in token form: a receipt that grows in value as interest accrues. The protocol
          keeps one identity true at all times:
        </p>
        <pre>
          <code>PT + YT = SY</code>
        </pre>
        <p>
          Splitting one SY always gives you one PT and one YT. Handing back one PT and one YT
          always gives you the SY back. Nothing is created and nothing is lost by moving between
          the bundled and unbundled forms. The split is a change of packaging, not of value, and
          that is what makes the two halves safe to trade on their own.
        </p>

        <h2>The first market</h2>
        <p>
          The live market is built on the <a href="https://mainnet.blend.capital/">Blend v2</a>{" "}
          USDC lending pool on Stellar mainnet. USDC you deposit is lent out through Blend, and the
          interest borrowers pay is the yield being split. The rate Sidereal reports is read
          straight from the Blend position itself; no person sets it. Each market has a fixed
          maturity date. After it, PT holders take their principal back one-for-one and the market
          winds down.
        </p>

        <h2>How the pieces fit</h2>
        <pre>{`             You
              |  deposit USDC
              v
        SY wrapper          your deposit, as a token (earns Blend interest)
              |  split
              v
         Tokenizer          holds the SY, issues PT and YT
           /      \\
          v        v
        PT          YT
        |            |
   get principal   collect interest
  back at maturity   as it accrues

  One shared market prices PT, SY and YT against each other.`}</pre>
        <p>Each piece has its own page:</p>
        <ul>
          <li>
            <Link href="/docs/concepts">SY, PT and YT</Link>: the three tokens and what each one is
            worth.
          </li>
          <li>
            <Link href="/docs/lifecycle">Market lifecycle</Link>: what happens from deposit to
            maturity, in order.
          </li>
          <li>
            <Link href="/docs/sy-wrapper">SY wrapper</Link>, <Link href="/docs/tokenizer">Tokenizer</Link>,{" "}
            <Link href="/docs/amm">AMM</Link>, and <Link href="/docs/settlement">Settlement</Link>:
            how the machinery works under the hood.
          </li>
          <li>
            <Link href="/docs/guides/mint">Guides</Link>: step-by-step walkthroughs of every action
            in the app.
          </li>
        </ul>

        <h2>Status</h2>
      </div>

      <div className="mt-5">
        <Callout label="Live on mainnet · unaudited" signal>
          Sidereal is live on Stellar mainnet, and the full lifecycle has settled real funds end to
          end. It has <strong>not</strong> had a professional third-party audit, and the contracts
          cannot be changed after deployment, so a defect would be permanent. Treat it as early and
          unaudited, not as safe. See <Link href="/docs/security">Security and risks</Link>.
        </Callout>
      </div>

      <DocsPager current="/docs" />
    </article>
  );
}
