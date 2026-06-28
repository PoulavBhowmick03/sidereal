// SPDX-License-Identifier: Apache-2.0

import Image from "next/image";
import metallic from "./metallic.png";

// The metallic render behind the working app screens, dimmed and frosted so it
// reads as atmosphere, never as noise. A backdrop-blur diffuses the chrome
// streaks into soft glows (this both gives the liquid-glass texture and lifts
// legibility), a slow sheen drifts across, and a top-light/bottom-opaque ink
// wash keeps the dense data at full contrast. Fixed, so content scrolls over it.
export function AppBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 animate-mercury-drift">
        <Image src={metallic} alt="" fill sizes="100vw" className="object-cover opacity-60" />
      </div>

      {/* Frosted liquid glass: soften the highlights and drift a faint sheen. */}
      <div className="absolute inset-0 backdrop-blur-[3px]" />
      <div className="absolute inset-0 animate-glass-sheen bg-[radial-gradient(120%_80%_at_70%_8%,rgba(255,255,255,0.07),transparent_55%)]" />

      {/* Proper dimming: sheer at the very top, opaque ink over the data below. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/85 to-ink" />
    </div>
  );
}
