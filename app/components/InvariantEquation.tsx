// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

/** The protocol invariant, assembled on scroll: PT slides in from the left,
 *  YT from the right, they meet at the plus, then "= SY" resolves. The spans
 *  keep literal spaces between them so the rendered text stays exactly
 *  "PT + YT = SY" (the e2e smoke test asserts on it). Server render and
 *  reduced motion both show the finished equation. */
export function InvariantEquation() {
  const { ref, inView } = useInView<HTMLParagraphElement>(0.5);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  const hidden = armed && !inView;
  const part = (extra: string) =>
    `inline-block transition-all duration-700 ease-out ${
      hidden ? extra : "translate-x-0 opacity-100"
    }`;
  const style = (delay: number) => ({ transitionDelay: `${delay}ms` });

  return (
    <p ref={ref} className="text-center text-4xl font-light tracking-tight sm:text-6xl">
      <span className={part("-translate-x-8 opacity-0")} style={style(0)}>
        PT
      </span>{" "}
      <span className={part("opacity-0")} style={style(250)}>
        +
      </span>{" "}
      <span className={part("translate-x-8 opacity-0")} style={style(0)}>
        YT
      </span>{" "}
      <span className={part("opacity-0")} style={style(500)}>
        =
      </span>{" "}
      <span className={part("opacity-0")} style={style(650)}>
        SY
      </span>
    </p>
  );
}
