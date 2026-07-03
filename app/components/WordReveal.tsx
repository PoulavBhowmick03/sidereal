// SPDX-License-Identifier: Apache-2.0

"use client";

import { Fragment, useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

/** Word-by-word mask reveal for display headings. Whitespace is preserved as
 *  real text nodes, so textContent stays exactly the input string.
 *
 *  `brightWords` two-tones the heading: listed word indices render paper,
 *  the rest smoke, putting the sentence's weight on the words that carry it.
 *  Omit it to inherit the parent color. */
export function WordReveal({
  children,
  brightWords,
}: {
  children: string;
  brightWords?: number[];
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  const hidden = armed && !inView;
  const words = children.split(" ");
  const tone = (index: number) =>
    brightWords === undefined ? "" : brightWords.includes(index) ? "text-paper" : "text-smoke";

  return (
    <span ref={ref}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          {index > 0 ? " " : null}
          <span className="inline-block overflow-hidden align-bottom">
            <span
              className={`inline-block transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${tone(
                index,
              )} ${hidden ? "translate-y-[110%]" : "translate-y-0"}`}
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
