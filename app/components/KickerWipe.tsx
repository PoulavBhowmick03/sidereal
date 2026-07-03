// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/useInView";

export function KickerWipe({ children, className = "" }: { children: string; className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion()) setArmed(true);
  }, []);

  return (
    <div ref={ref} className="w-fit">
      <p
        className={`kicker-wipe ${className}`}
        data-hidden={armed && !inView ? "true" : "false"}
      >
        {children}
      </p>
    </div>
  );
}
