// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

type Variant = "rise" | "left" | "right";

const HIDDEN: Record<Variant, string> = {
  rise: "opacity-0 translate-y-4",
  left: "opacity-0 -translate-x-6",
  right: "opacity-0 translate-x-6",
};

/** Scroll-triggered reveal. Server-rendered fully visible (SEO, no-JS, and the
 *  e2e text assertions all see the final state); after mount, motion-capable
 *  clients arm the hidden state and transition in when the element scrolls
 *  into view. `delay` (ms) staggers siblings. */
export function Reveal({
  children,
  className = "",
  variant = "rise",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: Variant;
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  const hidden = armed && !inView;
  return (
    <div
      ref={ref}
      className={`${className} ${
        hidden ? HIDDEN[variant] : "translate-x-0 translate-y-0 opacity-100"
      } transition-all duration-700 ease-out`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
