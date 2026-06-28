// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";

// Scroll-linked parallax on the oversized step numerals (01/02/03). Each numeral
// drifts vertically as its band passes through the viewport, so the editorial
// "how it works" sections gain depth against the static copy beside them.
// rAF-throttled, passive listener, and disabled under prefers-reduced-motion.
export function StepNumeral({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = el.getBoundingClientRect();
        // -0.5 (entering from the bottom) .. +0.5 (leaving at the top), 0 when
        // centered. Multiply hard so the numeral travels ~200px against its
        // column: subtle drift reads as nothing, this reads as parallax.
        const progress = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
        el.style.transform = `translate3d(0, ${progress * -200}px, 0)`;
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
    <span
      ref={ref}
      className="block text-8xl font-light leading-none text-white/20 will-change-transform sm:text-9xl"
    >
      {children}
    </span>
  );
}
