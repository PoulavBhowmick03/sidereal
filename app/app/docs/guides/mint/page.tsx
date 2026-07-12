// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Deposit and split" };

export default function MintGuidePage() {
  return (
    <article>
      <DocsHeader
        kicker="Guides"
        title="Deposit and split"
        summary="The Mint page turns USDC into SY, and SY into PT + YT. This guide walks the flow and explains what each number on the page means."
      />

      <div className="docs-prose mt-8">
        <h2>Before you start</h2>
        <ul>
          <li>A connected Stellar wallet holding USDC (Circle&rsquo;s USDC on mainnet).</li>
          <li>
            A small XLM balance for network fees. Each transaction costs a fraction of a cent.
          </li>
        </ul>

        <h2>Step 1: deposit USDC for SY</h2>
        <p>
          Enter an amount in <strong>Amount (USDC)</strong>. Your <strong>Wallet USDC
          balance</strong> is shown next to the field. On submit, the protocol takes the USDC,
          lends it into the Blend v2 pool, and credits SY to your wallet at the current exchange
          rate.
        </p>
        <p>
          The SY amount can be marginally below the USDC amount when the exchange rate is above
          1.00. That is the rate math, not a fee: your SY is worth what you put in. The protocol
          charges nothing to deposit.
        </p>

        <h2>Step 2: split SY into PT + YT</h2>
        <p>
          Splitting locks your SY with the protocol and credits you equal amounts of{" "}
          <strong>PT</strong> and <strong>YT</strong>. The page offers a combined flow,{" "}
          <strong>Deposit, then split (2 signatures)</strong>, which signs the deposit and the
          split back to back. You can also split SY you already hold.
        </p>
        <p>
          The amounts follow the rate: splitting <code>n</code> SY at exchange rate <code>R</code>{" "}
          gives you <code>n × R</code> of each token, counted in USDC face value. The preview
          shows both amounts before you sign anything.
        </p>

        <h2>Step 3: decide what you now hold</h2>
        <p>
          The split by itself changes nothing about what you own; it just makes the halves
          sellable. Three stances from here:
        </p>
        <ul>
          <li>
            <strong>Hold both.</strong> Economically identical to holding SY. A useful staging
            position, since you can sell either side at any moment without another split.
          </li>
          <li>
            <strong>Keep PT, sell YT.</strong> You have locked in a fixed rate. The YT sale is
            your interest, taken up front in cash; the PT pays full face value at maturity. See{" "}
            <Link href="/docs/guides/trade">Trade PT and YT</Link>.
          </li>
          <li>
            <strong>Keep YT, sell PT.</strong> You have concentrated into pure interest exposure,
            using only a fraction of the capital.
          </li>
        </ul>

        <h2>Reading the yield-choice card</h2>
        <p>The Mint page frames the same decision as two rates:</p>
        <ul>
          <li>
            <strong>Fixed</strong>: the yearly rate you lock by holding PT to maturity, implied by
            PT&rsquo;s current price.
          </li>
          <li>
            <strong>Variable</strong>: the Blend pool&rsquo;s current lending rate, which is what
            YT collects as it floats.
          </li>
        </ul>
        <p>
          If the fixed number looks better to you than your best guess about the variable one,
          that comparison is the whole trade.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Undo is always available">
          Split and recombine are exact opposites. Equal amounts of PT and YT recombine back into
          SY at any time before maturity, from the{" "}
          <Link href="/docs/guides/claim-redeem">Portfolio page</Link>. You are never locked into
          the split form.
        </Callout>
      </div>

      <DocsPager current="/docs/guides/mint" />
    </article>
  );
}
