// SPDX-License-Identifier: Apache-2.0

// Docs navigation data. Plain module (no "use client") so both the client
// sidebar and the server-rendered pager can consume the same source of truth;
// importing this from a client module would hand the server a client-reference
// proxy instead of an array.

export type DocsNavItem = { href: string; label: string };
export type DocsNavGroup = { label: string; items: DocsNavItem[] };

export const DOCS_NAV: DocsNavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/docs", label: "Introduction" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    label: "Concepts",
    items: [
      { href: "/docs/concepts", label: "SY, PT and YT" },
      { href: "/docs/lifecycle", label: "Market lifecycle" },
    ],
  },
  {
    label: "Protocol design",
    items: [
      { href: "/docs/sy-wrapper", label: "SY wrapper" },
      { href: "/docs/tokenizer", label: "Tokenizer" },
      { href: "/docs/amm", label: "AMM and YT routing" },
      { href: "/docs/settlement", label: "Settlement and maturity" },
    ],
  },
  {
    label: "Guides",
    items: [
      { href: "/docs/guides/mint", label: "Deposit and split" },
      { href: "/docs/guides/trade", label: "Trade PT and YT" },
      { href: "/docs/guides/liquidity", label: "Provide liquidity" },
      { href: "/docs/guides/claim-redeem", label: "Claim and redeem" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/docs/contracts", label: "Deployed contracts" },
      { href: "/docs/security", label: "Security and risks" },
      { href: "/docs/faq", label: "FAQ" },
    ],
  },
];

export const DOCS_PAGES: DocsNavItem[] = DOCS_NAV.flatMap((g) => g.items);
