// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { prefersReducedMotion } from "@/lib/useInView";

/** Inertia scrolling for the marketing pages. Lenis smooths the native scroll
 *  position (no transform hijack), so every scroll-linked effect on the page
 *  (pinned steps, reveal footer, parallax, nav inversion) keeps reading real
 *  window scroll events. Touch keeps its native feel, reduced motion gets the
 *  browser default, and in-page anchor clicks route through Lenis so nav
 *  links glide instead of jumping. */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const lenis = new Lenis({ lerp: 0.1 });
    let raf = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    });

    // Capture phase, so preventDefault lands before Next's Link runs its own
    // instant hash scroll; otherwise anchor clicks jump first, then glide.
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const hash = anchor?.getAttribute("href");
      if (!hash || hash === "#") return;
      const target = document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement);
    };
    document.addEventListener("click", onClick, { capture: true });

    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return null;
}
