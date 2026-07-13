// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { appConfig } from "@/lib/config";
import { useSlideRect } from "@/lib/useSlideRect";

const TABS = [
  { href: "/strategy", label: "Strategy", tour: undefined },
  { href: "/mint", label: "Mint", tour: "nav-mint" },
  { href: "/trade", label: "Trade", tour: "nav-trade" },
  { href: "/pool", label: "Pool", tour: undefined },
  { href: "/portfolio", label: "Portfolio", tour: "nav-portfolio" },
  { href: "/demo", label: "Demo", tour: undefined },
];

/** In-app navigation tabs. The active tab is the one live signal here, so it
 *  carries the single accent plus the sanctioned signal bloom. The amber
 *  underline is a single measured element that slides between tabs on route
 *  change; before measurement (server render, no-JS) the active tab keeps a
 *  static underline so nothing is missing. */
export function AppTabs() {
  const pathname = usePathname();
  const tabs = useMemo(
    () => (appConfig().network === "testnet" ? TABS : TABS.filter((tab) => tab.href !== "/demo")),
    [],
  );
  const { containerRef, rect } = useSlideRect<HTMLUListElement>('[aria-current="page"]', pathname);

  return (
    <ul
      ref={containerRef}
      className="relative col-span-3 row-start-2 flex w-full flex-nowrap items-center justify-start gap-x-5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:col-auto sm:row-auto sm:w-auto sm:flex-1 sm:justify-center sm:gap-x-10 sm:overflow-visible sm:pb-0"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={active ? "page" : undefined}
              data-tour={tab.tour}
              className={
                active
                  ? `glow-signal relative pb-1 text-[13px] uppercase tracking-[0.12em] text-amber ${
                      rect
                        ? ""
                        : "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-amber after:shadow-[0_0_8px_rgba(255,172,46,0.55)]"
                    }`
                  : "pb-1 text-[13px] uppercase tracking-[0.12em] text-smoke transition hover:text-paper"
              }
            >
              {tab.label}
            </Link>
          </li>
        );
      })}
      {rect ? (
        <span
          aria-hidden
          className="absolute h-px bg-amber shadow-[0_0_8px_rgba(255,172,46,0.55)] transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ left: rect.left, top: rect.top + rect.height - 1, width: rect.width }}
        />
      ) : null}
    </ul>
  );
}
