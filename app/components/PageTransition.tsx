// SPDX-License-Identifier: Apache-2.0

"use client";

import { usePathname } from "next/navigation";

/** Entrance choreography for the working app screens: on every route change
 *  the page's top-level sections (heading, position cards, form grid) rise in
 *  with a short stagger. Pure CSS (see .page-enter in globals.css), keyed by
 *  pathname so the animation replays per navigation, and disabled under
 *  prefers-reduced-motion. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
