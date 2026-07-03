// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";

export type SlideRect = { left: number; top: number; width: number; height: number };

/** Measures the element matching `selector` inside the returned container,
 *  relative to the container, re-measuring when `dep` changes or the container
 *  resizes. Drives the sliding active indicators (tab underline, direction
 *  highlight): the indicator is one absolutely positioned element whose
 *  left/top/size transition between measurements instead of teleporting.
 *  Returns null until measured, so callers can keep a static fallback for
 *  server render and no-JS. */
export function useSlideRect<T extends HTMLElement>(selector: string, dep: unknown) {
  const containerRef = useRef<T | null>(null);
  const [rect, setRect] = useState<SlideRect | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(selector);
      if (!active) {
        setRect(null);
        return;
      }
      const c = el.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      setRect({ left: a.left - c.left, top: a.top - c.top, width: a.width, height: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selector, dep]);

  return { containerRef, rect };
}
