// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { StarfieldBackground } from "./StarfieldBackground";

// Parallax "reveal" footer: the footer is pinned to the bottom of the viewport
// behind the page content, and a spacer the height of the footer sits at the
// end of the flow. As you scroll to the bottom, the opaque content slides up off
// the fixed footer, revealing it underneath. The spacer is measured from the
// footer so the reveal is exactly one footer tall on any viewport.
export function RevealFooter({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      {/* Reserves the scroll distance that reveals the fixed footer. */}
      <div aria-hidden style={{ height }} />
      <footer
        ref={ref}
        className="fixed inset-x-0 bottom-0 z-0 overflow-hidden border-t border-white/10 bg-carbon"
      >
        <StarfieldBackground />
        <div className="relative z-10">{children}</div>
      </footer>
    </>
  );
}
