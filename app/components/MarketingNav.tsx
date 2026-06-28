// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";

const LINKS = [
  { href: "#protocol", label: "Protocol" },
  { href: "#how-it-works", label: "How it works" },
  { href: "https://github.com/PoulavBhowmick03/sidereal", label: "Docs" },
];

// Marketing top bar. Transparent over the hero, then a solid ink backdrop once
// the user scrolls past it so the bar stays legible over the paper-white
// invariant band below. Includes a mobile disclosure for the section links.
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled ? "border-b border-white/10 bg-ink/90 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-6 sm:px-16">
        <Link href="/" aria-label="Sidereal home" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>

        <div className="flex items-center gap-8">
          <div className="hidden items-center gap-8 sm:flex">
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} className="label-data transition hover:text-paper">
                {l.label}
              </a>
            ))}
          </div>
          <Link
            href="/trade"
            className="rounded-pill bg-paper px-5 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink transition hover:bg-smoke"
          >
            Launch App
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center sm:hidden"
          >
            <span className="relative block h-3 w-5">
              <span
                className={`absolute left-0 block h-px w-5 bg-paper transition ${open ? "top-1.5 rotate-45" : "top-0"}`}
              />
              <span
                className={`absolute left-0 top-1.5 block h-px w-5 bg-paper transition ${open ? "opacity-0" : "opacity-100"}`}
              />
              <span
                className={`absolute left-0 block h-px w-5 bg-paper transition ${open ? "top-1.5 -rotate-45" : "top-3"}`}
              />
            </span>
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-white/10 bg-ink/95 px-6 py-4 sm:hidden">
          <ul className="flex flex-col gap-4">
            {LINKS.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="label-data transition hover:text-paper"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}
