// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Tokenizer" };

export default function TokenizerPage() {
  return (
    <article>
      <DocsHeader
        kicker="Protocol design"
        title="Tokenizer"
        summary="The middle layer: it locks up SY, issues and burns PT and YT, pays out interest, and returns principal. Every promise the protocol makes about value is enforced here."
      />

      <div className="docs-prose mt-8">
        <h2>PT and YT are counted in dollars, not shares</h2>
        <p>
          PT and YT are denominated in USDC face value, not in SY tokens. This is what makes PT
          interchangeable between people who split at different times: 1 PT is always a claim on
          exactly 1 USDC of principal at maturity, no matter what the exchange rate was when it was
          created. Splitting <code>n</code> SY when the rate is <code>R</code> creates
        </p>
        <pre>
          <code>pt = yt = n × R    (equal amounts, in USDC face value)</code>
        </pre>
        <p>
          and locks the SY in the tokenizer&rsquo;s vault, called the <strong>escrow</strong>. At a
          rate of exactly 1.00, tokens and dollars coincide. Above 1.00, one SY mints slightly more
          than one of each.
        </p>

        <h2>How PT gets its principal back</h2>
        <p>
          PT is pure principal; it earns nothing along the way. Redeeming <code>pt</code> after
          maturity pays out
        </p>
        <pre>
          <code>sy_out = pt / R_maturity</code>
        </pre>
        <p>
          SY from the escrow, which unwraps to exactly <code>pt</code> USDC. Here{" "}
          <code>R_maturity</code> is the rate frozen at maturity, so nothing that happens to rates
          afterwards can change what PT pays (see{" "}
          <Link href="/docs/settlement">Settlement and maturity</Link>).
        </p>

        <h2>How YT earns: the checkpoint system</h2>
        <p>
          YT collects everything the escrow earns above the principal. The bookkeeping works like a
          water meter: the protocol doesn&rsquo;t need to watch the flow constantly, it just reads
          the meter at the start and the end. Each holder carries a <strong>checkpoint</strong>,
          the exchange rate the last time their interest was tallied. When they are next tallied,
          at rate <code>R</code> with checkpoint <code>c</code>, they are owed
        </p>
        <pre>
          <code>owed = yt_balance × (R − c) / (c × R)</code>
        </pre>
        <p>
          in SY, and the checkpoint advances to <code>R</code>. The exact shape of that formula
          (equivalent to <code>1/c − 1/R</code>) matters: it guarantees that tallying often and
          tallying once at the end produce exactly the same total, so nobody gains or loses by the
          timing of the bookkeeping. A more naive formula would overpay whenever splits happen
          above a rate of 1.00.
        </p>
        <p>A worked example, end to end:</p>
        <ul>
          <li>Deposit 100 USDC at rate 1.00, receive 100 SY, split into 100 PT + 100 YT.</li>
          <li>Over the term, the rate rises to 1.02. The locked 100 SY is now worth 102 USDC.</li>
          <li>
            The YT holder collects <code>100 × (1/1.00 − 1/1.02) = 1.96 SY</code>, which unwraps
            to <strong>2.00 USDC</strong>: the interest.
          </li>
          <li>
            The PT holder redeems <code>100 / 1.02 = 98.04 SY</code>, which unwraps to{" "}
            <strong>100.00 USDC</strong>: the principal.
          </li>
          <li>Paid out: 102.00 USDC. Exactly what the escrow held. Nothing counted twice, nothing stranded.</li>
        </ul>

        <h2>Transfers settle first</h2>
        <p>
          On any YT movement (mint, transfer, burn), both sides are tallied <em>before</em> the
          balance moves. A holder who never collected and then sells keeps the interest they earned
          while holding; it is credited to their personal ledger. The buyer starts earning from the
          moment of the transfer. Buying YT never buys someone else&rsquo;s earned interest, and
          selling never forfeits yours.
        </p>

        <h2>The escrow always covers what it owes</h2>
        <p>At every state change, the protocol maintains:</p>
        <pre>
          <code>escrow value ≥ all PT principal + all uncollected YT interest</code>
        </pre>
        <p>
          The locked SY, valued at the current rate, always covers every PT at full face value plus
          every YT holder&rsquo;s uncollected interest. The property is verified by a 10,000-step
          randomized test that hammers the contracts with random splits, transfers, collections,
          recombines and redemptions under changing rates. And the numbers needed to re-check it
          against the live deployment (escrow size, exchange rate, PT supply) are all publicly
          readable on-chain.
        </p>
        <p>
          One deliberate choice: the contracts <strong>price a shortfall instead of freezing
          up</strong>. An earlier design halted everything the instant coverage slipped even
          microscopically, and a rounding notch smaller than a millionth of a dollar once froze
          every payout in testing. The shipped behavior under a genuine loss:
        </p>
        <ul>
          <li>
            <strong>PT holders come first.</strong> Redemptions are capped at each holder&rsquo;s
            fair share of the escrow. When the escrow is healthy, that cap equals full principal.
            Under a real loss, all PT holders share it proportionally, and nobody gains by
            redeeming faster than everyone else.
          </li>
          <li>
            <strong>YT collections are never blocked.</strong> The math itself is the safety: a
            collection pays zero unless the rate has actually risen past the holder&rsquo;s
            checkpoint. A fallen rate simply pays nothing until it recovers, and the holder keeps
            everything already credited to their ledger.
          </li>
        </ul>
      </div>

      <div className="mt-8">
        <Callout label="Previews are snapshots">
          The app&rsquo;s previews for collecting and recombining read the live rate at the moment
          you ask, and the rate can tick up before your transaction lands. The drift always works
          in your favor or not at all: collections pay at least the preview, and recombining
          returns slightly fewer SY that are each worth slightly more (the value is identical).
        </Callout>
      </div>

      <DocsPager current="/docs/tokenizer" />
    </article>
  );
}
