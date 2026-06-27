// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

export const metadata: Metadata = {
  title: "Sidereal, split, fix, and trade Stellar yield",
  description:
    "Split a yield-bearing Stellar asset into a Principal Token that redeems 1:1 at maturity and a Yield Token that streams yield. Trade both through a time-decay AMM priced by an internal TWAP.",
};

// The root layout only owns the document shell and wallet context. The
// marketing surface and the working app each provide their own chrome via
// route-group layouts, so the landing page is not boxed into the app frame.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="min-h-screen">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
