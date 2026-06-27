// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { Wordmark } from "@/components/Logo";

// Minimal black-and-white marketing chrome: white surface, a quiet top bar, and
// a single full-height hero. The primary action is "Launch App", which opens
// the working app at /trade.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-900">
      <header className="border-b border-black/5">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Sidereal home">
            <Wordmark />
          </Link>
          <Link
            href="/trade"
            className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            Launch App
            <span aria-hidden>→</span>
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>

      <footer className="border-t border-black/5">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 text-sm text-neutral-500">
          <p>© 2026 Sidereal</p>
          <a
            href="https://github.com/PoulavBhowmick03/sidereal"
            className="transition hover:text-neutral-900"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
