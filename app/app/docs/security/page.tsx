// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Security and risks" };

export default function SecurityPage() {
  return (
    <article>
      <DocsHeader
        kicker="Reference"
        title="Security and risks"
        summary="What has been verified, what hasn't, what the admin can and cannot do, and the honest list of risks you accept by using an early, unaudited protocol."
      />

      <div className="mt-8">
        <Callout label="Read this first" signal>
          Sidereal has <strong>not</strong> had a professional third-party audit. The contracts
          cannot be changed after deployment, so a defect would be permanent. The mainnet
          deployment holds small, deliberately limited funds. Treat it as early and unaudited, not
          as safe.
        </Callout>
      </div>

      <div className="docs-prose mt-8">
        <h2>What has been done</h2>
        <ul>
          <li>
            <strong>Three internal audit rounds</strong> before mainnet, each with fixes verified
            on-chain against real Blend interest: token-approval lifetimes, unit conversion in the
            YT trade route, withdrawal price floors, the maturity-freeze mechanism, and interest
            settlement on YT transfers, among others.
          </li>
          <li>
            <strong>Randomized property testing:</strong> a 10,000-step test that hammers the
            contracts with random splits, transfers, claims, recombines and redemptions under
            changing rates, checking after every step that the escrow still covers everything it
            owes. The pool math is tested the same way against <code>PT + YT = SY</code>.
          </li>
          <li>
            <strong>Live simulation:</strong> waves of real testnet wallets ran the full lifecycle
            against fresh deployments, and every claimed finding was re-verified against source
            before being recorded. The mainnet deployment itself has run the complete lifecycle
            with real funds.
          </li>
          <li>
            <strong>Reproducible builds:</strong> anyone can rebuild the contracts from the
            recorded source commit and confirm the result matches what is on chain, byte for byte
            (see <Link href="/docs/contracts">Deployed contracts</Link>).
          </li>
          <li>
            <strong>A floating-point tripwire in CI:</strong> Stellar contracts must use
            whole-number math, and the build pipeline fails if any floating-point instruction
            appears, so the pool&rsquo;s arithmetic cannot silently regress.
          </li>
        </ul>
        <p>
          Known issues, all minor and none affecting funds, are tracked publicly in{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/blob/main/findings.md">
            findings.md
          </a>
          .
        </p>

        <h2>What the admin can and cannot do</h2>
        <p>The admin is a single key. Its complete list of powers:</p>
        <ul>
          <li>
            <strong>Can:</strong> re-point the SY wrapper at the same USDC asset under a new Blend
            reserve slot, if Blend ever reshuffles its internal indexing. The contract checks that
            the new slot really holds the same asset, so this lever cannot be aimed anywhere else.
          </li>
          <li>
            <strong>Cannot:</strong> upgrade contracts, move or freeze anyone&rsquo;s funds, set
            or change the exchange rate, mint tokens, pause the market, or change fees. None of
            those entrypoints exist in the deployed code.
          </li>
        </ul>
        <p>
          The production rate path has no human in it: the SY rate is read from the Blend position
          on every interaction, and the deployment tooling refuses to record a deployment
          configured any other way.
        </p>

        <h2>Risk register</h2>
        <div className="docs-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Risk</th>
                <th>Posture</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Contract defect (unaudited code)</td>
                <td>
                  The dominant risk. Immutable contracts make any defect permanent. Testing and
                  internal audits reduce it; nothing eliminates it. Size positions accordingly.
                </td>
              </tr>
              <tr>
                <td>Underlying failure (Blend)</td>
                <td>
                  SY is a Blend position, so a Blend loss is an SY loss. The damage is contained
                  to this one wrapper, and it is priced rather than blocked: PT redemptions cap at
                  each holder&rsquo;s fair share, and PT is paid before YT.
                </td>
              </tr>
              <tr>
                <td>Price-feed manipulation</td>
                <td>
                  There is no external price feed to manipulate. The rate comes from Blend
                  directly, and outside integrators get a 30-minute average with an explicit
                  warming-up flag.
                </td>
              </tr>
              <tr>
                <td>Thin liquidity</td>
                <td>
                  Trades in the current shallow pool move prices sharply. Every swap carries a
                  minimum-received floor, so a stale quote cancels instead of filling badly.
                </td>
              </tr>
              <tr>
                <td>Falling interest rates</td>
                <td>
                  If the Blend rate falls, YT earns less than its price implied. That is the
                  instrument working as designed, not failing: YT is the leveraged side.
                </td>
              </tr>
              <tr>
                <td>Storage rent lapse</td>
                <td>
                  Stellar archives lapsed storage entries rather than deleting them, and a
                  standard network operation restores them. The app tops entries up
                  automatically. Funds cannot be lost this way.
                </td>
              </tr>
              <tr>
                <td>Interest at the maturity boundary</td>
                <td>
                  The freeze pins the last rate recorded at or before maturity. Any small
                  unrecorded tail goes predictably to PT (the senior claim), never to whoever
                  transacts fastest.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Reporting a vulnerability</h2>
        <p>
          Report security findings <strong>privately</strong> via GitHub&rsquo;s{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/security">
            Report a vulnerability
          </a>{" "}
          flow, not as a public issue. See{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/blob/main/SECURITY.md">
            SECURITY.md
          </a>{" "}
          for the policy.
        </p>
      </div>

      <DocsPager current="/docs/security" />
    </article>
  );
}
