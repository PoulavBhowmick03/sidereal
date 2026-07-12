// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { DOCS_PAGES } from "@/components/docsNav";

// Shared building blocks for /docs pages. Server components: the docs are
// static reading surfaces, so nothing here ships client JS.

// Page header: kicker (section voice), title, one-line summary.
export function DocsHeader({
  kicker,
  title,
  summary,
}: {
  kicker: string;
  title: string;
  summary: string;
}) {
  return (
    <header className="border-b border-white/10 pb-8">
      <p className="label-data">{kicker}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-paper sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-7 text-smoke">{summary}</p>
    </header>
  );
}

// Quiet aside panel. `signal` marks live-network caveats: the one place docs
// use amber, consistent with the app's "amber = signal, never decoration".
export function Callout({
  label,
  signal = false,
  children,
}: {
  label: string;
  signal?: boolean;
  children: React.ReactNode;
}) {
  return (
    <aside className={`panel-subtle border-l-2 p-5 ${signal ? "border-l-amber" : "border-l-white/30"}`}>
      <p className={`label-data mb-2 ${signal ? "text-amber" : ""}`}>{label}</p>
      <div className="text-[14px] leading-6 text-smoke [&_a]:text-paper [&_a]:underline [&_a]:decoration-white/30 [&_a]:underline-offset-4 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-paper [&_strong]:font-semibold [&_strong]:text-paper">
        {children}
      </div>
    </aside>
  );
}

// Prev/next pager derived from DOCS_PAGES order, so it can never disagree
// with the sidebar.
export function DocsPager({ current }: { current: string }) {
  const idx = DOCS_PAGES.findIndex((p) => p.href === current);
  const prev = idx > 0 ? DOCS_PAGES[idx - 1] : null;
  const next = idx >= 0 && idx < DOCS_PAGES.length - 1 ? DOCS_PAGES[idx + 1] : null;

  return (
    <nav aria-label="Documentation pages" className="mt-16 flex gap-4 border-t border-white/10 pt-8">
      {prev ? (
        <Link href={prev.href} className="group flex-1 border border-white/10 p-5 transition hover:border-white/40">
          <p className="label-data mb-2">Previous</p>
          <p className="text-[15px] text-paper">{prev.label}</p>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex-1 border border-white/10 p-5 text-right transition hover:border-white/40"
        >
          <p className="label-data mb-2">Next</p>
          <p className="text-[15px] text-paper">{next.label}</p>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  );
}
