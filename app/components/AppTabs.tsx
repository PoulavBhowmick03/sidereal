// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/mint", label: "Mint" },
  { href: "/trade", label: "Trade" },
  { href: "/redeem", label: "Redeem" },
];

/** In-app navigation tabs with active-route highlighting. */
export function AppTabs() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-1 items-center justify-center gap-1 text-sm">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <li key={tab.href}>
            <Link
              href={tab.href}
              className={
                active
                  ? "rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-lg px-3 py-1.5 text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900"
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
