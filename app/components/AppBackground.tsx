// SPDX-License-Identifier: Apache-2.0

import Image from "next/image";

// A faint atmospheric sheen behind the working app screens. Unlike the marketing
// hero, this is heavily dimmed and concentrated at the top, fading to pure ink
// over the dense data below, so it reads as texture and never competes with the
// numbers. It is fixed (content scrolls over it) and the data cards are solid
// carbon, so legibility is preserved. Ambient drift only, no parallax behind a
// functional screen.
export function AppBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 animate-mercury-drift">
        <Image src="/hero.png" alt="" fill sizes="100vw" className="object-cover opacity-25" />
      </div>
      {/* Strong ink wash, lightest at the top where the sheen lives, opaque by
          the lower half where holdings and quotes need full contrast. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/90 to-ink" />
    </div>
  );
}
