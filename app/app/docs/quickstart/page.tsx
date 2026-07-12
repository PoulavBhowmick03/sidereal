// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Quickstart" };

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Connect a wallet",
    body: (
      <>
        Open the app and connect a Stellar wallet (Freighter or any wallet the connect dialog
        offers). You need USDC and a little XLM to pay network fees, which are a fraction of a
        cent per transaction.
      </>
    ),
  },
  {
    title: "Deposit USDC",
    body: (
      <>
        On the <strong>Mint</strong> page, deposit USDC. The protocol lends it out through the
        Blend v2 pool and gives you SY in return. SY is your deposit as a token: it grows in value
        as the lending interest comes in.
      </>
    ),
  },
  {
    title: "Split into PT and YT",
    body: (
      <>
        Split your SY. The protocol locks it up and gives you equal amounts of PT and YT. You now
        hold the fixed side and the floating side of your own deposit as two separate tokens.
      </>
    ),
  },
  {
    title: "Take a position",
    body: (
      <>
        Hold both and you are exactly where you started, since PT + YT = SY. To take a view, use
        the <strong>Trade</strong> page: sell your YT to keep only PT (a locked, fixed rate), or
        sell your PT to keep only YT (a bet that rates go up). You can also{" "}
        <strong>recombine</strong> equal PT and YT back into SY at any time before maturity.
      </>
    ),
  },
  {
    title: "Collect",
    body: (
      <>
        YT holders collect their accrued interest on the <strong>Portfolio</strong> page whenever
        they like; there is no need to wait for maturity. PT holders get their principal back
        one-for-one on the same page once the market matures.
      </>
    ),
  },
];

export default function QuickstartPage() {
  return (
    <article>
      <DocsHeader
        kicker="Overview"
        title="Quickstart"
        summary="The whole protocol in five steps: deposit, split, position, collect. Each step links to a full guide."
      />

      <ol className="mt-8 flex flex-col">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-6 border-b border-white/10 py-6 last:border-b-0">
            <span className="label-data mt-1 shrink-0 tabular-nums">0{i + 1}</span>
            <div>
              <h2 className="text-base font-semibold text-paper">{step.title}</h2>
              <p className="mt-2 text-[15px] leading-7 text-smoke [&_strong]:font-semibold [&_strong]:text-paper">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="docs-prose mt-10">
        <h2>Where to next</h2>
        <ul>
          <li>
            New to yield splitting? Read <Link href="/docs/concepts">SY, PT and YT</Link> first. It
            explains what each token is actually worth, in plain terms.
          </li>
          <li>
            Ready to act? The <Link href="/docs/guides/mint">Deposit and split guide</Link> walks
            through the Mint page field by field.
          </li>
          <li>
            Want the machinery? Start at the <Link href="/docs/sy-wrapper">SY wrapper</Link> and
            read the Protocol design section in order.
          </li>
        </ul>
      </div>

      <div className="mt-8">
        <Callout label="Liquidity note" signal>
          The mainnet market is newly seeded, so the trading pool is still small. Depositing,
          splitting, collecting and redeeming work at any size. Trades, however, move the price
          sharply while the pool is shallow, so check the quoted price impact before swapping. See{" "}
          <Link href="/docs/amm">AMM and YT routing</Link>.
        </Callout>
      </div>

      <DocsPager current="/docs/quickstart" />
    </article>
  );
}
