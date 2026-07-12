// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { Atmosphere } from "@/components/Atmosphere";
import { Grain } from "@/components/Grain";
import { DocsSidebar } from "@/components/DocsSidebar";

export const metadata: Metadata = {
  title: {
    template: "%s · Sidereal Docs",
    default: "Documentation · Sidereal",
  },
  description:
    "How Sidereal splits yield-bearing positions on Stellar into principal and yield tokens: concepts, protocol design, guides, and contract reference.",
};

// Docs chrome: the marketing route's star-chart atmosphere (gradient sky,
// star speckle, chart rings, nebulae) fixed at z-0, with the reading surface
// at z-10 above it. A quiet persistent top bar and a sticky section rail
// carry the navigation; the content column is capped for measure.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col text-paper">
      <Atmosphere />
      <Grain className="fixed inset-0 z-0" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="Sidereal home">
              <Wordmark />
            </Link>
            <span className="hidden border-l border-white/15 pl-4 label-data sm:inline">Docs</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/PoulavBhowmick03/sidereal"
              className="label-data transition hover:text-paper"
            >
              GitHub
            </a>
            <Link
              href="/trade"
              className="rounded-pill bg-paper px-5 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink transition hover:bg-smoke"
            >
              Launch App
            </Link>
          </div>
        </nav>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-0 px-6 lg:flex-row lg:gap-12">
        <DocsSidebar />
        <main className="min-w-0 max-w-3xl flex-1 py-10 lg:py-14">{children}</main>
      </div>

      <footer className="relative z-10 border-t border-white/10 bg-ink/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-3 px-6 py-8 sm:flex-row sm:items-center">
          <p className="label-data">© 2026 Sidereal Protocol</p>
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/" className="label-data transition hover:text-paper">
              Home
            </Link>
            <a
              href="https://github.com/PoulavBhowmick03/sidereal"
              className="label-data transition hover:text-paper"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
