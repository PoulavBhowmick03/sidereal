// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { prefersReducedMotion } from "@/lib/useInView";

export function Spotlight({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const frameRef = useRef(0);
  const pointRef = useRef({ x: 0, y: 0 });

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion()) return;

    const rect = event.currentTarget.getBoundingClientRect();
    pointRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (frameRef.current) return;

    const element = event.currentTarget;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      element.style.setProperty("--mx", `${pointRef.current.x}px`);
      element.style.setProperty("--my", `${pointRef.current.y}px`);
    });
  };

  return (
    <div className={`spotlight ${className}`} onPointerMove={onPointerMove}>
      {children}
    </div>
  );
}
