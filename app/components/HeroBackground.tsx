// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

// Marketing hero background. The "mercury flow" render now carries three layers
// of motion so it is alive even at rest: a continuous CSS drift, a continuous
// SVG turbulence displacement (the "liquid" warp, always on, not scroll-gated),
// and a drifting frosted-glass sheen for the liquid-glass texture. A gentle
// scroll parallax sits on top for depth. The liquid/glass motion runs always;
// only the scroll parallax respects prefers-reduced-motion. Atmospheric imagery
// like this is for the marketing hero ONLY, never behind an app screen.
export function HeroBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.transform = `translate3d(0, ${window.scrollY * 0.3}px, 0)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="absolute inset-0 will-change-transform">
      {/* Always-on liquid warp: animated fractal turbulence displaces the render
          continuously, independent of scroll. */}
      <svg className="absolute h-0 w-0" aria-hidden focusable="false">
        <defs>
          <filter id="liquid-glass" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.005 0.009"
              numOctaves="2"
              seed="7"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                dur="22s"
                values="0.005 0.009;0.009 0.005;0.005 0.009"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="34"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <div
        className="absolute inset-0 animate-mercury-drift"
        style={{ filter: "url(#liquid-glass)" }}
      >
        <Image src="/hero.png" alt="" fill priority sizes="100vw" className="object-cover" />
      </div>

      {/* Frosted glass: a translucent blur over the flowing render, plus a
          slow drifting specular highlight, gives the liquid-glass texture. */}
      <div className="absolute inset-0 backdrop-blur-[2px]" />
      <div className="absolute inset-0 animate-glass-sheen bg-[radial-gradient(120%_90%_at_28%_18%,rgba(255,255,255,0.12),transparent_55%)]" />

      {/* Legibility wash for the hero copy. The metallic render is already near
          black, so the wash is light: dark enough to seat the headline, sheer
          enough that the chrome streaks read through the middle. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/65 via-ink/20 to-ink" />
    </div>
  );
}
