// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

// Monochrome diagrams for the landing "how it works" steps, animated when they
// scroll into view: step 01 draws its ring and pulses a deposit ripple, step 02
// splits (the circles pop in around a marching flow line), step 03 sends a dot
// travelling the PT-to-YT timeline. Amber stays reserved for live signals, so
// all motion here is paper/ash only. The server renders the finished static
// diagram; reduced-motion and no-JS visitors keep exactly that.

function DiagramFrame({ children }: { children: React.ReactNode }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  return (
    <div ref={ref} className={armed && inView ? "diagram-anim" : undefined}>
      {children}
    </div>
  );
}

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });
const len = (n: number) => ({ "--len": String(n) }) as React.CSSProperties;

export function StepDiagram({ n }: { n: string }) {
  if (n === "01") {
    // Outer ring circumference: 2 * pi * 92.
    return (
      <DiagramFrame>
        <svg viewBox="0 0 240 240" className="h-48 w-48" aria-hidden="true">
          <circle
            cx="120"
            cy="120"
            r="92"
            fill="none"
            stroke="#6D6D6D"
            strokeWidth="1"
            className="diag-draw"
            style={len(579)}
          />
          <circle cx="120" cy="120" r="46" fill="#FFFFFF" className="diag-pop" style={delay(600)} />
          <circle
            cx="120"
            cy="120"
            r="46"
            fill="none"
            stroke="#6D6D6D"
            strokeWidth="1"
            className="diag-ripple"
          />
        </svg>
      </DiagramFrame>
    );
  }
  if (n === "02") {
    // Side circles circumference: 2 * pi * 34.
    return (
      <DiagramFrame>
        <svg viewBox="0 0 320 160" className="h-40 w-72" aria-hidden="true">
          <line x1="60" y1="80" x2="260" y2="80" stroke="#6D6D6D" strokeWidth="1" className="diag-march" />
          <circle
            cx="60"
            cy="80"
            r="34"
            fill="none"
            stroke="#6D6D6D"
            strokeWidth="1"
            className="diag-draw"
            style={{ ...len(214), ...delay(150) }}
          />
          <circle cx="160" cy="80" r="28" fill="#FFFFFF" className="diag-pop" style={delay(450)} />
          <circle
            cx="260"
            cy="80"
            r="34"
            fill="none"
            stroke="#9A9A9A"
            strokeWidth="1"
            className="diag-draw"
            style={{ ...len(214), ...delay(600) }}
          />
          <circle cx="260" cy="80" r="5" fill="#9A9A9A" className="diag-pop" style={delay(1000)} />
        </svg>
      </DiagramFrame>
    );
  }
  return (
    <DiagramFrame>
      <svg viewBox="0 0 320 120" className="h-32 w-72" aria-hidden="true">
        <line x1="30" y1="60" x2="290" y2="60" stroke="#6D6D6D" strokeWidth="1" className="diag-draw" style={len(260)} />
        <circle cx="30" cy="60" r="6" fill="#FFFFFF" className="diag-pop" style={delay(200)} />
        <circle cx="290" cy="60" r="6" fill="#9A9A9A" className="diag-pop" style={delay(500)} />
        <circle cx="30" cy="60" r="4" fill="#9A9A9A" className="diag-traveler" />
        <text x="30" y="92" fill="#6D6D6D" fontSize="13" textAnchor="middle" className="diag-fade" style={delay(400)}>
          PT fixed
        </text>
        <text x="290" y="92" fill="#6D6D6D" fontSize="13" textAnchor="middle" className="diag-fade" style={delay(700)}>
          YT variable
        </text>
      </svg>
    </DiagramFrame>
  );
}
