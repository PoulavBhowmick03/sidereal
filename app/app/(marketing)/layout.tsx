// SPDX-License-Identifier: Apache-2.0

import { Wordmark } from "@/components/Logo";
import { MarketingNav } from "@/components/MarketingNav";
import { RevealFooter } from "@/components/RevealFooter";
import { FooterBrand } from "@/components/FooterBrand";
import { Atmosphere } from "@/components/Atmosphere";
import { Grain } from "@/components/Grain";
import { RollingLink } from "@/components/RollingLink";
import { SmoothScroll } from "@/components/SmoothScroll";

// Marketing chrome for the "cinematic darkroom" landing: a fixed atmospheric
// canvas, a quiet top bar that inverts on scroll, and the existing reveal
// footer. The primary action is "Launch App", which opens the app at /trade.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col text-paper">
      <SmoothScroll />
      <MarketingNav />

      <main className="marketing-main relative z-10 flex flex-1 flex-col overflow-clip bg-transparent">
        <Atmosphere />
        <Grain className="fixed inset-0 z-0" />
        <div className="relative z-10 flex flex-1 flex-col">{children}</div>
      </main>

      <RevealFooter>
        <div className="hairline" />
        <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-10 sm:px-16">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <Wordmark />
            <div className="flex flex-wrap items-center gap-6">
              <RollingLink
                href="https://github.com/PoulavBhowmick03/sidereal"
                className="label-data transition hover:text-paper"
              >
                GitHub
              </RollingLink>
              <RollingLink
                href="https://github.com/PoulavBhowmick03/sidereal/blob/main/docs/DEMO.md"
                className="label-data transition hover:text-paper"
              >
                Docs
              </RollingLink>
              <span className="label-data">Blend USDC · Testnet</span>
            </div>
          </div>
          <p className="border-t border-white/10 pt-6 text-[13px] text-ash">
            © 2026 Sidereal Protocol. All rights reserved.
          </p>
        </div>
        <FooterBrand />
      </RevealFooter>
    </div>
  );
}
