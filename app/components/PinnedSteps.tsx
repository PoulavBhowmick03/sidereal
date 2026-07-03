// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";

export type PinnedStep = { n: string; title: string; kicker: string; body: React.ReactNode };

/** Desktop "how it works": the band pins to the viewport for ~2.6 screens of
 *  scroll and one monochrome SVG scene morphs through the three protocol
 *  moments in place: the deposit ring, the split (core shrinks, side circles
 *  emerge on a flow line), then the PT-to-YT timeline. Scroll position picks
 *  the phase; CSS transitions carry the morph (see the .ps-* rules in
 *  globals.css). The stacked sections remain the mobile and reduced-motion
 *  rendering, so this component is only mounted at lg and up. All copy for
 *  every phase stays in the DOM (inactive blocks are visually hidden), so
 *  crawlers and find-in-page still see the full text. */
export function PinnedSteps({ steps }: { steps: PinnedStep[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const total = el.offsetHeight - window.innerHeight;
        if (total <= 0) return;
        const p = Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total));
        setPhase(p < 1 / 3 ? 1 : p < 2 / 3 ? 2 : 3);
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
    <div ref={wrapRef} className="pinned-steps relative h-[240vh]" data-phase={phase}>
      <div
        className={`sticky top-0 flex h-screen items-center overflow-hidden transition-colors duration-700 ${
          phase === 2 ? "bg-carbon" : "bg-transparent"
        }`}
      >
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-10 px-6 sm:px-16 lg:grid-cols-2">
          {/* Copy: all three blocks stacked, the active one visible. */}
          <div className="relative">
            {steps.map((step, i) => {
              const active = phase === i + 1;
              return (
                <div
                  key={step.n}
                  aria-hidden={!active}
                  className={`transition-all duration-700 ease-out ${
                    i > 0 ? "absolute inset-0" : ""
                  } ${active ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-4"}`}
                >
                  <span className="block text-8xl font-light leading-none text-white/20 sm:text-9xl">
                    {step.n}
                  </span>
                  <h2 className="mt-6 text-3xl font-light tracking-tight sm:text-4xl">{step.title}</h2>
                  <p className="mt-2 label-data">{step.kicker}</p>
                  <p className="mt-6 max-w-md leading-relaxed text-smoke">{step.body}</p>
                </div>
              );
            })}

            {/* Phase rail: which of the three moments is pinned. */}
            <div className="mt-10 flex items-center gap-2">
              {steps.map((step, i) => (
                <span
                  key={step.n}
                  className={`h-px transition-all duration-500 ${
                    phase === i + 1 ? "w-10 bg-paper" : "w-5 bg-white/25"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* The morphing scene. */}
          <div className="flex justify-center lg:justify-end">
            <svg viewBox="0 0 320 240" className="h-64 w-[22rem]" aria-hidden="true">
              {/* Flow line, grown from the center. */}
              <rect x="30" y="119.5" width="260" height="1" fill="#6D6D6D" className="ps-el ps-line" />
              {/* Deposit ring: shrinks left into the split's SY circle. */}
              <circle cx="160" cy="120" r="92" fill="none" stroke="#6D6D6D" strokeWidth="1" className="ps-el ps-ring" />
              {/* White core: the deposit, then the split's center, then PT. */}
              <circle cx="160" cy="120" r="46" fill="#FFFFFF" className="ps-el ps-core" />
              {/* Right circle: YT emerging, then fading into the endpoint dot. */}
              <circle cx="260" cy="120" r="34" fill="none" stroke="#9A9A9A" strokeWidth="1" className="ps-el ps-right" />
              <circle cx="290" cy="120" r="6" fill="#9A9A9A" className="ps-el ps-right-dot" />
              {/* Timeline dressing. */}
              <circle cx="30" cy="120" r="4" fill="#9A9A9A" className="ps-traveler" />
              <text x="30" y="152" fill="#6D6D6D" fontSize="13" textAnchor="middle" className="ps-el ps-label">
                PT fixed
              </text>
              <text x="290" y="152" fill="#6D6D6D" fontSize="13" textAnchor="middle" className="ps-el ps-label">
                YT variable
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
