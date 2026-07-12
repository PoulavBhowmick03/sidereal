// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Deployed contracts" };

const EXPLORER = "https://stellar.expert/explorer/public/contract";

const MAINNET_CONTRACTS: { name: string; id: string; note: string }[] = [
  {
    name: "SY wrapper",
    id: "CCLFK26PU5GNMCUAGBBBGKVXE6GWYA2PB3RFTC7Y5HRVPPBRGWYUZKUU",
    note: "USDC in, SY shares out; supplies the Blend v2 pool",
  },
  {
    name: "PT token",
    id: "CDZ2M6DWIVY6KFJSFEA5KWIDQUDEGFEDQ5XMJPITAVBYLNGFEYLBRMSX",
    note: "SEP-41; mint/burn gated to the tokenizer",
  },
  {
    name: "YT token",
    id: "CDJIC6JKQ7J5G3KUNRPFXQYNFWVTADCDFWHROSMCI36TVN2ATGIIYFRJ",
    note: "SEP-41; settles yield on every balance change",
  },
  {
    name: "Tokenizer",
    id: "CBMB52N4XDAFRQRQ4MYGRPFUS3DDREWYY45VWWXEJSPITE5XH7DXEHBX",
    note: "Escrows SY; split, recombine, claim, redeem",
  },
  {
    name: "PT/SY AMM",
    id: "CDA4HVNGSQ52DCGRYQIE5JKSNWCFTH4FEANHPLWB2U32EXGP36DGZVJK",
    note: "Time-decay pool; YT routes through it",
  },
  {
    name: "USDC (Circle SAC)",
    id: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    note: "The underlying asset",
  },
  {
    name: "Blend v2 FixedV2 pool",
    id: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
    note: "The yield source",
  },
];

export default function ContractsPage() {
  return (
    <article>
      <DocsHeader
        kicker="Reference"
        title="Deployed contracts"
        summary="Mainnet contract addresses for the live market, the current market parameters, and how to verify that the deployed bytecode matches the public source."
      />

      <div className="docs-prose mt-8">
        <h2>Mainnet</h2>
        <p>
          Deployed 2026-07-11 from commit <code>67151f8</code> against Blend v2&rsquo;s{" "}
          <code>FixedV2</code> USDC pool.
        </p>
      </div>

      <div className="docs-table-scroll mt-5">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className="border-b border-white/15 py-2 pr-4 text-left font-medium text-paper">
                Component
              </th>
              <th className="border-b border-white/15 py-2 pr-4 text-left font-medium text-paper">
                Contract
              </th>
            </tr>
          </thead>
          <tbody>
            {MAINNET_CONTRACTS.map((c) => (
              <tr key={c.id}>
                <td className="border-b border-white/10 py-3 pr-4 align-top">
                  <p className="text-paper">{c.name}</p>
                  <p className="mt-0.5 text-[13px] text-ash">{c.note}</p>
                </td>
                <td className="border-b border-white/10 py-3 pr-4 align-top">
                  <a
                    href={`${EXPLORER}/${c.id}`}
                    className="break-all font-mono text-[12px] text-smoke underline decoration-white/20 underline-offset-4 transition hover:text-paper hover:decoration-paper"
                  >
                    {c.id}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="docs-prose mt-10">
        <h2>Current market parameters</h2>
        <ul>
          <li>
            <strong>Underlying:</strong> Circle USDC, supplied to the Blend v2 FixedV2 pool.
          </li>
          <li>
            <strong>Maturity:</strong> 2026-08-09 15:39 UTC (a 30-day first cycle).
          </li>
          <li>
            <strong>Decimals:</strong> 7 (Stellar-native), with rate math in 18-decimal WAD.
          </li>
          <li>
            <strong>Swap fee:</strong> 0.1% on PT↔SY swaps, configured at deployment.
          </li>
          <li>
            <strong>TWAP window:</strong> 30 minutes.
          </li>
        </ul>
        <p>
          The full parameter-selection record (why each value is what it is) is public at{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/blob/main/docs/deploy/MAINNET_PARAMETERS.md">
            docs/deploy/MAINNET_PARAMETERS.md
          </a>
          .
        </p>

        <h2>Verifying the deployment</h2>
        <p>
          The contracts are built reproducibly: the manifest at{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/blob/main/deployments/mainnet.toml">
            deployments/mainnet.toml
          </a>{" "}
          records the source commit and the wasm hash of every contract, and anyone can rebuild
          from that commit and compare against the on-chain hash:
        </p>
        <pre>
          <code>{`git checkout 67151f8
bash scripts/verify-reproducible-build.sh \\
  --manifest deployments/mainnet.toml`}</code>
        </pre>
        <p>
          The process and its guarantees are documented in{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/blob/main/docs/deploy/PROVENANCE.md">
            docs/deploy/PROVENANCE.md
          </a>
          . CI enforces manifest drift checks, so the recorded provenance stays honest against the
          repository.
        </p>

        <h2>Admin surface</h2>
        <p>
          The contracts are <strong>immutable</strong>: there is no upgrade entrypoint. The single
          admin key holds exactly one post-deploy power: a constrained reserve-index migration that
          can re-point the SY wrapper at the same underlying asset under a new Blend reserve slot.
          The migration validates the new index&rsquo;s asset against the configured underlying, so
          it cannot redirect funds, reprice, or mint. Details in{" "}
          <Link href="/docs/security">Security and risks</Link>.
        </p>

        <h2>Testnet</h2>
        <p>
          A parallel testnet deployment exists for development, generated from the manifest at{" "}
          <a href="https://github.com/PoulavBhowmick03/sidereal/blob/main/deployments/testnet.toml">
            deployments/testnet.toml
          </a>
          . It is not canonical now that mainnet is live.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Address drift">
          The app reads its contract addresses from environment configuration at build time. If
          this page and the app banner ever disagree, the deployment manifest in the repository is
          the source of truth.
        </Callout>
      </div>

      <DocsPager current="/docs/contracts" />
    </article>
  );
}
