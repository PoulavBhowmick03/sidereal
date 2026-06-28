// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/mint", label: "Mint" },
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
];

/** In-app navigation tabs. The active tab is the one live signal here, so it
 *  carries the single accent: amber label over an amber underline tick. */
export function AppTabs() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-1 items-center justify-center gap-6 sm:gap-10">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "relative pb-1 text-[13px] uppercase tracking-[0.12em] text-amber after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-amber"
                  : "pb-1 text-[13px] uppercase tracking-[0.12em] text-smoke transition hover:text-paper"
              }
            >
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
