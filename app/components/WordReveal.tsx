// SPDX-License-Identifier: Apache-2.0

"use client";

import { Fragment, useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

export function WordReveal({ children }: { children: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  const hidden = armed && !inView;
  const words = children.split(" ");

  return (
    <span ref={ref}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          {index > 0 ? " " : null}
          <span className="inline-block overflow-hidden align-bottom">
            <span
              className={`inline-block transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                hidden ? "translate-y-[110%]" : "translate-y-0"
              }`}
              style={{ transitionDelay: `${index * 40}ms` }}
            >
              {word}
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}
