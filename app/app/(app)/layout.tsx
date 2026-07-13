// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { WalletButton } from "@/components/WalletButton";
import { NetworkPill } from "@/components/NetworkPill";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import { NetworkBanner } from "@/components/NetworkBanner";
import { AppTabs } from "@/components/AppTabs";
import { AppBackground } from "@/components/AppBackground";
import { PageTransition } from "@/components/PageTransition";
import { TourHelpButton } from "@/components/TourHelpButton";
import { TourOverlay } from "@/components/TourOverlay";

// Chrome for the working app: a dark, persistent top bar with the in-app tabs,
// an always-on network indicator, wallet connection, the deployment/network
// banners, and a quiet footer. The canvas stays flat ink (no atmospheric
// imagery behind a functional screen).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-ink text-paper">
      <AppBackground />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/90 backdrop-blur-xl">
        <nav className="mx-auto grid max-w-[1280px] grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3 px-4 py-3 sm:flex sm:gap-4 sm:px-6 sm:py-4">
          <Link href="/" className="shrink-0" aria-label="Back to home">
            <Wordmark />
          </Link>
          <AppTabs />
          <div className="flex items-center gap-2 justify-self-end sm:gap-3">
            <NetworkPill />
            <TourHelpButton />
            <WalletButton />
          </div>
        </nav>
      </header>
      <div className="relative z-10 flex flex-1 flex-col">
        <DeploymentBanner />
        <NetworkBanner />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-12 sm:py-16">
          <PageTransition>{children}</PageTransition>
        </main>
        <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-3 px-6 py-8 sm:flex-row sm:items-center">
          <p className="label-data">© 2026 Sidereal Protocol</p>
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/docs" className="label-data transition hover:text-paper">
              Docs
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
      <TourOverlay />
    </div>
  );
}
