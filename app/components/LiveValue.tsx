// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";

// How long the previous characters stay mounted for their exit roll, and how
// long the amber refresh flash runs. One window covers both.
const SETTLE_MS = 900;

/** A live protocol value. When `value` changes, the characters that changed
 *  roll over odometer-style (old digit up and out, new digit in from below)
 *  and the whole value flashes amber for a beat: amber marking a live signal,
 *  exactly per the single-accent rule. While `loading`, renders a skeleton
 *  shimmer instead. Static under prefers-reduced-motion (values swap in
 *  place, no stale characters; see the .lv-* rules in globals.css). */
export function LiveValue({
  value,
  loading = false,
  className = "",
}: {
  value: string;
  loading?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState({ prev: null as string | null, value, epoch: 0 });

  useEffect(() => {
    if (value === shown.value) return;
    setShown((s) => ({ prev: s.value, value, epoch: s.epoch + 1 }));
    const t = setTimeout(() => setShown((s) => ({ ...s, prev: null })), SETTLE_MS);
    return () => clearTimeout(t);
  }, [value, shown.value]);

  if (loading) {
    return <span aria-hidden className={`skeleton ${className}`} />;
  }

  const { prev, value: cur, epoch } = shown;
  // Align to the previous value from the right, so a growing integer part
  // shifts rather than rewriting every digit.
  const offset = prev !== null ? prev.length - cur.length : 0;

  return (
    <span key={epoch} className={`${prev !== null ? "lv-flash" : ""} ${className}`}>
      {Array.from(cur).map((ch, i) => {
        const old = prev?.[i + offset];
        const changed = prev !== null && old !== ch;
        return (
          <span key={i} className="lv-cell">
            {changed && old !== undefined ? (
              <span aria-hidden className="lv-old">
                {old}
              </span>
            ) : null}
            <span className={changed ? "lv-new" : undefined}>{ch}</span>
          </span>
        );
      })}
    </span>
  );
}
