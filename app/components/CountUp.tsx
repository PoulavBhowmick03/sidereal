// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

/** Counts every digit run in `value` up from zero when the element scrolls
 *  into view, preserving leading-zero padding ("01" ticks 00 -> 01, "1:1"
 *  ticks both sides). Server render and reduced motion show the final value
 *  immediately. Pair with tabular-nums so nothing shifts while counting. */
export function CountUp({
  value,
  className,
  duration = 1400,
}: {
  value: string;
  className?: string;
  duration?: number;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.5);
  const [text, setText] = useState(value);

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;
    if (!/\d/.test(value)) return;

    let raf = 0;
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setText(
        value.replace(/\d+/g, (run) =>
          String(Math.round(parseInt(run, 10) * easeOut(p))).padStart(run.length, "0"),
        ),
      );
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
