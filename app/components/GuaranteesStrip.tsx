// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { KickerWipe } from "@/components/KickerWipe";
import { WordReveal } from "@/components/WordReveal";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

const GUARANTEES = [
  {
    index: "01",
    title: "Internal TWAP only",
    body: "No external oracle enters the AMM pricing path.",
  },
  {
    index: "02",
    title: "Recombination enforced",
    body: "One PT plus one YT always recombines into one SY through the tokenizer.",
  },
  {
    index: "03",
    title: "Client-side signing",
    body: "Every transaction is reviewed and signed by the user before submission.",
  },
  {
    index: "04",
    title: "Open source",
    body: "The protocol is published under the Apache-2.0 license.",
  },
];

export function GuaranteesStrip() {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  const hidden = armed && !inView;
  const ready = armed && inView;

  return (
    <section className="relative bg-transparent">
      <div className="mx-auto max-w-[1280px] px-6 py-24 sm:px-16 sm:py-32">
        <KickerWipe className="label-data">Design / Guarantees</KickerWipe>
        <h2 className="mt-5 max-w-2xl text-4xl font-light tracking-tight sm:text-5xl">
          <WordReveal>Built into the protocol</WordReveal>
        </h2>

        <div
          ref={ref}
          className={`relative mt-14 pl-8 sm:pl-14 ${ready ? "guarantees-ready" : ""}`}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-px origin-top bg-white/20 transition-transform duration-[1500ms] ease-out"
            style={{ transform: hidden ? "scaleY(0)" : "scaleY(1)" }}
          />

          {GUARANTEES.map((guarantee, index) => (
            <div
              key={guarantee.index}
              className="relative grid gap-4 border-b border-white/10 py-8 sm:grid-cols-[8rem_1fr] sm:items-center sm:py-10"
            >
              <span
                aria-hidden
                className="absolute -left-[2.15rem] top-10 sm:-left-[3.7rem] sm:top-1/2 sm:-translate-y-1/2"
              >
                <span
                  className="diag-pop block h-2 w-2 bg-paper"
                  style={
                    hidden
                      ? { opacity: 0, transform: "scale(0)" }
                      : { animationDelay: `${300 + index * 200}ms` }
                  }
                />
              </span>
              <span className="text-6xl font-light leading-none text-white/20 sm:text-7xl">
                {guarantee.index}
              </span>
              <div>
                <h3 className="text-xl font-light tracking-tight sm:text-2xl">
                  {guarantee.title}
                </h3>
                <p className="mt-2 max-w-2xl leading-relaxed text-smoke">{guarantee.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
