// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

// Inter is the Roobert substitute for the "cinematic darkroom" system. Light
// (300) carries the whisper-weight display headlines; 400/600 cover body and
// emphasis. Exposed as a CSS variable so Tailwind's font-sans resolves to it.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  variable: "--font-inter",
  display: "swap",
});

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
    <html lang="en" className={`scroll-smooth ${inter.variable}`}>
      <body className="min-h-screen font-sans">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
