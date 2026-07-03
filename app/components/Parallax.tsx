// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/useInView";

/** Scroll-linked layer for the marketing hero. `speed` is the fraction of
 *  scrollY the layer travels (background 0.3, headline 0.12, page content 1.0),
 *  which is what separates the hero into depth planes. `fadeDistance` fades the
 *  layer out over that many scrolled pixels (the scroll cue). rAF-throttled,
 *  passive, disabled under prefers-reduced-motion. */
export function Parallax({
  children,
  className,
  speed = 0,
  fadeDistance,
}: {
  children: React.ReactNode;
  className?: string;
  speed?: number;
  fadeDistance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (speed) el.style.transform = `translate3d(0, ${y * speed}px, 0)`;
        if (fadeDistance) el.style.opacity = String(Math.max(0, 1 - y / fadeDistance));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed, fadeDistance]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
