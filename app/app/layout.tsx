// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WalletProvider } from "../lib/wallet";
import { WalletButton } from "../components/WalletButton";
import { DeploymentBanner } from "../components/DeploymentBanner";

export const metadata: Metadata = {
  title: "sidereal",
  description:
    "Split yield-bearing Stellar assets into Principal and Yield tokens, traded through a time-decay AMM.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/mint", label: "Mint" },
  { href: "/trade", label: "Trade" },
  { href: "/redeem", label: "Redeem" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <WalletProvider>
          <header className="border-b border-white/10">
            <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                sidereal
              </Link>
              <ul className="flex flex-1 gap-4 text-sm">
                {NAV.slice(1).map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-slate-300 hover:text-accent">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <WalletButton />
            </nav>
          </header>
          <DeploymentBanner />
          <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
