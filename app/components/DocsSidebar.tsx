// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/components/docsNav";

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-8">
      {DOCS_NAV.map((group) => (
        <div key={group.label}>
          <p className="label-data mb-3">{group.label}</p>
          <ul className="flex flex-col">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`block border-l py-1.5 pl-4 text-[14px] transition ${
                      active
                        ? "border-paper text-paper"
                        : "border-white/10 text-ash hover:border-white/40 hover:text-paper"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// Desktop: a sticky rail. Mobile: a disclosure bar above the content, closed
// after each navigation so the reader lands on the page, not the menu.
export function DocsSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="sticky top-[81px] hidden max-h-[calc(100vh-81px)] w-60 shrink-0 overflow-y-auto border-r border-white/10 py-10 pr-8 lg:block">
        <NavList />
      </aside>

      <div className="border-b border-white/10 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between py-4"
        >
          <span className="label-data">Documentation menu</span>
          <span className={`text-ash transition ${open ? "rotate-45" : ""}`} aria-hidden>
            +
          </span>
        </button>
        {open ? (
          <div className="pb-6">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
      </div>
    </>
  );
}
