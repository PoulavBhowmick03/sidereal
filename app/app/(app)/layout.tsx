// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { WalletButton } from "@/components/WalletButton";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import { NetworkBanner } from "@/components/NetworkBanner";
import { AppTabs } from "@/components/AppTabs";

// Chrome for the working app: a white, persistent top bar with the in-app tabs,
// wallet connection, and the deployment/network banners.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="shrink-0" aria-label="Back to home">
            <Wordmark />
          </Link>
          <AppTabs />
          <WalletButton />
        </nav>
      </header>
      <DeploymentBanner />
      <NetworkBanner />
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
