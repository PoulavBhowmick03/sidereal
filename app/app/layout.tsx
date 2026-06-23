// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

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
        <header className="border-b border-white/10">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              sidereal
            </Link>
            <ul className="flex gap-4 text-sm">
              {NAV.slice(1).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-slate-300 hover:text-accent">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
